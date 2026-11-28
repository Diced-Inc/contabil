import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { lancamentos, partidas } from "@/db/schema";
import { primeiroDiaDoMes } from "@/lib/format";

/** Lançamentos com competência no período (inclusive estornados e estornos), com partidas e contas; ordem competência, data, nº. */
export function diario(empresaId: string, de: string, ate: string, exec: typeof db | Tx = db) {
  return exec.query.lancamentos.findMany({
    columns: { id: true, numero: true, data: true, competencia: true, historico: true, documento: true, status: true },
    where: and(eq(lancamentos.empresaId, empresaId), gte(lancamentos.competencia, primeiroDiaDoMes(de)), lte(lancamentos.competencia, ate)),
    orderBy: [asc(lancamentos.competencia), asc(lancamentos.data), asc(lancamentos.numero)],
    with: {
      partidas: {
        columns: { id: true, debito: true, credito: true },
        orderBy: [asc(partidas.ordem)],
        with: { conta: { columns: { codigo: true, nome: true } } },
      },
    },
  });
}
