import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db";
import { contasBancarias, fechamentos, lancamentos, planoContas, regras, titulos, transacoesBancarias } from "@/db/schema";
import { cents, fmtCompetencia, fromCents, hoje, primeiroDiaDoMes } from "./format";
import { criarLancamento, estornarLancamento, type PartidaInput } from "./lancamentos";
import { baixarTitulo } from "./titulos";

export type Contrapartida = { contaId: string; valor: string };
export type NovaRegra = {
  nome: string; tipoMatch: "memo_contem" | "documento" | "valor_exato"; padrao: string; sinal: "entrada" | "saida" | "qualquer";
};

/**
 * Partidas da conciliação: entrada → D banco |valor| / C contrapartidas;
 * saída → D contrapartidas / C banco. Σ contrapartidas precisa ser |valor| (centavos).
 */
export function partidasClassificacao(valorTx: string, contaBancoId: string, contras: Contrapartida[]): PartidaInput[] {
  if (!contras.length) throw new Error("Informe ao menos uma contrapartida");
  const total = Math.abs(cents(valorTx));
  let soma = 0;
  for (const c of contras) {
    const v = cents(c.valor);
    if (!(v > 0)) throw new Error("Cada contrapartida precisa de valor maior que zero");
    if (c.contaId === contaBancoId) throw new Error("A contrapartida não pode ser a própria conta do banco");
    soma += v;
  }
  if (soma !== total) throw new Error(`Soma das contrapartidas (${fromCents(soma)}) difere do valor da transação (${fromCents(total)})`);
  const banco = fromCents(total);
  const entrada = cents(valorTx) > 0;
  const lados = contras.map((c) => (entrada ? { contaId: c.contaId, credito: c.valor } : { contaId: c.contaId, debito: c.valor }));
  return entrada ? [{ contaId: contaBancoId, debito: banco }, ...lados] : [...lados, { contaId: contaBancoId, credito: banco }];
}

/** Transação da empresa com a conta contábil do banco, travada para a transação do Postgres. */
async function travar(tx: Tx, empresaId: string, transacaoId: string) {
  const [t] = await tx
    .select({
      id: transacoesBancarias.id, contaBancariaId: transacoesBancarias.contaBancariaId, data: transacoesBancarias.data,
      valor: transacoesBancarias.valor, memo: transacoesBancarias.memo, status: transacoesBancarias.status,
      lancamentoId: transacoesBancarias.lancamentoId, contaBanco: contasBancarias.contaContabilId,
    })
    .from(transacoesBancarias)
    .innerJoin(contasBancarias, eq(contasBancarias.id, transacoesBancarias.contaBancariaId))
    .where(and(eq(transacoesBancarias.id, transacaoId), eq(contasBancarias.empresaId, empresaId)))
    .for("update", { of: transacoesBancarias });
  if (!t) throw new Error("Transação não encontrada");
  return t;
}

async function travarPendente(tx: Tx, empresaId: string, transacaoId: string) {
  const t = await travar(tx, empresaId, transacaoId);
  if (t.status !== "pendente") throw new Error("Transação não está pendente (já conciliada ou ignorada)");
  return t;
}

/** Contas analíticas ativas da empresa. */
async function exigirContas(tx: Tx, empresaId: string, ids: string[]) {
  const unicos = [...new Set(ids)];
  const ok = await tx
    .select({ id: planoContas.id })
    .from(planoContas)
    .where(and(inArray(planoContas.id, unicos), eq(planoContas.empresaId, empresaId), eq(planoContas.tipo, "analitica"), eq(planoContas.ativa, true)));
  if (ok.length !== unicos.length) throw new Error("Conta inválida: use contas analíticas ativas desta empresa");
}

const marcar = (tx: Tx, id: string, set: Partial<typeof transacoesBancarias.$inferInsert>) =>
  tx.update(transacoesBancarias).set(set).where(eq(transacoesBancarias.id, id));

export async function classificarTransacao(tx: Tx, input: {
  empresaId: string; transacaoId: string; partidas: Contrapartida[]; historico: string; documento?: string | null;
  competencia?: string; criarRegra?: NovaRegra; usuarioId?: string | null;
  /** Só a reclassificação: data do novo lançamento (hoje, se o mês do extrato fechou), competência do extrato. */
  data?: string;
}) {
  const t = await travarPendente(tx, input.empresaId, input.transacaoId);
  await exigirContas(tx, input.empresaId, input.partidas.map((p) => p.contaId));
  const l = await criarLancamento(tx, {
    empresaId: input.empresaId, data: input.data ?? t.data, dataPagamento: t.data,
    competencia: input.competencia ?? primeiroDiaDoMes(t.data),
    historico: input.historico, documento: input.documento ?? null, origem: "conciliacao", usuarioId: input.usuarioId,
    partidas: partidasClassificacao(t.valor, t.contaBanco, input.partidas),
  });
  await marcar(tx, t.id, { status: "classificada", lancamentoId: l.id });
  if (input.criarRegra) await inserirRegra(tx, input.empresaId, input.criarRegra, input.partidas[0].contaId, input.historico);
  return l;
}

export async function inserirRegra(tx: Tx, empresaId: string, regra: NovaRegra, contaId: string, historicoTemplate: string) {
  await exigirContas(tx, empresaId, [contaId]);
  await tx.insert(regras).values({ empresaId, ...regra, contaId, historicoTemplate });
}

export async function baixarTituloPorTransacao(tx: Tx, input: {
  empresaId: string; transacaoId: string; tituloId: string; contaDiferencaId?: string | null; usuarioId?: string | null;
}) {
  const t = await travarPendente(tx, input.empresaId, input.transacaoId);
  const [tit] = await tx.select({ tipo: titulos.tipo }).from(titulos)
    .where(and(eq(titulos.id, input.tituloId), eq(titulos.empresaId, input.empresaId)));
  if (!tit) throw new Error("Título não encontrado");
  const entrada = cents(t.valor) > 0;
  if ((tit.tipo === "receber") !== entrada)
    throw new Error(entrada ? "Entrada só baixa título a receber" : "Saída só baixa título a pagar");
  if (input.contaDiferencaId) await exigirContas(tx, input.empresaId, [input.contaDiferencaId]);
  const l = await baixarTitulo(tx, {
    empresaId: input.empresaId, tituloId: input.tituloId, contaBancariaContabilId: t.contaBanco,
    valorPago: fromCents(Math.abs(cents(t.valor))), data: t.data, contaDiferencaId: input.contaDiferencaId, usuarioId: input.usuarioId,
  });
  await marcar(tx, t.id, { status: "classificada", lancamentoId: l.id });
  return l;
}

/** Um lançamento D banco destino / C banco origem, ligado às duas transações. */
export async function transferirEntreContas(tx: Tx, input: {
  empresaId: string; transacaoId: string; parId: string; usuarioId?: string | null;
}) {
  if (input.transacaoId === input.parId) throw new Error("Escolha outra transação como par");
  // trava em ordem de id para não dar deadlock com a aprovação simultânea do par
  const [x, y] = [input.transacaoId, input.parId].sort();
  const a = await travarPendente(tx, input.empresaId, x);
  const b = await travarPendente(tx, input.empresaId, y);
  if (a.contaBancariaId === b.contaBancariaId) throw new Error("As transações precisam ser de contas bancárias diferentes");
  const va = cents(a.valor);
  if (va === 0 || va + cents(b.valor) !== 0) throw new Error("As transações precisam ter valores opostos");
  const [origem, destino] = va < 0 ? [a, b] : [b, a];
  const v = fromCents(Math.abs(va));
  // ponytail: data da saída; se o crédito cair em outro dia, a conferência do destino fica 1 dia defasada
  const l = await criarLancamento(tx, {
    empresaId: input.empresaId, data: origem.data, dataPagamento: origem.data, historico: "Transferência entre contas",
    origem: "conciliacao", usuarioId: input.usuarioId,
    partidas: [{ contaId: destino.contaBanco, debito: v }, { contaId: origem.contaBanco, credito: v }],
  });
  await marcar(tx, a.id, { status: "transferencia", lancamentoId: l.id, transferenciaParId: b.id });
  await marcar(tx, b.id, { status: "transferencia", lancamentoId: l.id, transferenciaParId: a.id });
  return l;
}

/**
 * Estorna o lançamento no dia dele (hoje, se o mês fechou), devolve a(s) transação(ões) a pendente e reabre título
 * baixado por ele. Retorna a data do estorno.
 */
export async function desfazerConciliacao(
  tx: Tx, empresaId: string, transacaoId: string, usuarioId?: string | null, acao = "desfazer",
) {
  const t = await travar(tx, empresaId, transacaoId);
  if (!t.lancamentoId || (t.status !== "classificada" && t.status !== "transferencia"))
    throw new Error("Transação não está conciliada");
  const lancId = t.lancamentoId;
  const [orig] = await tx.select({ data: lancamentos.data }).from(lancamentos).where(eq(lancamentos.id, lancId));
  const data = dataNoMesAberto(orig.data, hoje(), await mesesFechados(tx, empresaId), acao);
  await tx.select({ id: transacoesBancarias.id }).from(transacoesBancarias)
    .where(eq(transacoesBancarias.lancamentoId, lancId)).for("update");
  await estornarLancamento(tx, lancId, data, usuarioId);
  await tx.update(transacoesBancarias).set({
    status: "pendente", lancamentoId: null, transferenciaParId: null, sugestaoContaId: null, sugestaoConfianca: null,
    sugestaoOrigem: null, sugestaoRegraId: null, sugestaoHistorico: null, sugestaoJustificativa: null,
  }).where(eq(transacoesBancarias.lancamentoId, lancId));
  await tx.update(titulos).set({ status: "aberto", baixaLancamentoId: null }).where(eq(titulos.baixaLancamentoId, lancId));
  return data;
}

/** pendente ↔ ignorada. */
export async function alterarIgnorada(tx: Tx, empresaId: string, transacaoId: string, ignorar: boolean, motivo?: string | null) {
  const t = await travar(tx, empresaId, transacaoId);
  if (t.status !== (ignorar ? "pendente" : "ignorada"))
    throw new Error(ignorar ? "Só transações pendentes podem ser ignoradas" : "Transação não está ignorada");
  await marcar(tx, t.id, { status: ignorar ? "ignorada" : "pendente", sugestaoJustificativa: ignorar ? motivo || null : null });
}

/** Competências fechadas da empresa (mesma regra do trigger `periodo_fechado`). */
async function mesesFechados(tx: Tx, empresaId: string) {
  const fs = await tx.select({ c: fechamentos.competencia }).from(fechamentos).where(eq(fechamentos.empresaId, empresaId));
  return new Set(fs.map((f) => f.c));
}

/**
 * A própria data se o mês está aberto (estorno e novo lançamento no mês do original, sem contar em dobro);
 * senão hoje; hoje também fechado → erro claro em vez da mensagem do trigger.
 */
export function dataNoMesAberto(data: string, hoje: string, fechados: ReadonlySet<string>, acao: string) {
  if (!fechados.has(primeiroDiaDoMes(data))) return data;
  if (fechados.has(primeiroDiaDoMes(hoje))) throw new Error(`Reabra o mês ${fmtCompetencia(hoje)} em Fechamento para ${acao}`);
  return hoje;
}

/**
 * Estorna e classifica de novo, na mesma transação do Postgres: estorno na data do original e novo lançamento na
 * do extrato; mês fechado vai para hoje, com a competência do extrato. Retorna as datas se alguma saiu do lugar.
 */
export async function reclassificarTransacao(tx: Tx, input: {
  empresaId: string; transacaoId: string; partidas: Contrapartida[]; historico: string; documento?: string | null;
  competencia?: string; usuarioId?: string | null;
}) {
  const t = await travar(tx, input.empresaId, input.transacaoId);
  if (t.status !== "classificada" || !t.lancamentoId) throw new Error("Só transações classificadas podem ser reclassificadas");
  const [baixa] = await tx.select({ id: titulos.id }).from(titulos).where(eq(titulos.baixaLancamentoId, t.lancamentoId)).limit(1);
  if (baixa) throw new Error("Transação baixou um título: desfaça a conciliação em vez de reclassificar");
  const data = dataNoMesAberto(t.data, hoje(), await mesesFechados(tx, input.empresaId), "reclassificar");
  const estorno = await desfazerConciliacao(tx, input.empresaId, input.transacaoId, input.usuarioId, "reclassificar");
  await classificarTransacao(tx, { ...input, data });
  return data === t.data ? null : { extrato: t.data, novo: data, estorno };
}

type PartidaConciliada = { transacaoId: string; contaId: string | null; codigo: string | null; nome: string | null; debito: string | null; credito: string | null };
export type ContraConciliada = { contaId: string; codigo: string; nome: string; valor: string };

/** Linhas (uma por contrapartida, na ordem da consulta) → uma por transação, com o valor de cada contrapartida. */
export function agruparContrapartidas<T extends PartidaConciliada>(linhas: T[]) {
  const porTx = new Map<string, Omit<T, "contaId" | "codigo" | "nome" | "debito" | "credito"> & { contras: ContraConciliada[] }>();
  for (const { contaId, codigo, nome, debito, credito, ...resto } of linhas) {
    let item = porTx.get(resto.transacaoId);
    if (!item) porTx.set(resto.transacaoId, (item = { ...resto, contras: [] }));
    if (contaId) item.contras.push({ contaId, codigo: codigo ?? "", nome: nome ?? "", valor: fromCents(Math.abs(cents(debito ?? 0) - cents(credito ?? 0))) });
  }
  return [...porTx.values()];
}
