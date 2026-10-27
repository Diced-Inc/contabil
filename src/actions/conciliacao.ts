"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { contasBancarias, transacoesBancarias } from "@/db/schema";
import { aplicarTemplate, valorDoPadrao } from "@/lib/classificacao/regras";
import { sugerirPendentes, type ResultadoSugestao } from "@/lib/classificacao/pipeline";
import {
  alterarIgnorada, baixarTituloPorTransacao, classificarTransacao, desfazerConciliacao as desfazer, inserirRegra, reclassificarTransacao,
  transferirEntreContas,
} from "@/lib/conciliacao";
import { cents, fmtData, fromCents, parseValorBR, somenteDigitos } from "@/lib/format";
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

const novaRegraSchema = z
  .object({
    nome: z.string().trim().min(1, "Informe o nome da regra."),
    tipoMatch: z.enum(["memo_contem", "documento", "valor_exato"], "Selecione o tipo da regra."),
    padrao: z.string().trim().min(1, "Informe o padrão da regra."),
    sinal: z.enum(["entrada", "saida", "qualquer"], "Selecione o sinal da regra."),
  })
  .optional()
  .refine((r) => r?.tipoMatch !== "valor_exato" || valorDoPadrao(r.padrao) > 0, "Para valor exato, o padrão deve ser um valor maior que zero.")
  .refine((r) => r?.tipoMatch !== "documento" || !!somenteDigitos(r.padrao), "Para documento, o padrão deve conter os dígitos do CPF/CNPJ.");

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
  criarRegra: novaRegraSchema,
});
export type ClassificacaoInput = z.input<typeof classificacaoSchema>;

export async function aprovarClassificacao(empresaId: string, input: ClassificacaoInput): Promise<EstadoForm> {
  const r = classificacaoSchema.safeParse(input);
  if (!r.success) return { erro: r.error.issues[0].message };
  return executar(empresaId, (usuarioId) => db.transaction((tx) => classificarTransacao(tx, { ...r.data, empresaId, usuarioId })));
}

const reclassificacaoSchema = classificacaoSchema.omit({ criarRegra: true });
export type ReclassificacaoInput = z.input<typeof reclassificacaoSchema>;

/** Estorna o lançamento da conciliação (hoje) e cria o novo na data do extrato (hoje se o mês estiver fechado). */
export async function reclassificar(empresaId: string, input: ReclassificacaoInput): Promise<EstadoForm & { aviso?: string }> {
  const r = reclassificacaoSchema.safeParse(input);
  if (!r.success) return { erro: r.error.issues[0].message };
  const fora: { data?: string | null } = {};
  const res = await executar(empresaId, async (usuarioId) => {
    fora.data = await db.transaction((tx) => reclassificarTransacao(tx, { ...r.data, empresaId, usuarioId }));
  });
  return fora.data ? { ...res, aviso: `Mês fechado: lançado por estorno em ${fmtData(fora.data)}.` } : res;
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

/** Cada transação na sua própria transação do banco; o par de uma transferência é desfeito junto. */
export async function desfazerEmLote(empresaId: string, transacaoIds: string[]): Promise<{ desfeitas: number; erros: string[] }> {
  const user = await requireUser();
  const ids = z.array(z.uuid()).safeParse(transacaoIds);
  if (!ids.success || !ids.data.length) return { desfeitas: 0, erros: ["Nenhuma transação selecionada."] };
  const txs = await db
    .select({ id: transacoesBancarias.id, memo: transacoesBancarias.memo, lancamentoId: transacoesBancarias.lancamentoId })
    .from(transacoesBancarias)
    .innerJoin(contasBancarias, eq(contasBancarias.id, transacoesBancarias.contaBancariaId))
    .where(and(eq(contasBancarias.empresaId, empresaId), inArray(transacoesBancarias.id, ids.data)));
  let desfeitas = 0;
  const erros: string[] = [];
  const feitos = new Set<string>();
  for (const t of txs) {
    if (t.lancamentoId && feitos.has(t.lancamentoId)) continue;
    try {
      await db.transaction((tx) => desfazer(tx, empresaId, t.id, user.id));
      if (t.lancamentoId) feitos.add(t.lancamentoId);
      desfeitas++;
    } catch (e) {
      erros.push(`${t.memo.slice(0, 40) || t.id.slice(0, 8)}: ${msg(e)}`);
    }
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  return { desfeitas, erros };
}

/**
 * Aprova sugestões de regra, transferência e IA; cada transação na sua própria transação do banco.
 * `minConfiancaIa`: sugestões de IA abaixo do limite ficam pendentes e entram em `puladas`.
 */
export async function aprovarEmLote(
  empresaId: string,
  transacaoIds: string[],
  opcoes: { minConfiancaIa?: number } = {},
): Promise<{ aprovadas: number; puladas: number; erros: string[] }> {
  const user = await requireUser();
  const ids = z.array(z.uuid()).safeParse(transacaoIds);
  if (!ids.success || !ids.data.length) return { aprovadas: 0, puladas: 0, erros: ["Nenhuma transação selecionada."] };
  const min = z.number().min(0).max(1).optional().safeParse(opcoes.minConfiancaIa);
  if (!min.success) return { aprovadas: 0, puladas: 0, erros: ["Confiança mínima inválida."] };
  const txs = await db
    .select({
      id: transacoesBancarias.id, memo: transacoesBancarias.memo, valor: transacoesBancarias.valor,
      sugestaoOrigem: transacoesBancarias.sugestaoOrigem, sugestaoContaId: transacoesBancarias.sugestaoContaId,
      sugestaoHistorico: transacoesBancarias.sugestaoHistorico, transferenciaParId: transacoesBancarias.transferenciaParId,
      sugestaoConfianca: transacoesBancarias.sugestaoConfianca,
    })
    .from(transacoesBancarias)
    .innerJoin(contasBancarias, eq(contasBancarias.id, transacoesBancarias.contaBancariaId))
    .where(and(eq(contasBancarias.empresaId, empresaId), inArray(transacoesBancarias.id, ids.data)));

  let aprovadas = 0;
  let puladas = 0;
  const erros: string[] = [];
  const feitas = new Set<string>();
  for (const t of txs) {
    if (feitas.has(t.id)) continue;
    if (t.sugestaoOrigem === "ia" && min.data !== undefined && Number(t.sugestaoConfianca ?? 0) < min.data) {
      puladas++;
      continue;
    }
    try {
      if ((t.sugestaoOrigem === "regra" || t.sugestaoOrigem === "ia") && t.sugestaoContaId) {
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
        throw new Error("Sem sugestão para aprovar");
      }
      feitas.add(t.id);
      aprovadas++;
    } catch (e) {
      erros.push(`${t.memo.slice(0, 40) || t.id.slice(0, 8)}: ${msg(e)}`);
    }
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  return { aprovadas, puladas, erros };
}

const loteSchema = z.object({
  transacaoIds: z.array(z.uuid()).min(1, "Nenhuma transação selecionada."),
  contaId: z.uuid("Selecione a contrapartida."),
  historicoTemplate: z.string().trim().min(1, "Informe o histórico."),
  documento: z.string().trim().nullish().transform((s) => s || null),
  competencia: z.string().regex(/^\d{4}-\d{2}$/, "Competência inválida.").nullish(),
  criarRegra: novaRegraSchema,
});
export type ClassificacaoLoteInput = z.input<typeof loteSchema>;

/** Mesma contrapartida para várias transações do mesmo sinal; cada uma na sua própria transação do banco. */
export async function classificarEmLote(empresaId: string, input: ClassificacaoLoteInput): Promise<{ aprovadas: number; erros: string[] }> {
  const user = await requireUser();
  const r = loteSchema.safeParse(input);
  if (!r.success) return { aprovadas: 0, erros: [r.error.issues[0].message] };
  const { transacaoIds, contaId, historicoTemplate, documento, competencia, criarRegra } = r.data;
  const encontradas = await db
    .select({
      id: transacoesBancarias.id, memo: transacoesBancarias.memo, valor: transacoesBancarias.valor,
      data: transacoesBancarias.data, status: transacoesBancarias.status,
    })
    .from(transacoesBancarias)
    .innerJoin(contasBancarias, eq(contasBancarias.id, transacoesBancarias.contaBancariaId))
    .where(and(eq(contasBancarias.empresaId, empresaId), inArray(transacoesBancarias.id, transacaoIds)));
  const porId = new Map(encontradas.map((t) => [t.id, t]));
  const txs = [...new Set(transacaoIds)].flatMap((id) => porId.get(id) ?? []);
  if (!txs.length) return { aprovadas: 0, erros: ["Nenhuma transação encontrada."] };

  if (criarRegra) {
    try {
      await db.transaction((tx) => inserirRegra(tx, empresaId, criarRegra, contaId, historicoTemplate));
    } catch (e) {
      return { aprovadas: 0, erros: [`Regra: ${msg(e)}`] };
    }
  }

  const entrada = cents(txs[0].valor) > 0;
  let aprovadas = 0;
  const erros: string[] = [];
  for (const t of txs) {
    try {
      if (t.status !== "pendente") throw new Error("Transação não está mais pendente");
      if (cents(t.valor) > 0 !== entrada) throw new Error(entrada ? "Não é entrada" : "Não é saída");
      await db.transaction((tx) =>
        classificarTransacao(tx, {
          empresaId, transacaoId: t.id, usuarioId: user.id, documento,
          partidas: [{ contaId, valor: fromCents(Math.abs(cents(t.valor))) }],
          historico: aplicarTemplate(historicoTemplate, t).trim() || "Conciliação bancária",
          competencia: competencia ? `${competencia}-01` : undefined,
        }),
      );
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
