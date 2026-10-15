"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { lancamentos } from "@/db/schema";
import { parseValorBR } from "@/lib/format";
import { criarLancamento, editarLancamento, estornarLancamento, exigirSemTitulo } from "@/lib/lancamentos";
import { requireUser } from "@/supabase/server";
import type { EstadoForm } from "./empresas";

const valor = z
  .string()
  .transform(parseValorBR)
  .pipe(z.string().regex(/^(\d+(\.\d{1,2})?)?$/, "Valor inválido (use até 2 casas decimais)."));

const lancamentoSchema = z.object({
  data: z.iso.date("Informe a data."),
  competencia: z
    .string()
    .regex(/^(\d{4}-\d{2})?$/, "Competência inválida.")
    .transform((s) => (s ? `${s}-01` : undefined)),
  dataPagamento: z.union([z.literal("").transform(() => null), z.iso.date("Data de pagamento inválida.")]),
  historico: z.string().trim().min(3, "Histórico deve ter ao menos 3 caracteres."),
  documento: z.string().trim().transform((s) => s || null),
  partidas: z
    .array(z.object({ contaId: z.uuid("Selecione a conta em todas as partidas."), debito: valor, credito: valor }))
    .min(2, "Informe ao menos duas partidas."),
});

/** Campos `partidas[i].contaId|debito|credito`, na ordem de i; linhas totalmente vazias são ignoradas. */
function lerPartidas(form: FormData) {
  const porIndice = new Map<number, Record<string, string>>();
  for (const [k, v] of form) {
    const m = /^partidas\[(\d+)\]\.(contaId|debito|credito)$/.exec(k);
    if (!m || typeof v !== "string") continue;
    const i = Number(m[1]);
    porIndice.set(i, { ...porIndice.get(i), [m[2]]: v });
  }
  return [...porIndice.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, p]) => ({ contaId: p.contaId ?? "", debito: p.debito ?? "", credito: p.credito ?? "" }))
    .filter((p) => p.contaId || p.debito.trim() || p.credito.trim());
}

function ler(form: FormData) {
  const str = (k: string) => (form.get(k) as string | null) ?? "";
  return lancamentoSchema.safeParse({
    data: str("data"),
    competencia: str("competencia"),
    dataPagamento: str("dataPagamento"),
    historico: str("historico"),
    documento: str("documento"),
    partidas: lerPartidas(form),
  });
}

/** Mensagem do trigger/validação, sem SQL nem stack (Drizzle embrulha o erro do Postgres em `cause`). */
function mensagem(e: unknown) {
  const err = e as { message?: string; cause?: { message?: string } };
  const msg = err.cause?.message ?? err.message ?? "";
  return { erro: msg.replace(/^error:\s*/i, "") || "Erro ao gravar o lançamento." };
}

export async function criarLancamentoManual(empresaId: string, _prev: EstadoForm, form: FormData): Promise<EstadoForm> {
  const user = await requireUser();
  const r = ler(form);
  if (!r.success) return { erro: r.error.issues[0].message };
  let id: string;
  try {
    const l = await db.transaction((tx) =>
      criarLancamento(tx, { ...r.data, empresaId, origem: "manual", usuarioId: user.id }),
    );
    id = l.id;
  } catch (e) {
    return mensagem(e);
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  redirect(`/e/${empresaId}/lancamentos/${id}`);
}

export async function editarLancamentoManual(
  empresaId: string,
  id: string,
  _prev: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  const user = await requireUser();
  const r = ler(form);
  if (!r.success) return { erro: r.error.issues[0].message };
  try {
    await db.transaction((tx) => editarLancamento(tx, id, { ...r.data, empresaId, usuarioId: user.id }));
  } catch (e) {
    return mensagem(e);
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  redirect(`/e/${empresaId}/lancamentos/${id}`);
}

export async function estornar(empresaId: string, id: string, _prev: EstadoForm, form: FormData): Promise<EstadoForm> {
  const user = await requireUser();
  const data = z.iso.date().safeParse(form.get("data"));
  if (!data.success) return { erro: "Informe a data do estorno." };
  let estornoId: string;
  try {
    estornoId = await db.transaction(async (tx) => {
      const [l] = await tx
        .select({ origem: lancamentos.origem })
        .from(lancamentos)
        .where(and(eq(lancamentos.id, id), eq(lancamentos.empresaId, empresaId)));
      if (!l) throw new Error("Lançamento não encontrado");
      if (l.origem === "conciliacao") throw new Error("Lançamento de conciliação: use Desfazer conciliação");
      if (l.origem === "apuracao") throw new Error("Lançamento de apuração: reverta a apuração no fechamento");
      if (l.origem === "estorno") throw new Error("Um estorno não pode ser estornado");
      await exigirSemTitulo(tx, id);
      return (await estornarLancamento(tx, id, data.data, user.id)).id;
    });
  } catch (e) {
    return mensagem(e);
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  redirect(`/e/${empresaId}/lancamentos/${estornoId}`);
}
