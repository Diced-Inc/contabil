import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { contasBancarias, planoContas, titulos, transacoesBancarias } from "@/db/schema";

export type TransacaoLinha = Awaited<ReturnType<typeof listarTransacoes>>[number];
export type TituloAberto = Awaited<ReturnType<typeof listarTitulosAbertos>>[number];

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
