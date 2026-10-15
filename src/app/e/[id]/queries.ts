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
      // Join + group by: no subselect correlacionado o drizzle não qualifica `lancamentos.id` e casava partidas.id.
      valor: sql<string>`coalesce(sum(${partidas.debito}), 0)::text`,
    })
    .from(lancamentos)
    .leftJoin(partidas, eq(partidas.lancamentoId, lancamentos.id))
    .where(eq(lancamentos.empresaId, empresaId))
    .groupBy(lancamentos.id)
    .orderBy(desc(lancamentos.data), desc(lancamentos.numero))
    .limit(10);
}
