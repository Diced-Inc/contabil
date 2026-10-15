import { and, asc, desc, eq, like, sql } from "drizzle-orm";
import { db } from "@/db";
import { contasBancarias, importacoes, lancamentos, partidas, planoContas, transacoesBancarias } from "@/db/schema";
import { cents, fromCents } from "@/lib/format";

/** Conta bancária da empresa (ou undefined). */
export async function getContaBancaria(empresaId: string, contaBancariaId: string) {
  const [c] = await db
    .select()
    .from(contasBancarias)
    .where(and(eq(contasBancarias.id, contaBancariaId), eq(contasBancarias.empresaId, empresaId)));
  return c;
}

const filtroContaAtivo = (empresaId: string) =>
  and(
    eq(planoContas.empresaId, empresaId),
    eq(planoContas.tipo, "analitica"),
    eq(planoContas.ativa, true),
    like(planoContas.codigo, "1%"),
  );

/** Analíticas ativas da classe 1 — as que podem representar uma conta bancária. */
export function listarContasAtivoAnaliticas(empresaId: string) {
  return db
    .select({ id: planoContas.id, codigo: planoContas.codigo, nome: planoContas.nome })
    .from(planoContas)
    .where(filtroContaAtivo(empresaId))
    .orderBy(asc(planoContas.codigo));
}

export async function contaAtivoAnaliticaValida(empresaId: string, contaId: string) {
  const [c] = await db
    .select({ id: planoContas.id })
    .from(planoContas)
    .where(and(eq(planoContas.id, contaId), filtroContaAtivo(empresaId)));
  return !!c;
}

export type ContaComSaldo = Awaited<ReturnType<typeof listarContasComSaldo>>[number];

/**
 * Conferência de saldo por conta bancária, na data do OFX com saldo mais recente:
 * diferenca = saldoOfx − saldoContabil − pendentes − ignoradas (0 quando tudo conciliado).
 */
export async function listarContasComSaldo(empresaId: string) {
  const ult = db
    .selectDistinctOn([importacoes.contaBancariaId], {
      contaBancariaId: importacoes.contaBancariaId,
      saldoFinal: importacoes.saldoFinal,
      dataSaldo: importacoes.dataSaldo,
      importadoEm: importacoes.createdAt,
    })
    .from(importacoes)
    .orderBy(importacoes.contaBancariaId, sql`${importacoes.dataSaldo} desc nulls last`, desc(importacoes.createdAt))
    .as("ult");

  const linhas = await db
    .select({
      id: contasBancarias.id,
      nome: contasBancarias.nome,
      banco: contasBancarias.banco,
      agencia: contasBancarias.agencia,
      numero: contasBancarias.numero,
      ofxBankid: contasBancarias.ofxBankid,
      ofxAcctid: contasBancarias.ofxAcctid,
      ativa: contasBancarias.ativa,
      contaContabilId: contasBancarias.contaContabilId,
      contaCodigo: planoContas.codigo,
      contaNome: planoContas.nome,
      saldoOfx: ult.saldoFinal,
      dataSaldo: ult.dataSaldo,
      importadoEm: ult.importadoEm,
      saldoContabil: sql<string | null>`(
        select coalesce(sum(${partidas.debito} - ${partidas.credito}), 0)::text
        from ${partidas} inner join ${lancamentos} on ${lancamentos.id} = ${partidas.lancamentoId}
        where ${partidas.contaId} = ${contasBancarias.contaContabilId} and ${lancamentos.data} <= ${ult.dataSaldo}
      )`,
      pendentes: sql<string | null>`(
        select coalesce(sum(${transacoesBancarias.valor}), 0)::text
        from ${transacoesBancarias}
        where ${transacoesBancarias.contaBancariaId} = ${contasBancarias.id}
          and ${transacoesBancarias.status} = 'pendente' and ${transacoesBancarias.data} <= ${ult.dataSaldo}
      )`,
      ignoradas: sql<string | null>`(
        select coalesce(sum(${transacoesBancarias.valor}), 0)::text
        from ${transacoesBancarias}
        where ${transacoesBancarias.contaBancariaId} = ${contasBancarias.id}
          and ${transacoesBancarias.status} = 'ignorada' and ${transacoesBancarias.data} <= ${ult.dataSaldo}
      )`,
    })
    .from(contasBancarias)
    .innerJoin(planoContas, eq(planoContas.id, contasBancarias.contaContabilId))
    .leftJoin(ult, eq(ult.contaBancariaId, contasBancarias.id))
    .where(eq(contasBancarias.empresaId, empresaId))
    .orderBy(asc(contasBancarias.nome));

  return linhas.map((l) => {
    const temData = l.dataSaldo !== null;
    const saldoContabil = temData ? cents(l.saldoContabil ?? 0) : null;
    const pendentes = temData ? cents(l.pendentes ?? 0) : null;
    const ignoradas = temData ? cents(l.ignoradas ?? 0) : null;
    const saldoOfx = temData && l.saldoOfx !== null ? cents(l.saldoOfx) : null;
    const diferenca = saldoOfx !== null ? saldoOfx - saldoContabil! - pendentes! - ignoradas! : null;
    const s = (c: number | null) => (c === null ? null : fromCents(c));
    return {
      ...l,
      saldoOfx: s(saldoOfx),
      saldoContabil: s(saldoContabil),
      pendentes: s(pendentes),
      ignoradas: s(ignoradas),
      diferenca: s(diferenca),
    };
  });
}

/** Importações de todas as contas bancárias da empresa, mais recentes primeiro. */
export function listarImportacoes(empresaId: string) {
  return db
    .select({
      id: importacoes.id,
      contaBancariaId: importacoes.contaBancariaId,
      nomeArquivo: importacoes.nomeArquivo,
      periodoInicio: importacoes.periodoInicio,
      periodoFim: importacoes.periodoFim,
      qtdTransacoes: importacoes.qtdTransacoes,
      qtdNovas: importacoes.qtdNovas,
      createdAt: importacoes.createdAt,
    })
    .from(importacoes)
    .innerJoin(contasBancarias, eq(contasBancarias.id, importacoes.contaBancariaId))
    .where(eq(contasBancarias.empresaId, empresaId))
    .orderBy(desc(importacoes.createdAt));
}
