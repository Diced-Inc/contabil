/** Adiantamentos no banco: registrar pela conciliação, compensar com o título e desfazer (regras em ./adiantamentos). */
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { adiantamentos, baixas, lancamentos, planoContas, titulos } from "@/db/schema";
import {
  CONTA_ADIANTAMENTO, mesmaContraparte, partidasAdiantamento, partidasCompensacao, tipoDaEntrada, tipoDoTitulo, valorCompensacao,
  type TipoAdiantamento,
} from "./adiantamentos";
import { contaSobDemanda } from "./conciliacao";
import { cents, fmtCompetencia, fromCents, hoje, primeiroDiaDoMes } from "./format";
import { criarLancamento, dataNoMesAberto, estornarLancamento, mesesFechados } from "./lancamentos";
import { acharConta } from "./tributos";
import { contaPorPapel, papelDo, recalcularStatus, somasBaixas } from "./titulos";

/** Conta do adiantamento (a do plano pelo nome, ou criada no grupo do seed). */
export async function contaAdiantamento(tx: Tx, empresaId: string, tipo: TipoAdiantamento) {
  const contas = await tx
    .select({ id: planoContas.id, codigo: planoContas.codigo, nome: planoContas.nome, papel: planoContas.papel })
    .from(planoContas)
    .where(and(eq(planoContas.empresaId, empresaId), eq(planoContas.tipo, "analitica"), eq(planoContas.ativa, true)));
  const alvo = CONTA_ADIANTAMENTO[tipo];
  return acharConta(contas, alvo) ?? (await contaSobDemanda(tx, empresaId, { paiCodigo: alvo.criar!.pai, nome: alvo.criar!.nome, natureza: alvo.criar!.natureza }));
}

/** Saldo (centavos) por adiantamento: valor − compensado. */
async function compensados(tx: Pick<Tx, "select">, ids: string[]) {
  if (!ids.length) return new Map<string, number>();
  const rs = await tx.select({ id: baixas.adiantamentoId, s: sql<string>`coalesce(sum(${baixas.valor}), 0)::text` })
    .from(baixas).where(inArray(baixas.adiantamentoId, ids)).groupBy(baixas.adiantamentoId);
  return new Map(rs.map((r) => [r.id!, cents(r.s)]));
}

/**
 * Lança o adiantamento da transação (entrada: de cliente; saída: a fornecedor) na data do extrato e guarda a
 * contraparte para a compensação. `travarPendente` e `marcar` vêm da conciliação (evita import circular).
 */
export async function registrarAdiantamento(tx: Tx, p: {
  empresaId: string; transacao: { id: string; data: string; valor: string; contaBanco: string };
  contraparte: string; documento?: string | null; historico: string; usuarioId?: string | null;
}) {
  const tipo = tipoDaEntrada(cents(p.transacao.valor) > 0);
  const conta = await contaAdiantamento(tx, p.empresaId, tipo);
  const valor = fromCents(Math.abs(cents(p.transacao.valor)));
  const l = await criarLancamento(tx, {
    empresaId: p.empresaId, data: p.transacao.data, dataPagamento: p.transacao.data, historico: p.historico,
    origem: "conciliacao", usuarioId: p.usuarioId, partidas: partidasAdiantamento(tipo, p.transacao.contaBanco, conta.id, valor),
  });
  await tx.insert(adiantamentos).values({
    empresaId: p.empresaId, tipo, contraparte: p.contraparte, contraparteDocumento: p.documento || null, valor, data: p.transacao.data,
    contaId: conta.id, lancamentoId: l.id, transacaoId: p.transacao.id, createdBy: p.usuarioId ?? null,
  });
  return l;
}

/**
 * Desfazer a conciliação do adiantamento: só sem compensação (senão o título perderia a baixa); apaga o registro, o
 * lançamento é estornado pela conciliação.
 */
export async function soltarAdiantamento(tx: Tx, lancamentoId: string) {
  const [a] = await tx.select({ id: adiantamentos.id }).from(adiantamentos).where(eq(adiantamentos.lancamentoId, lancamentoId)).for("update");
  if (!a) return;
  const [b] = await tx.select({ id: baixas.id }).from(baixas).where(eq(baixas.adiantamentoId, a.id)).limit(1);
  if (b) throw new Error("Este adiantamento já foi compensado com um título: desfaça a compensação em Títulos → Adiantamentos antes");
  await tx.delete(adiantamentos).where(eq(adiantamentos.id, a.id));
}

/**
 * Compensa o título com o adiantamento da mesma contraparte, na data do reconhecimento do título (mês aberto):
 * a receber D Adiantamentos de Clientes / C Clientes; a pagar D Fornecedores / C Adiantamentos a Fornecedores.
 * Vira uma baixa do título sem banco (baixas.adiantamento_id).
 */
export async function compensarAdiantamento(tx: Tx, p: {
  empresaId: string; tituloId: string; adiantamentoId: string; valor?: string | null; usuarioId?: string | null;
}) {
  // trava título e adiantamento (sempre nesta ordem)
  const [t] = await tx.select().from(titulos).where(and(eq(titulos.id, p.tituloId), eq(titulos.empresaId, p.empresaId))).for("update");
  if (!t) throw new Error("Título não encontrado");
  const [a] = await tx.select().from(adiantamentos).where(and(eq(adiantamentos.id, p.adiantamentoId), eq(adiantamentos.empresaId, p.empresaId))).for("update");
  if (!a) throw new Error("Adiantamento não encontrado");
  if (t.status !== "aberto" && t.status !== "parcial") throw new Error("Título não está em aberto");
  if (a.tipo !== tipoDoTitulo(t.tipo)) throw new Error(t.tipo === "receber" ? "Título a receber compensa adiantamento de cliente" : "Título a pagar compensa adiantamento a fornecedor");
  if (!mesmaContraparte(t, a)) throw new Error(`O adiantamento é de ${a.contraparte}, não de ${t.contraparte}`);
  const saldoTitulo = cents(t.valor) - ((await somasBaixas(tx, [t.id])).get(t.id) ?? 0);
  const saldoAdiant = cents(a.valor) - ((await compensados(tx, [a.id])).get(a.id) ?? 0);
  const v = valorCompensacao(saldoTitulo, saldoAdiant, p.valor ? cents(p.valor) : undefined);
  if ((await mesesFechados(tx, p.empresaId)).has(primeiroDiaDoMes(t.competencia)))
    throw new Error(`O mês ${fmtCompetencia(t.competencia)} (competência do título) está fechado: reabra-o em Fechamento para compensar`);
  const contaTitulo = t.contaId ?? (await contaPorPapel(tx, p.empresaId, papelDo(t.tipo))).id;
  const l = await criarLancamento(tx, {
    empresaId: p.empresaId, data: t.competencia, origem: "manual", usuarioId: p.usuarioId, documento: t.documento,
    historico: `Compensação de adiantamento ${a.tipo === "cliente" ? "de cliente" : "a fornecedor"}: ${t.contraparte} - ${t.descricao}`,
    partidas: partidasCompensacao(t.tipo, contaTitulo, a.contaId, fromCents(v)),
  });
  await tx.insert(baixas).values({ tituloId: t.id, transacaoId: null, lancamentoId: l.id, adiantamentoId: a.id, valor: fromCents(v), createdBy: p.usuarioId ?? null });
  await recalcularStatus(tx, [t.id]);
  return l;
}

/** Desfaz a compensação: estorna o lançamento (no mês dele, se aberto; senão hoje) e reabre o título. */
export async function desfazerCompensacao(tx: Tx, empresaId: string, lancamentoId: string, usuarioId?: string | null) {
  const bs = await tx.select({ tituloId: baixas.tituloId }).from(baixas)
    .innerJoin(titulos, eq(titulos.id, baixas.tituloId))
    .where(and(eq(baixas.lancamentoId, lancamentoId), isNotNull(baixas.adiantamentoId), eq(titulos.empresaId, empresaId)));
  if (!bs.length) throw new Error("Compensação não encontrada");
  await tx.select({ id: titulos.id }).from(titulos).where(inArray(titulos.id, bs.map((b) => b.tituloId))).orderBy(titulos.id).for("update");
  const [l] = await tx.select({ data: lancamentos.data }).from(lancamentos).where(eq(lancamentos.id, lancamentoId));
  await tx.delete(baixas).where(eq(baixas.lancamentoId, lancamentoId));
  await estornarLancamento(tx, lancamentoId, dataNoMesAberto(l.data, hoje(), await mesesFechados(tx, empresaId), "desfazer a compensação"), usuarioId);
  await recalcularStatus(tx, bs.map((b) => b.tituloId));
}

/** Adiantamentos da empresa com o saldo (centavos) e as compensações. */
export async function listarAdiantamentos(tx: Pick<Tx, "select">, empresaId: string) {
  const ads = await tx.select().from(adiantamentos).where(eq(adiantamentos.empresaId, empresaId)).orderBy(adiantamentos.data);
  const comp = await compensados(tx, ads.map((a) => a.id));
  return ads.map((a) => ({ ...a, saldo: cents(a.valor) - (comp.get(a.id) ?? 0) }));
}
