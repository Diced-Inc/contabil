import { and, asc, count, desc, eq, gte, ilike, inArray, lte, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { contasBancarias, lancamentos, partidas, planoContas, titulos, transacoesBancarias } from "@/db/schema";
import { agruparContrapartidas } from "@/lib/conciliacao";
import { escapeLike } from "@/lib/format";

export type TransacaoLinha = Awaited<ReturnType<typeof listarTransacoes>>[number];
export type TituloAberto = Awaited<ReturnType<typeof listarTitulosAbertos>>[number];
export type ConciliadaLinha = Awaited<ReturnType<typeof listarConciliadas>>[number];

/** Transações da empresa no status pedido, com conta bancária e conta sugerida. */
export function listarTransacoes(empresaId: string, status: "pendente" | "ignorada") {
  return db
    .select({
      id: transacoesBancarias.id,
      contaBancariaId: transacoesBancarias.contaBancariaId,
      contaBancariaNome: contasBancarias.nome,
      data: transacoesBancarias.data,
      valor: transacoesBancarias.valor,
      memo: transacoesBancarias.memo,
      sugestaoContaId: transacoesBancarias.sugestaoContaId,
      sugestaoCodigo: planoContas.codigo,
      sugestaoNome: planoContas.nome,
      sugestaoOrigem: transacoesBancarias.sugestaoOrigem,
      sugestaoConfianca: transacoesBancarias.sugestaoConfianca,
      sugestaoHistorico: transacoesBancarias.sugestaoHistorico,
      sugestaoJustificativa: transacoesBancarias.sugestaoJustificativa,
      transferenciaParId: transacoesBancarias.transferenciaParId,
    })
    .from(transacoesBancarias)
    .innerJoin(contasBancarias, eq(contasBancarias.id, transacoesBancarias.contaBancariaId))
    .leftJoin(planoContas, eq(planoContas.id, transacoesBancarias.sugestaoContaId))
    .where(and(eq(contasBancarias.empresaId, empresaId), eq(transacoesBancarias.status, status)))
    .orderBy(asc(transacoesBancarias.data), asc(transacoesBancarias.valor));
}

export function listarContasBancarias(empresaId: string) {
  return db
    .select({ id: contasBancarias.id, nome: contasBancarias.nome })
    .from(contasBancarias)
    .where(eq(contasBancarias.empresaId, empresaId))
    .orderBy(asc(contasBancarias.nome));
}

export function listarTitulosAbertos(empresaId: string) {
  return db
    .select({
      id: titulos.id, tipo: titulos.tipo, contraparte: titulos.contraparte, descricao: titulos.descricao,
      documento: titulos.documento, valor: titulos.valor, vencimento: titulos.vencimento,
    })
    .from(titulos)
    .where(and(eq(titulos.empresaId, empresaId), eq(titulos.status, "aberto")))
    .orderBy(asc(titulos.vencimento), asc(titulos.competencia));
}

/** Transação conciliada que aponta para o lançamento (para "Desfazer conciliação" no detalhe). */
export async function transacaoDoLancamento(lancamentoId: string) {
  const [t] = await db
    .select({ id: transacoesBancarias.id })
    .from(transacoesBancarias)
    .where(and(eq(transacoesBancarias.lancamentoId, lancamentoId), inArray(transacoesBancarias.status, ["classificada", "transferencia"])))
    .limit(1);
  return t?.id;
}

const conciliada = inArray(transacoesBancarias.status, ["classificada", "transferencia"]);

type FiltroConciliadas = { conta: string; de: string; ate: string; q: string };
const filtroConciliadas = (empresaId: string, f: FiltroConciliadas) => and(
  eq(contasBancarias.empresaId, empresaId), conciliada,
  f.conta ? eq(transacoesBancarias.contaBancariaId, f.conta) : undefined,
  f.de ? gte(transacoesBancarias.data, f.de) : undefined,
  f.ate ? lte(transacoesBancarias.data, f.ate) : undefined,
  f.q ? ilike(transacoesBancarias.memo, `%${escapeLike(f.q)}%`) : undefined,
);

/** Mesmo filtro da lista (`listarConciliadas`). */
export async function contarConciliadas(empresaId: string, f: FiltroConciliadas) {
  const [r] = await db
    .select({ n: count() })
    .from(transacoesBancarias)
    .innerJoin(contasBancarias, eq(contasBancarias.id, transacoesBancarias.contaBancariaId))
    .where(filtroConciliadas(empresaId, f));
  return r.n;
}

const par = alias(transacoesBancarias, "par");
const parConta = alias(contasBancarias, "par_conta");

/** Conciliadas com o lançamento, as contrapartidas (classificada), a conta do par (transferência) e se baixou título. */
export async function listarConciliadas(empresaId: string, f: FiltroConciliadas) {
  const linhas = await db
    .select({
      transacaoId: transacoesBancarias.id,
      contaBancariaNome: contasBancarias.nome,
      data: transacoesBancarias.data,
      valor: transacoesBancarias.valor,
      memo: transacoesBancarias.memo,
      status: transacoesBancarias.status,
      lancamentoId: lancamentos.id,
      numero: lancamentos.numero,
      historico: lancamentos.historico,
      documento: lancamentos.documento,
      competencia: lancamentos.competencia,
      parContaNome: parConta.nome,
      baixaTitulo: sql<boolean>`exists (select 1 from titulos tb where tb.baixa_lancamento_id = ${lancamentos.id})`,
      contaId: partidas.contaId,
      codigo: planoContas.codigo,
      nome: planoContas.nome,
      debito: partidas.debito,
      credito: partidas.credito,
    })
    .from(transacoesBancarias)
    .innerJoin(contasBancarias, eq(contasBancarias.id, transacoesBancarias.contaBancariaId))
    .innerJoin(lancamentos, eq(lancamentos.id, transacoesBancarias.lancamentoId))
    .leftJoin(partidas, and(
      eq(partidas.lancamentoId, lancamentos.id), ne(partidas.contaId, contasBancarias.contaContabilId), eq(transacoesBancarias.status, "classificada"),
    ))
    .leftJoin(planoContas, eq(planoContas.id, partidas.contaId))
    .leftJoin(par, eq(par.id, transacoesBancarias.transferenciaParId))
    .leftJoin(parConta, eq(parConta.id, par.contaBancariaId))
    .where(filtroConciliadas(empresaId, f))
    .orderBy(desc(transacoesBancarias.data), asc(transacoesBancarias.valor), asc(transacoesBancarias.id), asc(partidas.ordem));
  return agruparContrapartidas(linhas);
}
