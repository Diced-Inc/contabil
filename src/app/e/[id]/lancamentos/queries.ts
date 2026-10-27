import { and, asc, desc, eq, gte, ilike, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { lancamentoLog, lancamentos, partidas, planoContas } from "@/db/schema";
import { escapeLike } from "@/lib/format";

export const ORIGENS = { manual: "Manual", conciliacao: "Conciliação", apuracao: "Apuração", estorno: "Estorno" } as const;
export type Origem = keyof typeof ORIGENS;
export const ACOES_LOG = {
  criado: "Criado", alterado: "Alterado", estornado: "Estornado",
  fechamento: "Fechamento", reabertura: "Reabertura", apuracao: "Apuração",
} as const;

/** Analíticas ativas da empresa, para o ContaSelect das partidas. */
export function listarContasAnaliticas(empresaId: string) {
  return db
    .select({ id: planoContas.id, codigo: planoContas.codigo, nome: planoContas.nome })
    .from(planoContas)
    .where(and(eq(planoContas.empresaId, empresaId), eq(planoContas.tipo, "analitica"), eq(planoContas.ativa, true)))
    .orderBy(asc(planoContas.codigo));
}

// SQL cru com aliases: em select de tabela única o drizzle não qualifica as colunas, e `${lancamentos.id}`
// virava "id" (ambíguo / casava a tabela do subselect).
const codigos = (lado: "debito" | "credito") => sql<string>`(
  select coalesce(string_agg(distinct pc.codigo, ', '), '')
  from partidas p inner join plano_contas pc on pc.id = p.conta_id
  where p.lancamento_id = "lancamentos"."id" and p.${sql.raw(lado)} > 0
)`;

/** semDocMin: só aprovados (sem apuração/estorno), sem documento e com valor ≥ semDocMin (mesmo critério da checagem). */
export function listarLancamentos(empresaId: string, f: { de: string; ate: string; texto?: string; origem?: Origem; semDocMin?: number }) {
  return db
    .select({
      id: lancamentos.id,
      numero: lancamentos.numero,
      data: lancamentos.data,
      historico: lancamentos.historico,
      origem: lancamentos.origem,
      status: lancamentos.status,
      debitos: codigos("debito"),
      creditos: codigos("credito"),
      valor: sql<string>`(select coalesce(sum(p.debito), 0)::text from partidas p where p.lancamento_id = "lancamentos"."id")`,
    })
    .from(lancamentos)
    .where(
      and(
        eq(lancamentos.empresaId, empresaId),
        gte(lancamentos.data, f.de),
        lte(lancamentos.data, f.ate),
        f.texto ? ilike(lancamentos.historico, `%${escapeLike(f.texto)}%`) : undefined,
        f.origem ? eq(lancamentos.origem, f.origem) : undefined,
        f.semDocMin
          ? sql`${lancamentos.status} = 'aprovado' and ${lancamentos.origem} not in ('apuracao', 'estorno')
              and coalesce(trim(${lancamentos.documento}), '') = ''
              and (select sum(p.debito) from partidas p where p.lancamento_id = "lancamentos"."id") >= ${f.semDocMin}`
          : undefined,
      ),
    )
    .orderBy(asc(lancamentos.data), asc(lancamentos.numero));
}

/** Lançamento da empresa com partidas (conta código/nome), original e estorno ligados. */
export async function getLancamento(empresaId: string, id: string) {
  const [l] = await db
    .select()
    .from(lancamentos)
    .where(and(eq(lancamentos.id, id), eq(lancamentos.empresaId, empresaId)));
  if (!l) return undefined;
  const [ps, [estorno], [original]] = await Promise.all([
    db
      .select({
        contaId: partidas.contaId,
        debito: partidas.debito,
        credito: partidas.credito,
        codigo: planoContas.codigo,
        nome: planoContas.nome,
      })
      .from(partidas)
      .innerJoin(planoContas, eq(planoContas.id, partidas.contaId))
      .where(eq(partidas.lancamentoId, id))
      .orderBy(asc(partidas.ordem)),
    db
      .select({ id: lancamentos.id, numero: lancamentos.numero })
      .from(lancamentos)
      .where(eq(lancamentos.estornoDeId, id))
      .limit(1),
    l.estornoDeId
      ? db.select({ id: lancamentos.id, numero: lancamentos.numero }).from(lancamentos).where(eq(lancamentos.id, l.estornoDeId))
      : Promise.resolve([]),
  ]);
  return { ...l, partidas: ps, estorno, original };
}

export function listarLog(lancamentoId: string) {
  return db
    .select()
    .from(lancamentoLog)
    .where(eq(lancamentoLog.lancamentoId, lancamentoId))
    .orderBy(desc(lancamentoLog.createdAt));
}
