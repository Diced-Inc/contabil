"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { contasBancarias, transacoesBancarias } from "@/db/schema";
import { valorDoPadrao } from "@/lib/classificacao/regras";
import { sugerirPendentes, type ResultadoSugestao } from "@/lib/classificacao/pipeline";
import {
  alterarIgnorada, baixarTituloPorTransacao, classificarTransacao, desfazerConciliacao as desfazer, transferirEntreContas,
} from "@/lib/conciliacao";
import { cents, fromCents, parseValorBR, somenteDigitos } from "@/lib/format";
import { requireUser } from "@/supabase/server";
import type { EstadoForm } from "./empresas";

/** Mensagem do trigger/validação, sem SQL (Drizzle embrulha o erro do Postgres em `cause`). */
function msg(e: unknown) {
  const err = e as { message?: string; cause?: { message?: string } };
  return (err.cause?.message ?? err.message ?? "").replace(/^error:\s*/i, "") || "Erro ao conciliar.";
}

async function executar(empresaId: string, fn: (usuarioId: string) => Promise<unknown>): Promise<EstadoForm> {
  const user = await requireUser();
  try {
    await fn(user.id);
  } catch (e) {
    return { erro: msg(e) };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  return { ok: true };
}

const uuid = z.uuid("Transação inválida.");

const classificacaoSchema = z.object({
  transacaoId: uuid,
  partidas: z
    .array(
      z.object({
        contaId: z.uuid("Selecione a conta em todas as linhas."),
        valor: z.string().transform(parseValorBR).pipe(z.string().regex(/^\d+(\.\d{1,2})?$/, "Valor inválido (use até 2 casas decimais).")),
      }),
    )
    .min(1, "Informe ao menos uma contrapartida."),
  historico: z.string().trim().min(3, "Histórico deve ter ao menos 3 caracteres."),
  documento: z.string().trim().optional().transform((s) => s || null),
  competencia: z
    .string()
    .regex(/^(\d{4}-\d{2})?$/, "Competência inválida.")
    .optional()
    .transform((s) => (s ? `${s}-01` : undefined)),
  criarRegra: z
    .object({
      nome: z.string().trim().min(1, "Informe o nome da regra."),
      tipoMatch: z.enum(["memo_contem", "documento", "valor_exato"], "Selecione o tipo da regra."),
      padrao: z.string().trim().min(1, "Informe o padrão da regra."),
      sinal: z.enum(["entrada", "saida", "qualquer"], "Selecione o sinal da regra."),
    })
    .optional()
    .refine((r) => r?.tipoMatch !== "valor_exato" || valorDoPadrao(r.padrao) > 0, "Para valor exato, o padrão deve ser um valor maior que zero.")
    .refine((r) => r?.tipoMatch !== "documento" || !!somenteDigitos(r.padrao), "Para documento, o padrão deve conter os dígitos do CPF/CNPJ."),
});
export type ClassificacaoInput = z.input<typeof classificacaoSchema>;

export async function aprovarClassificacao(empresaId: string, input: ClassificacaoInput): Promise<EstadoForm> {
  const r = classificacaoSchema.safeParse(input);
  if (!r.success) return { erro: r.error.issues[0].message };
  return executar(empresaId, (usuarioId) => db.transaction((tx) => classificarTransacao(tx, { ...r.data, empresaId, usuarioId })));
}

export async function baixarTituloPelaTransacao(
  empresaId: string,
  input: { transacaoId: string; tituloId: string; contaDiferencaId?: string | null },
): Promise<EstadoForm> {
  const r = z
    .object({ transacaoId: uuid, tituloId: z.uuid("Selecione o título."), contaDiferencaId: z.uuid().nullish().or(z.literal("").transform(() => null)) })
    .safeParse(input);
  if (!r.success) return { erro: r.error.issues[0].message };
  return executar(empresaId, (usuarioId) => db.transaction((tx) => baixarTituloPorTransacao(tx, { ...r.data, empresaId, usuarioId })));
}

export async function marcarTransferencia(empresaId: string, input: { transacaoId: string; parId: string }): Promise<EstadoForm> {
  const r = z.object({ transacaoId: uuid, parId: z.uuid("Selecione a transação par.") }).safeParse(input);
  if (!r.success) return { erro: r.error.issues[0].message };
  return executar(empresaId, (usuarioId) => db.transaction((tx) => transferirEntreContas(tx, { ...r.data, empresaId, usuarioId })));
}

export async function ignorarTransacao(empresaId: string, transacaoId: string, motivo?: string): Promise<EstadoForm> {
  if (!uuid.safeParse(transacaoId).success) return { erro: "Transação inválida." };
  return executar(empresaId, () => db.transaction((tx) => alterarIgnorada(tx, empresaId, transacaoId, true, motivo?.trim())));
}

export async function reativarTransacao(empresaId: string, transacaoId: string): Promise<EstadoForm> {
  if (!uuid.safeParse(transacaoId).success) return { erro: "Transação inválida." };
  return executar(empresaId, () => db.transaction((tx) => alterarIgnorada(tx, empresaId, transacaoId, false)));
}

export async function desfazerConciliacao(empresaId: string, transacaoId: string): Promise<EstadoForm> {
  if (!uuid.safeParse(transacaoId).success) return { erro: "Transação inválida." };
  return executar(empresaId, (usuarioId) => db.transaction((tx) => desfazer(tx, empresaId, transacaoId, usuarioId)));
}

/** Só sugestões de regra ou transferência; cada transação na sua própria transação do banco. */
export async function aprovarEmLote(empresaId: string, transacaoIds: string[]): Promise<{ aprovadas: number; erros: string[] }> {
  const user = await requireUser();
  const ids = z.array(z.uuid()).safeParse(transacaoIds);
  if (!ids.success || !ids.data.length) return { aprovadas: 0, erros: ["Nenhuma transação selecionada."] };
  const txs = await db
    .select({
      id: transacoesBancarias.id, memo: transacoesBancarias.memo, valor: transacoesBancarias.valor,
      sugestaoOrigem: transacoesBancarias.sugestaoOrigem, sugestaoContaId: transacoesBancarias.sugestaoContaId,
      sugestaoHistorico: transacoesBancarias.sugestaoHistorico, transferenciaParId: transacoesBancarias.transferenciaParId,
    })
    .from(transacoesBancarias)
    .innerJoin(contasBancarias, eq(contasBancarias.id, transacoesBancarias.contaBancariaId))
    .where(and(eq(contasBancarias.empresaId, empresaId), inArray(transacoesBancarias.id, ids.data)));

  let aprovadas = 0;
  const erros: string[] = [];
  const feitas = new Set<string>();
  for (const t of txs) {
    if (feitas.has(t.id)) continue;
    try {
      if (t.sugestaoOrigem === "regra" && t.sugestaoContaId) {
        const contaId = t.sugestaoContaId;
        await db.transaction((tx) =>
          classificarTransacao(tx, {
            empresaId, transacaoId: t.id, usuarioId: user.id,
            partidas: [{ contaId, valor: fromCents(Math.abs(cents(t.valor))) }],
            historico: t.sugestaoHistorico || t.memo || "Conciliação bancária",
          }),
        );
      } else if (t.sugestaoOrigem === "transferencia" && t.transferenciaParId) {
        const parId = t.transferenciaParId;
        await db.transaction((tx) => transferirEntreContas(tx, { empresaId, transacaoId: t.id, parId, usuarioId: user.id }));
        feitas.add(parId);
      } else {
        throw new Error("Só sugestões de regra ou transferência podem ser aprovadas em lote");
      }
      feitas.add(t.id);
      aprovadas++;
    } catch (e) {
      erros.push(`${t.memo.slice(0, 40) || t.id.slice(0, 8)}: ${msg(e)}`);
    }
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  return { aprovadas, erros };
}

export async function sugerirComIA(empresaId: string): Promise<ResultadoSugestao> {
  await requireUser();
  const r = await sugerirPendentes(empresaId);
  revalidatePath(`/e/${empresaId}`, "layout");
  return r;
}
