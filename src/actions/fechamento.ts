"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, type Tx } from "@/db";
import { apurarExercicio, fecharMes, reabrirMes, reverterApuracao } from "@/lib/fechamento";
import { requireUser } from "@/supabase/server";
import type { EstadoForm } from "./empresas";

const competenciaSchema = z.iso.date("Competência inválida.");
const anoSchema = z.number().int().min(1900, "Ano inválido.").max(2200, "Ano inválido.");

/** Mensagem do trigger/validação, sem SQL (Drizzle embrulha o erro do Postgres em `cause`). */
function mensagem(e: unknown, padrao: string) {
  const err = e as { message?: string; cause?: { message?: string } };
  const msg = err.cause?.message ?? err.message ?? "";
  return { erro: msg.replace(/^error:\s*/i, "") || padrao };
}

async function executar(empresaId: string, padrao: string, fn: (tx: Tx, usuarioId: string) => Promise<unknown>): Promise<EstadoForm> {
  const user = await requireUser();
  if (!z.uuid().safeParse(empresaId).success) return { erro: "Empresa inválida." };
  try {
    await db.transaction((tx) => fn(tx, user.id));
  } catch (e) {
    return mensagem(e, padrao);
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  return { ok: true };
}

export async function fecharMesAction(empresaId: string, competencia: string) {
  const c = competenciaSchema.safeParse(competencia);
  if (!c.success) return { erro: c.error.issues[0].message };
  return executar(empresaId, "Erro ao fechar o mês.", (tx, u) => fecharMes(tx, empresaId, c.data, u));
}

export async function reabrirMesAction(empresaId: string, competencia: string) {
  const c = competenciaSchema.safeParse(competencia);
  if (!c.success) return { erro: c.error.issues[0].message };
  return executar(empresaId, "Erro ao reabrir o mês.", (tx, u) => reabrirMes(tx, empresaId, c.data, u));
}

export async function apurarAction(empresaId: string, ano: number) {
  const a = anoSchema.safeParse(ano);
  if (!a.success) return { erro: a.error.issues[0].message };
  return executar(empresaId, "Erro ao apurar o exercício.", (tx, u) => apurarExercicio(tx, empresaId, a.data, u));
}

export async function reverterApuracaoAction(empresaId: string, ano: number) {
  const a = anoSchema.safeParse(ano);
  if (!a.success) return { erro: a.error.issues[0].message };
  return executar(empresaId, "Erro ao reverter a apuração.", (tx, u) => reverterApuracao(tx, empresaId, a.data, u));
}
