"use server";

import { z } from "zod";
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
