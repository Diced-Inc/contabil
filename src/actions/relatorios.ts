"use server";

import { z } from "zod";
import { getLancamento } from "@/app/e/[id]/lancamentos/queries";
import { razao } from "@/lib/relatorios/razao";
import { requireUser } from "@/supabase/server";

const schema = z.object({ empresaId: z.uuid(), contaId: z.uuid(), de: z.iso.date(), ate: z.iso.date() });

/** Razão da conta no período, para o painel de detalhe dos relatórios. null se inválido ou a conta não é da empresa. */
export async function detalheConta(empresaId: string, contaId: string, de: string, ate: string) {
  await requireUser();
  const p = schema.safeParse({ empresaId, contaId, de, ate });
  if (!p.success) return null;
  return razao(p.data.empresaId, p.data.contaId, p.data.de, p.data.ate);
}

/** Lançamento completo (partidas, original/estorno) para o painel do Razão. null se inválido ou de outra empresa. */
export async function detalheLancamento(empresaId: string, lancamentoId: string) {
  await requireUser();
  const p = z.object({ empresaId: z.uuid(), lancamentoId: z.uuid() }).safeParse({ empresaId, lancamentoId });
  if (!p.success) return null;
  return (await getLancamento(p.data.empresaId, p.data.lancamentoId)) ?? null;
}
