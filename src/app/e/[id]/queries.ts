import { and, count, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { contasBancarias, lancamentos, partidas, transacoesBancarias } from "@/db/schema";

export async function contarPendentes(empresaId: string) {
  const [{ n }] = await db
    .select({ n: count() })
    .from(transacoesBancarias)
    .innerJoin(contasBancarias, eq(contasBancarias.id, transacoesBancarias.contaBancariaId))
    .where(and(eq(contasBancarias.empresaId, empresaId), eq(transacoesBancarias.status, "pendente")));
  return n;
}

/** Últimos 10 lançamentos (data e número decrescentes). */
export function ultimosLancamentos(empresaId: string) {
  return db
    .select({
      id: lancamentos.id,
      numero: lancamentos.numero,
      data: lancamentos.data,
      historico: lancamentos.historico,
      valor: sql<string>`(select coalesce(sum(${partidas.debito}), 0)::text from ${partidas} where ${partidas.lancamentoId} = ${lancamentos.id})`,
    })
    .from(lancamentos)
    .where(eq(lancamentos.empresaId, empresaId))
    .orderBy(desc(lancamentos.data), desc(lancamentos.numero))
    .limit(10);
}
