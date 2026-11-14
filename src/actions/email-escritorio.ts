"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { enderecosPendentes } from "@/db/schema";
import {
  alternarEndereco, atualizarEndereco, criarDestino, criarEndereco, dominioEmail, listarDestinos, listarEnderecos,
  normalizarLocal, removerEndereco, validarLocal, type Resultado,
} from "@/lib/email-routing";
import { requireUser } from "@/supabase/server";

const CAMINHO = "/configuracoes-gerais/emails";

/** aguarda: o endereço ficou pendente esperando o destino confirmar ou a permissão do token. */
export type EstadoEndereco = { erro?: string; ok?: boolean; aguarda?: "confirmacao" | "permissao"; endereco?: string; destino?: string };

const fim = <T,>(r: Resultado<T>) => {
  revalidatePath(CAMINHO);
  return "erro" in r ? { erro: r.mensagem } : { ok: true };
};

/** Cria (id null) ou edita um endereço. Destino novo é cadastrado no Cloudflare e o endereço fica pendente até ele confirmar. */
export async function salvarEndereco(id: string | null, _prev: EstadoEndereco, form: FormData): Promise<EstadoEndereco> {
  await requireUser();
  const dominio = dominioEmail();
  if (!dominio) return { erro: "A integração com o Cloudflare não está configurada neste servidor." };
  const local = normalizarLocal(String(form.get("local") ?? ""));
  const invalido = validarLocal(local);
  if (invalido) return { erro: invalido };
  const destino = String(form.get("destino") ?? "").trim().toLowerCase();
  if (!destino) return { erro: "Escolha para qual e-mail encaminhar." };
  const nome = String(form.get("nome") ?? "").trim().slice(0, 80);
  const endereco = `${local}@${dominio}`;

  if (id) {
    const r = await atualizarEndereco(id, { local, destino, nome });
    revalidatePath(CAMINHO);
    return "erro" in r ? { erro: r.mensagem } : { ok: true, endereco, destino };
  }

  const destinos = await listarDestinos();
  if ("erro" in destinos) return { erro: destinos.mensagem };
  let d = destinos.dados.find((x) => x.email === destino);
  if (!d) {
    const novo = await criarDestino(destino);
    if ("erro" in novo) return { erro: novo.mensagem };
    d = novo.dados;
  }

  // Fica pendente se o destino não confirmou ou se o token ainda não pode criar regras; a reconciliação termina depois.
  const guardar = async (aguarda: EstadoEndereco["aguarda"]) => {
    await db
      .insert(enderecosPendentes)
      .values({ local, destino, nome: nome || null })
      .onConflictDoUpdate({ target: enderecosPendentes.local, set: { destino, nome: nome || null } });
    revalidatePath(CAMINHO);
    return { ok: true, aguarda, endereco, destino };
  };

  if (!d.verificado) {
    // sem permissão nas regras não dá para conferir conflito; a reconciliação descarta o pendente se a regra existir
    const existentes = await listarEnderecos();
    if (!("erro" in existentes) && existentes.dados.enderecos.some((e) => e.endereco === endereco)) return { erro: "Esse endereço já existe." };
    return guardar("confirmacao");
  }

  const r = await criarEndereco({ local, destino, nome });
  if ("erro" in r) return r.erro === "permissao_regras" ? guardar("permissao") : { erro: r.mensagem };
  await db.delete(enderecosPendentes).where(eq(enderecosPendentes.local, local));
  revalidatePath(CAMINHO);
  return { ok: true, endereco, destino };
}

export async function alternar(id: string, ativo: boolean) {
  await requireUser();
  return fim(await alternarEndereco(id, ativo));
}

export async function remover(id: string) {
  await requireUser();
  return fim(await removerEndereco(id));
}

export async function removerPendente(local: string) {
  await requireUser();
  await db.delete(enderecosPendentes).where(eq(enderecosPendentes.local, local));
  revalidatePath(CAMINHO);
  return { ok: true };
}
