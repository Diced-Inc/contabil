"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { empresas } from "@/db/schema";
import { getEmpresa } from "@/app/e/[id]/empresa";
import { ANTES_DAS, APOS_ENVIO_DAS, DIA_PEDIDO, LEMBRETE_EXTRATO } from "@/lib/avisos";

export type EstadoAvisos = { erro?: string; ok?: boolean };

const dias = (faixa: { min: number; max: number }, nome: string) =>
  z
    .array(z.coerce.number().int().min(faixa.min, `${nome}: use de ${faixa.min} a ${faixa.max}.`).max(faixa.max, `${nome}: use de ${faixa.min} a ${faixa.max}.`))
    .max(5, `${nome}: até 5 dias.`)
    .transform((xs) => [...new Set(xs)].sort((a, b) => a - b));

const schema = z.object({
  avisosAtivos: z.boolean(),
  diaPedidoExtrato: z.coerce.number().int().min(DIA_PEDIDO.min, "Dia do pedido: use de 1 a 28.").max(DIA_PEDIDO.max, "Dia do pedido: use de 1 a 28."),
  lembretesExtratoDias: dias(LEMBRETE_EXTRATO, "Lembretes do extrato"),
  lembretesDasAposEnvio: dias(APOS_ENVIO_DAS, "Lembretes depois da guia"),
  diasAntesVencimentoDas: dias(ANTES_DAS, "Lembretes antes do vencimento"),
});

export async function salvarAvisos(empresaId: string, _prev: EstadoAvisos, form: FormData): Promise<EstadoAvisos> {
  await getEmpresa(empresaId);
  const r = schema.safeParse({
    avisosAtivos: form.get("avisosAtivos") === "on",
    diaPedidoExtrato: form.get("diaPedidoExtrato"),
    lembretesExtratoDias: form.getAll("lembretesExtratoDias"),
    lembretesDasAposEnvio: form.getAll("lembretesDasAposEnvio"),
    diasAntesVencimentoDas: form.getAll("diasAntesVencimentoDas"),
  });
  if (!r.success) return { erro: r.error.issues[0].message };
  await db.update(empresas).set(r.data).where(eq(empresas.id, empresaId));
  revalidatePath(`/e/${empresaId}/configuracoes`);
  return { ok: true };
}
