import { and, asc, eq, like, sql } from "drizzle-orm";
import { db } from "@/db";
import { lancamentos, planoContas, titulos } from "@/db/schema";
import type { TipoTitulo } from "@/lib/titulos";

/** Receita (3.1.*) para títulos a receber; custo/despesa (3.2.*) para títulos a pagar. */
export const PREFIXO_RESULTADO: Record<TipoTitulo, string> = { receber: "3.1.", pagar: "3.2." };

export type TituloLinha = Awaited<ReturnType<typeof listarTitulos>>[number];

/** Títulos do tipo, com o saldo em aberto e as baixas (lançamento, valor). */
export function listarTitulos(empresaId: string, tipo: TipoTitulo) {
  return db
    .select({
      id: titulos.id,
      contraparte: titulos.contraparte,
      descricao: titulos.descricao,
      documento: titulos.documento,
      competencia: titulos.competencia,
      vencimento: titulos.vencimento,
      valor: titulos.valor,
      status: titulos.status,
      lancamentoId: titulos.lancamentoId,
      lancamentoNumero: lancamentos.numero,
      baixado: sql<string>`coalesce((select sum(b.valor) from baixas b where b.titulo_id = "titulos"."id"), 0)::text`,
      baixas: sql<{ lancamentoId: string; numero: number; valor: string }[]>`coalesce((
        select json_agg(json_build_object('lancamentoId', bl.id, 'numero', bl.numero, 'valor', b.valor::text) order by bl.numero)
        from baixas b join lancamentos bl on bl.id = b.lancamento_id where b.titulo_id = "titulos"."id"), '[]'::json)`,
    })
    .from(titulos)
    .leftJoin(lancamentos, eq(lancamentos.id, titulos.lancamentoId))
    .where(and(eq(titulos.empresaId, empresaId), eq(titulos.tipo, tipo)))
    .orderBy(asc(titulos.vencimento), asc(titulos.competencia), asc(titulos.createdAt));
}

export async function contaResultadoValida(empresaId: string, contaId: string, tipo: TipoTitulo) {
  const [c] = await db
    .select({ id: planoContas.id })
    .from(planoContas)
    .where(
      and(
        eq(planoContas.id, contaId),
        eq(planoContas.empresaId, empresaId),
        eq(planoContas.tipo, "analitica"),
        eq(planoContas.ativa, true),
        like(planoContas.codigo, `${PREFIXO_RESULTADO[tipo]}%`),
      ),
    );
  return !!c;
}
