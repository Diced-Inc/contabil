"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { db } from "@/db";
import { contadores, membros } from "@/db/schema";
import { getEmpresa } from "@/app/e/[id]/empresa";
import { emailConvite, enviarEmail } from "@/lib/email";
import { adminClient } from "@/supabase/admin";
import { requireUser } from "@/supabase/server";

/** `aviso` + `link`: convite gerado mas não enviado por e-mail; o contador copia e manda. */
export type EstadoConvite = { erro?: string; ok?: boolean; aviso?: string; link?: string };

const SEM_CHAVE = "Configure SUPABASE_SERVICE_ROLE_KEY para enviar convites.";

const conviteSchema = z.object({
  nome: z.string().trim().max(80, "Use até 80 caracteres.").transform((s) => s || null),
  email: z.preprocess((v) => String(v ?? "").trim().toLowerCase(), z.email("Informe um e-mail válido.")),
});

async function usuarioAuth(email: string) {
  const [u] = await db.execute<{ id: string; confirmado: boolean }>(
    sql`select id, email_confirmed_at is not null as confirmado from auth.users where lower(email) = ${email} limit 1`,
  );
  return u ?? null;
}

/** Gera o link de acesso (invite para e-mail novo, magiclink se a conta já existe) e manda pelo Resend. */
async function enviarConvite(m: { id: string; email: string; nome: string | null }, empresa: string): Promise<EstadoConvite> {
  const admin = adminClient();
  if (!admin) return { aviso: `O cliente foi cadastrado, mas o convite não saiu. ${SEM_CHAVE}` };

  const { data, error } = (await usuarioAuth(m.email))
    ? await admin.auth.admin.generateLink({ type: "magiclink", email: m.email })
    : await admin.auth.admin.generateLink({ type: "invite", email: m.email, options: { data: { display_name: m.nome ?? undefined } } });
  if (error) return { erro: `Não foi possível gerar o convite: ${error.message}` };

  const site = process.env.NEXT_PUBLIC_SITE_URL || (await headers()).get("origin");
  const params = new URLSearchParams({
    token_hash: data.properties.hashed_token,
    type: data.properties.verification_type,
    proximo: "definir-senha",
  });
  const link = `${site}/login/confirmar?${params}`;
  await db.update(membros).set({ convidadoEm: new Date() }).where(eq(membros.id, m.id));

  const r = await enviarEmail({ para: m.email, ...emailConvite({ nome: m.nome, empresa, link }) });
  if (r.status === "enviado") return { ok: true };
  console.error("[convite] e-mail não enviado:", r.status, r.erro);
  return {
    aviso:
      r.status === "nao_configurado"
        ? "Configure RESEND_API_KEY e EMAIL_FROM para enviar por e-mail. Enquanto isso, copie o link (vale 24 horas) e mande ao cliente:"
        : `O e-mail falhou (${r.erro}). Copie o link (vale 24 horas) e mande ao cliente:`,
    link,
  };
}

export async function convidarCliente(empresaId: string, _prev: EstadoConvite, form: FormData): Promise<EstadoConvite> {
  await requireUser();
  const empresa = await getEmpresa(empresaId);
  const r = conviteSchema.safeParse({ nome: form.get("nome") ?? "", email: form.get("email") });
  if (!r.success) return { erro: r.error.issues[0].message };
  const { nome, email } = r.data;

  const [contador] = await db.select({ id: contadores.userId }).from(contadores).where(eq(contadores.email, email));
  if (contador) return { erro: "Esse e-mail é de um contador, que já vê todas as empresas." };

  // Conta já confirmada (cliente de outra empresa): libera direto, sem convite.
  const existente = await usuarioAuth(email);
  const ativo = existente?.confirmado ? existente.id : null;
  const [m] = await db
    .insert(membros)
    .values({ empresaId, email, nome, userId: ativo, aceitoEm: ativo ? new Date() : null })
    .onConflictDoNothing()
    .returning({ id: membros.id, email: membros.email, nome: membros.nome });
  if (!m) return { erro: "Esse e-mail já tem acesso a esta empresa." };
  revalidatePath(`/e/${empresaId}/clientes`);
  if (ativo) return { ok: true, aviso: "Esse e-mail já tem conta: o acesso a esta empresa foi liberado na hora." };

  return enviarConvite(m, empresa.razaoSocial);
}

export async function reenviarConvite(empresaId: string, membroId: string): Promise<EstadoConvite> {
  await requireUser();
  const empresa = await getEmpresa(empresaId);
  const [m] = await db
    .select({ id: membros.id, email: membros.email, nome: membros.nome, userId: membros.userId })
    .from(membros)
    .where(and(eq(membros.id, membroId), eq(membros.empresaId, empresaId)));
  if (!m) return { erro: "Cliente não encontrado." };
  if (m.userId) return { erro: "Esse cliente já ativou o acesso." };
  const r = await enviarConvite(m, empresa.razaoSocial);
  revalidatePath(`/e/${empresaId}/clientes`);
  return r;
}

/** Tira o acesso à empresa (apaga o vínculo). A conta no Supabase Auth continua. */
export async function removerCliente(empresaId: string, membroId: string): Promise<EstadoConvite> {
  await requireUser();
  await db.delete(membros).where(and(eq(membros.id, membroId), eq(membros.empresaId, empresaId)));
  revalidatePath(`/e/${empresaId}/clientes`);
  return { ok: true };
}
