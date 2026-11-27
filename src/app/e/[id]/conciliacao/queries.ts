import { and, asc, count, desc, eq, gte, ilike, inArray, lte, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { contasBancarias, fechamentos, lancamentos, partidas, planoContas, titulos, transacoesBancarias } from "@/db/schema";
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
      sugestaoOperacao: transacoesBancarias.sugestaoOperacao,
      /** Conta contábil do banco: a prévia das partidas é montada no cliente. */
      contaContabilId: contasBancarias.contaContabilId,
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

const contaDoTitulo = alias(planoContas, "conta_do_titulo");

/**
 * Títulos aberto/parcial com o saldo em aberto (valor − baixas) e a conta patrimonial. `imposto`: a pagar fora de
 * Fornecedores (guia, parcelamento, imposto a recolher), que vai para a Baixa de imposto.
 */
export async function listarTitulosAbertos(empresaId: string) {
  const rs = await db
    .select({
      id: titulos.id, tipo: titulos.tipo, contraparte: titulos.contraparte, descricao: titulos.descricao,
      documento: titulos.documento, valor: titulos.valor, vencimento: titulos.vencimento, competencia: titulos.competencia,
      status: titulos.status, origem: titulos.origem, contaId: titulos.contaId, contaPapel: contaDoTitulo.papel,
      // SQL cru: em select de tabela única o drizzle não qualifica a coluna (casaria b.id)
      saldo: sql<string>`("titulos"."valor" - coalesce((select sum(b.valor) from baixas b where b.titulo_id = "titulos"."id"), 0))::text`,
    })
    .from(titulos)
    .leftJoin(contaDoTitulo, eq(contaDoTitulo.id, titulos.contaId))
    .where(and(eq(titulos.empresaId, empresaId), inArray(titulos.status, ["aberto", "parcial"])))
    .orderBy(asc(titulos.vencimento), asc(titulos.competencia));
  return rs.map(({ contaPapel, ...t }) => ({ ...t, imposto: t.tipo === "pagar" && !!t.contaId && contaPapel !== "fornecedores" }));
}

/** Competências fechadas ("YYYY-MM-01"): a prévia avisa antes de enviar. */
export async function listarMesesFechados(empresaId: string) {
  const fs = await db.select({ c: fechamentos.competencia }).from(fechamentos).where(eq(fechamentos.empresaId, empresaId));
  return fs.map((f) => f.c);
}

/** Saldo (D − C) das contas de imposto a recolher (classe 2, "a recolher"), para a Baixa de imposto. */
export async function saldosARecolher(empresaId: string) {
  const rs = await db.execute<{ id: string; saldo: string }>(sql`
    SELECT pc.id, coalesce(sum(p.debito - p.credito), 0)::text AS saldo
    FROM plano_contas pc LEFT JOIN partidas p ON p.conta_id = pc.id
    WHERE pc.empresa_id = ${empresaId} AND pc.tipo = 'analitica' AND pc.codigo LIKE '2%' AND pc.nome ILIKE '%a recolher%'
    GROUP BY pc.id`);
  return Object.fromEntries([...rs].map((r) => [r.id, r.saldo]));
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
      contaContabilId: contasBancarias.contaContabilId,
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
      baixaTitulo: sql<boolean>`exists (select 1 from baixas b where b.lancamento_id = ${lancamentos.id})`,
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

export type SemParLinha = Awaited<ReturnType<typeof listarTransferenciasSemPar>>[number];

/**
 * Classificadas na conta de papel transferências (lançamento aprovado): transferência sem par, porque o par casado vira
 * status "transferencia" e não passa pela transitória. `ate`: só até essa data.
 */
export async function listarTransferenciasSemPar(empresaId: string, ate?: string) {
  const rows = await db.execute<{
    id: string; contaBancariaId: string; contaBancariaNome: string; data: string; valor: string; memo: string; lancamentoId: string;
  }>(sql`
    SELECT t.id, t.conta_bancaria_id AS "contaBancariaId", cb.nome AS "contaBancariaNome", t.data::text AS data,
      t.valor::text AS valor, t.memo, t.lancamento_id AS "lancamentoId"
    FROM transacoes_bancarias t
    JOIN contas_bancarias cb ON cb.id = t.conta_bancaria_id
    JOIN lancamentos l ON l.id = t.lancamento_id AND l.status = 'aprovado'
    WHERE cb.empresa_id = ${empresaId} AND t.status = 'classificada' ${ate ? sql`AND t.data <= ${ate}` : sql``}
      AND EXISTS (SELECT 1 FROM partidas p JOIN plano_contas pc ON pc.id = p.conta_id
                  WHERE p.lancamento_id = l.id AND pc.papel = 'transferencias')
    ORDER BY t.data, t.valor`);
  return [...rows];
}

/** Conta de papel transferências e o saldo (D − C) até `ate`. */
export async function saldoTransitoria(empresaId: string, ate: string) {
  const [c] = await db.execute<{ id: string; codigo: string; nome: string; saldo: string }>(sql`
    SELECT pc.id, pc.codigo, pc.nome, coalesce(sum(p.debito - p.credito) FILTER (WHERE l.data <= ${ate}), 0)::text AS saldo
    FROM plano_contas pc
    LEFT JOIN partidas p ON p.conta_id = pc.id
    LEFT JOIN lancamentos l ON l.id = p.lancamento_id
    WHERE pc.empresa_id = ${empresaId} AND pc.papel = 'transferencias'
    GROUP BY pc.id`);
  return c;
}
