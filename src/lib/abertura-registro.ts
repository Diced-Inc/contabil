import { and, asc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { contasBancarias, empresas, importacoes, lancamentos, planoContas, transacoesBancarias } from "@/db/schema";
import { partidasAbertura, patrimonial, type SaldoConta } from "./abertura";
import { cents, fmtCompetencia, fmtData, primeiroDiaDoMes } from "./format";
import { criarLancamento, estornarLancamento, mesesFechados } from "./lancamentos";
import { contaPorPapel } from "./titulos";

type Exec = typeof db | Tx;

/**
 * Lançamento que não é a abertura nem o estorno de uma (o "movimento" da empresa). `l`: alias da tabela lancamentos
 * na consulta.
 */
export const foraDaAbertura = (l: string) => sql.raw(`NOT (${l}.origem = 'abertura' OR (${l}.origem = 'estorno' AND EXISTS (
  SELECT 1 FROM lancamentos ab WHERE ab.id = ${l}.estorno_de_id AND ab.origem = 'abertura')))`);

/** Abertura ativa (no máximo uma por empresa: salvarAbertura estorna a anterior). */
export function aberturaAtiva(exec: Exec, empresaId: string) {
  return exec.query.lancamentos.findFirst({
    where: and(eq(lancamentos.empresaId, empresaId), eq(lancamentos.origem, "abertura"), eq(lancamentos.status, "aprovado")),
    with: { partidas: true },
  });
}

/** Primeiro dia com movimento (lançamento fora da abertura ou transação do extrato), ou null. */
export async function primeiroMovimento(exec: Exec, empresaId: string) {
  const [r] = await exec.execute<{ d: string | null }>(sql`
    SELECT least(
      (SELECT min(least(l.data, l.competencia)) FROM lancamentos l WHERE l.empresa_id = ${empresaId} AND ${foraDaAbertura("l")}),
      (SELECT min(t.data) FROM transacoes_bancarias t JOIN contas_bancarias cb ON cb.id = t.conta_bancaria_id WHERE cb.empresa_id = ${empresaId})
    )::text AS d`);
  return r?.d ?? null;
}

export type ResultadoAbertura = { confirmar: string } | { lancamento: typeof lancamentos.$inferSelect; diferenca: number };

/**
 * Grava os saldos iniciais: um lançamento origem `abertura` na data (último dia antes do início). Com abertura ativa,
 * estorna a atual e cria a nova (as duas em mês aberto). Data depois de lançamentos já existentes pede `confirmar`.
 * `diferenca`: D ≠ C vai para Lucros/Prejuízos acumulados.
 */
export async function salvarAbertura(tx: Tx, p: {
  empresaId: string; data: string; saldos: SaldoConta[]; diferenca?: boolean; confirmar?: boolean; usuarioId?: string | null;
}): Promise<ResultadoAbertura> {
  // uma abertura ativa por empresa: duas gravações simultâneas esperam aqui
  await tx.select({ id: empresas.id }).from(empresas).where(eq(empresas.id, p.empresaId)).for("update");
  const ids = [...new Set(p.saldos.map((s) => s.contaId))];
  const contas = ids.length
    ? await tx.select({ id: planoContas.id, codigo: planoContas.codigo, nome: planoContas.nome }).from(planoContas)
      .where(and(eq(planoContas.empresaId, p.empresaId), inArray(planoContas.id, ids)))
    : [];
  const fora = contas.find((c) => !patrimonial(c.codigo));
  if (fora) throw new Error(`${fora.codigo} ${fora.nome}: saldo inicial só em conta patrimonial (Ativo, Passivo e PL)`);
  const dif = p.diferenca
    ? { lucrosId: (await contaPorPapel(tx, p.empresaId, "lucros_acumulados")).id, prejuizosId: (await contaPorPapel(tx, p.empresaId, "prejuizos_acumulados")).id }
    : null;
  const { partidas, diferenca } = partidasAbertura(p.saldos, dif);

  const fechados = await mesesFechados(tx, p.empresaId);
  const atual = await aberturaAtiva(tx, p.empresaId);
  for (const d of [p.data, atual?.data].filter((x): x is string => !!x))
    if (fechados.has(primeiroDiaDoMes(d))) throw new Error(`O mês ${fmtCompetencia(d)} está fechado: reabra-o em Fechamento para mudar os saldos iniciais`);
  if (!p.confirmar) {
    const [antes] = await tx.execute<{ n: number; d: string | null }>(sql`
      SELECT count(*)::int AS n, min(l.data)::text AS d FROM lancamentos l
      WHERE l.empresa_id = ${p.empresaId} AND (l.data < ${p.data} OR l.competencia < ${primeiroDiaDoMes(p.data)}) AND ${foraDaAbertura("l")}`);
    if (antes?.n)
      return { confirmar: `${antes.n} lançamento(s) antes de ${fmtData(p.data)} (o primeiro em ${fmtData(antes.d!)}): os saldos iniciais costumam ser do dia anterior ao primeiro movimento. Salvar mesmo assim?` };
  }
  if (atual) await estornarLancamento(tx, atual.id, atual.data, p.usuarioId);
  const lancamento = await criarLancamento(tx, {
    empresaId: p.empresaId, data: p.data, historico: `Saldos iniciais em ${fmtData(p.data)}`, origem: "abertura", usuarioId: p.usuarioId, partidas,
  });
  return { lancamento, diferenca };
}

/**
 * Por conta bancária: a conta contábil e o saldo do primeiro OFX com saldo, com os movimentos por dia (sem as
 * ignoradas), para conferir o saldo inicial do banco em qualquer data (saldoExtratoNaData).
 */
export async function extratosParaAbertura(empresaId: string) {
  const bancos = await db.select({ id: contasBancarias.id, nome: contasBancarias.nome, contaContabilId: contasBancarias.contaContabilId })
    .from(contasBancarias).where(and(eq(contasBancarias.empresaId, empresaId), eq(contasBancarias.ativa, true))).orderBy(asc(contasBancarias.nome));
  if (!bancos.length) return [];
  const [refs, dias] = await Promise.all([
    db.selectDistinctOn([importacoes.contaBancariaId], {
      contaBancariaId: importacoes.contaBancariaId, saldo: importacoes.saldoFinal, dataSaldo: importacoes.dataSaldo,
    }).from(importacoes)
      .where(and(inArray(importacoes.contaBancariaId, bancos.map((b) => b.id)), isNotNull(importacoes.saldoFinal), isNotNull(importacoes.dataSaldo)))
      .orderBy(importacoes.contaBancariaId, asc(importacoes.dataSaldo)),
    db.select({ contaBancariaId: transacoesBancarias.contaBancariaId, data: transacoesBancarias.data, valor: sql<string>`sum(${transacoesBancarias.valor})::text` })
      .from(transacoesBancarias)
      .where(and(inArray(transacoesBancarias.contaBancariaId, bancos.map((b) => b.id)), ne(transacoesBancarias.status, "ignorada")))
      .groupBy(transacoesBancarias.contaBancariaId, transacoesBancarias.data),
  ]);
  return bancos.map((b) => {
    const r = refs.find((x) => x.contaBancariaId === b.id);
    return {
      ...b,
      ref: r?.saldo && r.dataSaldo ? { saldo: cents(r.saldo), dataSaldo: r.dataSaldo } : null,
      dias: dias.filter((d) => d.contaBancariaId === b.id).map((d) => ({ data: d.data, valor: cents(d.valor) })),
    };
  });
}
export type ExtratoAbertura = Awaited<ReturnType<typeof extratosParaAbertura>>[number];
