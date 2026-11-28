import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { lancamentos, partidas, planoContas } from "@/db/schema";
import { cents, primeiroDiaDoMes } from "@/lib/format";
import { compararCodigo } from "./hierarquia";
import { correr } from "./movimentos";

export type Contrapartida = { codigo: string; nome: string };

/**
 * Razão de várias contas no período [de, ate] (mesmo ano), por competência como os demais relatórios: saldo em 31/12
 * do ano anterior, saldo anterior ao mês de `de`, movimentos (ordem competência/data/nº) com saldo corrente D − C,
 * totais e saldo final.
 * "todas": contas com movimento no período ou saldo anterior ≠ 0. Contas de outra empresa são ignoradas.
 */
export async function razao360(empresaId: string, contaIds: string[] | "todas", de: string, ate: string, exec: typeof db | Tx = db) {
  if (contaIds !== "todas" && !contaIds.length) return [];
  const inicioAno = `${de.slice(0, 4)}-01-01`;
  const deMes = primeiroDiaDoMes(de);
  const filtroConta = contaIds === "todas" ? undefined : inArray(partidas.contaId, contaIds);
  const daEmpresa = eq(lancamentos.empresaId, empresaId);

  const [saldos, movs] = await Promise.all([
    exec
      .select({
        contaId: partidas.contaId,
        anoAnterior: sql<string>`coalesce(sum(${partidas.debito} - ${partidas.credito}) filter (where ${lancamentos.competencia} < ${inicioAno}), 0)::text`,
        anterior: sql<string>`coalesce(sum(${partidas.debito} - ${partidas.credito}) filter (where ${lancamentos.competencia} < ${deMes}), 0)::text`,
      })
      .from(partidas)
      .innerJoin(lancamentos, eq(lancamentos.id, partidas.lancamentoId))
      .where(and(daEmpresa, filtroConta, sql`${lancamentos.competencia} < ${deMes}`))
      .groupBy(partidas.contaId),
    exec
      .select({
        contaId: partidas.contaId, lancamentoId: lancamentos.id, data: lancamentos.data, competencia: lancamentos.competencia, numero: lancamentos.numero,
        historico: lancamentos.historico, estornoDeId: lancamentos.estornoDeId, debito: partidas.debito, credito: partidas.credito,
        contrapartidas: sql<Contrapartida[]>`(
          select coalesce(json_agg(distinct jsonb_build_object('codigo', pc.codigo, 'nome', pc.nome)), '[]'::json)
          from partidas o inner join plano_contas pc on pc.id = o.conta_id
          where o.lancamento_id = ${lancamentos.id} and o.conta_id <> ${partidas.contaId}
        )`,
      })
      .from(partidas)
      .innerJoin(lancamentos, eq(lancamentos.id, partidas.lancamentoId))
      .where(and(daEmpresa, filtroConta, gte(lancamentos.competencia, deMes), lte(lancamentos.competencia, ate)))
      .orderBy(asc(lancamentos.competencia), asc(lancamentos.data), asc(lancamentos.numero), asc(partidas.ordem)),
  ]);

  const saldoDe = new Map(saldos.map((s) => [s.contaId, s]));
  const movsDe = Map.groupBy(movs, (m) => m.contaId);
  const ids = contaIds === "todas"
    ? [...new Set([...movsDe.keys(), ...saldos.filter((s) => cents(s.anterior) !== 0).map((s) => s.contaId)])]
    : contaIds;
  if (!ids.length) return [];
  const contas = await exec
    .select({ id: planoContas.id, codigo: planoContas.codigo, nome: planoContas.nome, natureza: planoContas.natureza })
    .from(planoContas)
    .where(and(eq(planoContas.empresaId, empresaId), inArray(planoContas.id, ids)));

  return contas
    .sort((a, b) => compararCodigo(a.codigo, b.codigo))
    .map((conta) => {
      const s = saldoDe.get(conta.id);
      const saldoAnterior = s?.anterior ?? "0.00";
      return { conta, saldoAnoAnterior: s?.anoAnterior ?? "0.00", saldoAnterior, ...correr(movsDe.get(conta.id) ?? [], saldoAnterior) };
    });
}

export type Razao360 = Awaited<ReturnType<typeof razao360>>[number];

/** Razão de uma conta (painel de detalhe). null se a conta não é da empresa. */
export async function razao(empresaId: string, contaId: string, de: string, ate: string) {
  return (await razao360(empresaId, [contaId], de, ate))[0] ?? null;
}
