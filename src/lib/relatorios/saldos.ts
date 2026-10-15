import { sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { cents, fromCents } from "@/lib/format";

export type LinhaSaldo = {
  id: string; codigo: string; nome: string; natureza: "D" | "C"; tipo: "sintetica" | "analitica";
  parentId: string | null; grupoDre: string | null;
  saldoAnterior: string; debitos: string; creditos: string; saldoAtual: string;
};

/**
 * Saldo = Σdébito − Σcrédito. anterior: data < de; movimento: de ≤ data ≤ ate.
 * Inclui todas as contas (sintéticas com zeros; hierarquia.ts agrega).
 * `exec` permite ler dentro de uma transação (apuração).
 * `excluirApuracao`: ignora a apuração e seu estorno (só a DRE; o resto precisa deles para fechar).
 */
export async function saldos(
  empresaId: string, de: string, ate: string, exec: typeof db | Tx = db,
  { excluirApuracao = false }: { excluirApuracao?: boolean } = {},
): Promise<LinhaSaldo[]> {
  const rows = await exec.execute(sql`
    SELECT pc.id, pc.codigo, pc.nome, pc.natureza, pc.tipo, pc.parent_id AS "parentId", pc.grupo_dre AS "grupoDre",
      coalesce(sum(CASE WHEN l.data < ${de} THEN p.debito - p.credito END), 0)::text AS "saldoAnterior",
      coalesce(sum(CASE WHEN l.data >= ${de} AND l.data <= ${ate} THEN p.debito END), 0)::text AS debitos,
      coalesce(sum(CASE WHEN l.data >= ${de} AND l.data <= ${ate} THEN p.credito END), 0)::text AS creditos
    FROM plano_contas pc
    LEFT JOIN partidas p ON p.conta_id = pc.id
    LEFT JOIN lancamentos l ON l.id = p.lancamento_id AND l.data <= ${ate}${excluirApuracao ? sql` AND l.origem <> 'apuracao'` : sql``}
    WHERE pc.empresa_id = ${empresaId}
    GROUP BY pc.id ORDER BY pc.codigo`);
  // postgres-js: execute devolve um RowList (array de objetos), sem `.rows`.
  return (rows as unknown as Omit<LinhaSaldo, "saldoAtual">[]).map((r) => ({
    ...r, saldoAtual: fromCents(cents(r.saldoAnterior) + cents(r.debitos) - cents(r.creditos)),
  }));
}
