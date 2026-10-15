import { and, asc, eq, gte, lt, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { lancamentos, partidas, planoContas } from "@/db/schema";
import { cents, fromCents } from "@/lib/format";

/** Saldo anterior, movimentos com contrapartidas e saldo corrente (D − C), saldo final. null se a conta não é da empresa. */
export async function razao(empresaId: string, contaId: string, de: string, ate: string) {
  const [conta] = await db
    .select({ id: planoContas.id, codigo: planoContas.codigo, nome: planoContas.nome, natureza: planoContas.natureza })
    .from(planoContas)
    .where(and(eq(planoContas.id, contaId), eq(planoContas.empresaId, empresaId)));
  if (!conta) return null;

  const [[{ anterior }], movs] = await Promise.all([
    db
      .select({ anterior: sql<string>`coalesce(sum(${partidas.debito} - ${partidas.credito}), 0)::text` })
      .from(partidas)
      .innerJoin(lancamentos, eq(lancamentos.id, partidas.lancamentoId))
      .where(and(eq(partidas.contaId, contaId), lt(lancamentos.data, de))),
    db
      .select({
        lancamentoId: lancamentos.id, data: lancamentos.data, numero: lancamentos.numero, historico: lancamentos.historico,
        debito: partidas.debito, credito: partidas.credito,
        contrapartidas: sql<string>`(
          select coalesce(string_agg(distinct pc.codigo, ', '), '')
          from partidas o inner join plano_contas pc on pc.id = o.conta_id
          where o.lancamento_id = ${lancamentos.id} and o.id <> ${partidas.id}
        )`,
      })
      .from(partidas)
      .innerJoin(lancamentos, eq(lancamentos.id, partidas.lancamentoId))
      .where(and(eq(partidas.contaId, contaId), gte(lancamentos.data, de), lte(lancamentos.data, ate)))
      .orderBy(asc(lancamentos.data), asc(lancamentos.numero), asc(partidas.ordem)),
  ]);

  let s = cents(anterior);
  const movimentos = movs.map((m) => {
    s += cents(m.debito) - cents(m.credito);
    return { ...m, saldo: fromCents(s) };
  });
  return { conta, saldoAnterior: fromCents(cents(anterior)), movimentos, saldoFinal: fromCents(s) };
}
