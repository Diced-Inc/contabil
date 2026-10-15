"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { empresas } from "@/db/schema";
import { seedPlano } from "@/db/seed-plano";
import { somenteDigitos } from "@/lib/format";
import { requireUser } from "@/supabase/server";

export type EstadoForm = { erro?: string; ok?: boolean };

/** Campo opcional: vazio vira null; senão aplica o schema ao texto aparado. */
function opcional<T extends z.ZodType<string, string>>(schema: T) {
  return z.string().trim().transform((v) => v || null).pipe(z.union([z.null(), schema]));
}
const cpf = (msg: string) => opcional(z.string().transform(somenteDigitos).pipe(z.string().length(11, msg)));

const empresaSchema = z.object({
  razaoSocial: z.string().trim().min(2, "Razão social deve ter ao menos 2 caracteres."),
  cnpj: z.string().transform(somenteDigitos).pipe(z.string().length(14, "CNPJ deve ter 14 dígitos.")),
  regimeTributario: z.enum(["simples", "presumido", "real"], "Regime tributário inválido."),
  cidade: opcional(z.string()),
  uf: opcional(z.string().toUpperCase().regex(/^[A-Z]{2}$/, "UF deve ter 2 letras.")),
  responsavelNome: opcional(z.string()),
  responsavelCpf: cpf("CPF do responsável deve ter 11 dígitos."),
  contadorNome: opcional(z.string()),
  contadorCpf: cpf("CPF do contador deve ter 11 dígitos."),
  contadorCrc: opcional(z.string()),
});

function ler(form: FormData) {
  return empresaSchema.safeParse(
    Object.fromEntries(Object.keys(empresaSchema.shape).map((c) => [c, c === "regimeTributario" ? form.get(c) : (form.get(c) ?? "")])),
  );
}

function cnpjDuplicado(e: unknown) {
  const err = e as { code?: string; cause?: { code?: string } };
  return (err.cause?.code ?? err.code) === "23505";
}

export async function criarEmpresa(_prev: EstadoForm, form: FormData): Promise<EstadoForm> {
  await requireUser();
  const r = ler(form);
  if (!r.success) return { erro: r.error.issues[0].message };
  let id: string;
  try {
    id = await db.transaction(async (tx) => {
      const [e] = await tx.insert(empresas).values(r.data).returning({ id: empresas.id });
      await seedPlano(tx, e.id);
      return e.id;
    });
  } catch (e) {
    if (cnpjDuplicado(e)) return { erro: "CNPJ já cadastrado." };
    throw e;
  }
  revalidatePath("/");
  redirect(`/e/${id}`);
}

export async function atualizarEmpresa(id: string, _prev: EstadoForm, form: FormData): Promise<EstadoForm> {
  await requireUser();
  const r = ler(form);
  if (!r.success) return { erro: r.error.issues[0].message };
  try {
    await db.update(empresas).set(r.data).where(eq(empresas.id, id));
  } catch (e) {
    if (cnpjDuplicado(e)) return { erro: "CNPJ já cadastrado." };
    throw e;
  }
  revalidatePath("/");
  revalidatePath(`/e/${id}`, "layout");
  return { ok: true };
}
