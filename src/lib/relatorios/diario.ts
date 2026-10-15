import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { lancamentos, partidas } from "@/db/schema";

/** Lançamentos do período (inclusive estornados e estornos) com partidas e contas, por data e número. */
export function diario(empresaId: string, de: string, ate: string) {
  return db.query.lancamentos.findMany({
    columns: { id: true, numero: true, data: true, historico: true, documento: true, status: true },
    where: and(eq(lancamentos.empresaId, empresaId), gte(lancamentos.data, de), lte(lancamentos.data, ate)),
    orderBy: [asc(lancamentos.data), asc(lancamentos.numero)],
    with: {
      partidas: {
        columns: { id: true, debito: true, credito: true },
        orderBy: [asc(partidas.ordem)],
        with: { conta: { columns: { codigo: true, nome: true } } },
      },
    },
  });
}
