"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { contaResultadoValida } from "@/app/e/[id]/titulos/queries";
import { parseValorBR } from "@/lib/format";
import { cancelarTitulo, criarTitulo } from "@/lib/titulos";
import { requireUser } from "@/supabase/server";
import type { EstadoForm } from "./empresas";

const tituloSchema = z.object({
  tipo: z.enum(["receber", "pagar"], "Selecione o tipo."),
  contraparte: z.string().trim().min(1, "Informe a contraparte."),
  documento: z.string().trim().transform((s) => s || null),
  descricao: z.string().trim().min(1, "Informe a descrição."),
  valor: z
    .string()
    .transform(parseValorBR)
    .pipe(z.string().regex(/^\d+(\.\d{1,2})?$/, "Valor inválido (use até 2 casas decimais)."))
    .refine((v) => Number(v) > 0, "Valor deve ser maior que zero."),
  competencia: z.iso.date("Informe a data do fato (competência)."),
  vencimento: z.union([z.literal("").transform(() => null), z.iso.date("Vencimento inválido.")]),
  contaResultadoId: z.uuid("Selecione a conta de resultado."),
});

/** Mensagem do trigger/validação, sem SQL (Drizzle embrulha o erro do Postgres em `cause`). */
function mensagem(e: unknown, padrao: string) {
  const err = e as { message?: string; cause?: { message?: string } };
  const msg = err.cause?.message ?? err.message ?? "";
  return { erro: msg.replace(/^error:\s*/i, "") || padrao };
}

export async function criarTituloAction(empresaId: string, _prev: EstadoForm, form: FormData): Promise<EstadoForm> {
  const user = await requireUser();
  const str = (k: string) => (form.get(k) as string | null) ?? "";
  const r = tituloSchema.safeParse({
    tipo: str("tipo"),
    contraparte: str("contraparte"),
    documento: str("documento"),
    descricao: str("descricao"),
    valor: str("valor"),
    competencia: str("competencia"),
    vencimento: str("vencimento"),
    contaResultadoId: str("contaResultadoId"),
  });
  if (!r.success) return { erro: r.error.issues[0].message };
  if (r.data.vencimento && r.data.vencimento < r.data.competencia)
    return { erro: "Vencimento não pode ser anterior à competência." };
  if (!(await contaResultadoValida(empresaId, r.data.contaResultadoId, r.data.tipo)))
    return {
      erro: r.data.tipo === "receber"
        ? "A conta precisa ser uma receita analítica ativa (3.1) desta empresa."
        : "A conta precisa ser um custo ou despesa analítica ativa (3.2) desta empresa.",
    };
  try {
    await db.transaction((tx) => criarTitulo(tx, { ...r.data, empresaId, usuarioId: user.id }));
  } catch (e) {
    return mensagem(e, "Erro ao gravar o título.");
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  return { ok: true };
}

export async function cancelarTituloAction(empresaId: string, tituloId: string): Promise<EstadoForm> {
  const user = await requireUser();
  try {
    await db.transaction((tx) => cancelarTitulo(tx, empresaId, tituloId, user.id));
  } catch (e) {
    return mensagem(e, "Erro ao cancelar o título.");
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  return { ok: true };
}
