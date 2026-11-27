import { and, asc, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { lancamentos, parcelamentos, planoContas, titulos } from "@/db/schema";
import type { TipoTitulo } from "@/lib/titulos";

export type TituloLinha = Awaited<ReturnType<typeof listarTitulos>>[number];
export type ParcelamentoLinha = Awaited<ReturnType<typeof listarParcelamentos>>[number];

const contaTitulo = alias(planoContas, "conta_titulo");

/** Títulos do tipo, com o saldo em aberto, a conta patrimonial e as baixas (lançamento, valor). */
export function listarTitulos(empresaId: string, tipo: TipoTitulo) {
  return db
    .select({
      id: titulos.id,
      contraparte: titulos.contraparte,
      contraparteDocumento: titulos.contraparteDocumento,
      descricao: titulos.descricao,
      documento: titulos.documento,
      competencia: titulos.competencia,
      vencimento: titulos.vencimento,
      valor: titulos.valor,
      status: titulos.status,
      origem: titulos.origem,
      parcela: titulos.parcela,
      contaCodigo: contaTitulo.codigo,
      contaNome: contaTitulo.nome,
      lancamentoId: titulos.lancamentoId,
      lancamentoNumero: lancamentos.numero,
      baixado: sql<string>`coalesce((select sum(b.valor) from baixas b where b.titulo_id = "titulos"."id"), 0)::text`,
      baixas: sql<{ lancamentoId: string; numero: number; valor: string }[]>`coalesce((
        select json_agg(json_build_object('lancamentoId', bl.id, 'numero', bl.numero, 'valor', b.valor::text) order by bl.numero)
        from baixas b join lancamentos bl on bl.id = b.lancamento_id where b.titulo_id = "titulos"."id"), '[]'::json)`,
    })
    .from(titulos)
    .leftJoin(lancamentos, eq(lancamentos.id, titulos.lancamentoId))
    .leftJoin(contaTitulo, eq(contaTitulo.id, titulos.contaId))
    .where(and(eq(titulos.empresaId, empresaId), eq(titulos.tipo, tipo)))
    .orderBy(asc(titulos.vencimento), asc(titulos.competencia), asc(titulos.createdAt));
}

/** Parcelamentos com o saldo em aberto no CP e no LP e o lançamento de reconhecimento. */
export function listarParcelamentos(empresaId: string) {
  const saldo = (conta: "conta_cp_id" | "conta_lp_id") => sql<string>`coalesce((
    select sum(t.valor - coalesce((select sum(b.valor) from baixas b where b.titulo_id = t.id), 0))
    from titulos t where t.parcelamento_id = "parcelamentos"."id" and t.status in ('aberto', 'parcial')
      and t.conta_id = "parcelamentos".${sql.raw(conta)}), 0)::text`;
  return db
    .select({
      id: parcelamentos.id, descricao: parcelamentos.descricao, principal: parcelamentos.principal, multa: parcelamentos.multa,
      juros: parcelamentos.juros, nParcelas: parcelamentos.nParcelas, valorParcela: parcelamentos.valorParcela,
      primeiroVencimento: parcelamentos.primeiroVencimento, data: parcelamentos.data, status: parcelamentos.status,
      saldoCp: saldo("conta_cp_id"), saldoLp: saldo("conta_lp_id"),
      abertas: sql<number>`(select count(*)::int from titulos t where t.parcelamento_id = "parcelamentos"."id" and t.status in ('aberto', 'parcial'))`,
      baixadas: sql<number>`(select count(distinct b.titulo_id)::int from baixas b join titulos t on t.id = b.titulo_id where t.parcelamento_id = "parcelamentos"."id")`,
      reconhecimento: sql<{ id: string; numero: number } | null>`(select json_build_object('id', l.id, 'numero', l.numero)
        from parcelamento_lancamentos pl join lancamentos l on l.id = pl.lancamento_id
        where pl.parcelamento_id = "parcelamentos"."id" and pl.tipo = 'reconhecimento' limit 1)`,
    })
    .from(parcelamentos)
    .where(eq(parcelamentos.empresaId, empresaId))
    .orderBy(desc(parcelamentos.createdAt));
}
