import { sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { cents, fromCents, primeiroDiaDoMes } from "@/lib/format";

export type LinhaSaldo = {
  id: string; codigo: string; nome: string; natureza: "D" | "C"; tipo: "sintetica" | "analitica";
  parentId: string | null; grupoDre: string | null; papel?: string | null;
  saldoAnterior: string; debitos: string; creditos: string; saldoAtual: string;
};

/**
 * Saldo = Σdébito − Σcrédito, por competência (decisão do Bruno; o banco confere pela data em bancos/queries):
 * anterior: competência antes do mês de `de`; movimento: do mês de `de` ao de `ate`. Mês inteiro: `de` no meio do mês
 * conta o mês todo (competência é o 1º dia do mês).
 * Inclui todas as contas (sintéticas com zeros; hierarquia.ts agrega).
 * `exec` permite ler dentro de uma transação (apuração).
 * `excluirApuracao`: ignora a apuração e seu estorno (só a DRE; o resto precisa deles para fechar).
 */
export async function saldos(
  empresaId: string, de: string, ate: string, exec: typeof db | Tx = db,
  { excluirApuracao = false }: { excluirApuracao?: boolean } = {},
): Promise<LinhaSaldo[]> {
  const deMes = primeiroDiaDoMes(de);
  const rows = await exec.execute(sql`
    SELECT pc.id, pc.codigo, pc.nome, pc.natureza, pc.tipo, pc.parent_id AS "parentId", pc.grupo_dre AS "grupoDre", pc.papel,
      coalesce(sum(CASE WHEN l.competencia < ${deMes} THEN p.debito - p.credito END), 0)::text AS "saldoAnterior",
      coalesce(sum(CASE WHEN l.competencia >= ${deMes} THEN p.debito END), 0)::text AS debitos,
      coalesce(sum(CASE WHEN l.competencia >= ${deMes} THEN p.credito END), 0)::text AS creditos
    FROM plano_contas pc
    LEFT JOIN partidas p ON p.conta_id = pc.id
    LEFT JOIN lancamentos l ON l.id = p.lancamento_id AND l.competencia <= ${ate}${excluirApuracao ? sql` AND l.origem <> 'apuracao'` : sql``}
    WHERE pc.empresa_id = ${empresaId}
    GROUP BY pc.id ORDER BY pc.codigo`);
  // postgres-js: execute devolve um RowList (array de objetos), sem `.rows`.
  return (rows as unknown as Omit<LinhaSaldo, "saldoAtual">[]).map((r) => ({
    ...r, saldoAtual: fromCents(cents(r.saldoAnterior) + cents(r.debitos) - cents(r.creditos)),
  }));
}
