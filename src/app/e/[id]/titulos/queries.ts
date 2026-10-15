import { and, asc, eq, like } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { lancamentos, planoContas, titulos } from "@/db/schema";
import type { TipoTitulo } from "@/lib/titulos";

/** Receita (3.1.*) para títulos a receber; custo/despesa (3.2.*) para títulos a pagar. */
export const PREFIXO_RESULTADO: Record<TipoTitulo, string> = { receber: "3.1.", pagar: "3.2." };

export type TituloLinha = Awaited<ReturnType<typeof listarTitulos>>[number];

export function listarTitulos(empresaId: string, tipo: TipoTitulo) {
  const baixa = alias(lancamentos, "baixa");
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
      baixaLancamentoId: titulos.baixaLancamentoId,
      baixaNumero: baixa.numero,
    })
    .from(titulos)
    .leftJoin(lancamentos, eq(lancamentos.id, titulos.lancamentoId))
    .leftJoin(baixa, eq(baixa.id, titulos.baixaLancamentoId))
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
