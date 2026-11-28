import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { contadores, lancamentoLog, lancamentos, partidas, planoContas, transacoesBancarias } from "@/db/schema";
import { ORIGENS, escapeLike } from "@/lib/format";

export { ORIGENS };
export type Origem = keyof typeof ORIGENS;
export const ACOES_LOG = {
  criado: "Criado", alterado: "Alterado", estornado: "Estornado",
  fechamento: "Fechamento", reabertura: "Reabertura", apuracao: "Apuração",
} as const;

/** Analíticas ativas da empresa, para o ContaSelect das partidas (papel: guard rail de título na conciliação). */
export function listarContasAnaliticas(empresaId: string) {
  return db
    .select({ id: planoContas.id, codigo: planoContas.codigo, nome: planoContas.nome, papel: planoContas.papel })
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
      .orderBy(desc(lancamentos.numero)) // corrigido (estorno fora do mês): o estorno vigente é o último
      .limit(1),
    l.estornoDeId
      ? db.select({ id: lancamentos.id, numero: lancamentos.numero }).from(lancamentos).where(eq(lancamentos.id, l.estornoDeId))
      : Promise.resolve([]),
  ]);
  return { ...l, partidas: ps, estorno, original };
}

export function listarLog(lancamentoId: string) {
  return db
    .select({
      id: lancamentoLog.id, acao: lancamentoLog.acao, usuarioId: lancamentoLog.usuarioId, email: contadores.email,
      antes: lancamentoLog.antes, depois: lancamentoLog.depois, motivo: lancamentoLog.motivo, loteId: lancamentoLog.loteId,
      createdAt: lancamentoLog.createdAt,
    })
    .from(lancamentoLog)
    .leftJoin(contadores, eq(contadores.userId, lancamentoLog.usuarioId))
    .where(eq(lancamentoLog.lancamentoId, lancamentoId))
    .orderBy(desc(lancamentoLog.createdAt));
}

const elo = {
  id: lancamentos.id, numero: lancamentos.numero, origem: lancamentos.origem, status: lancamentos.status, data: lancamentos.data,
  competencia: lancamentos.competencia, dataPagamento: lancamentos.dataPagamento, historico: lancamentos.historico,
  estornoDeId: lancamentos.estornoDeId, substituiId: lancamentos.substituiId, createdAt: lancamentos.createdAt,
};

/**
 * Cadeia de reclassificação do lançamento (original → estorno → substituto, e as correções), ligada por estorno_de_id
 * e substitui_id nos dois sentidos, com quem/quando/por quê (log "criado") e a data do movimento no banco.
 * Vazia se o lançamento não tem elo. ponytail: busca em largura, 12 saltos; cadeias reais têm 3 a 6.
 */
export async function cadeiaDoLancamento(empresaId: string, id: string) {
  const vistos = new Map<string, Awaited<ReturnType<typeof buscar>>[number]>();
  const buscar = (ids: string[]) => db.select(elo).from(lancamentos).where(and(eq(lancamentos.empresaId, empresaId),
    or(inArray(lancamentos.id, ids), inArray(lancamentos.estornoDeId, ids), inArray(lancamentos.substituiId, ids))));
  let fronteira = [id];
  for (let i = 0; i < 12 && fronteira.length; i++) {
    const novos = (await buscar(fronteira)).filter((l) => !vistos.has(l.id));
    novos.forEach((l) => vistos.set(l.id, l));
    fronteira = [...new Set(novos.flatMap((l) => [l.id, l.estornoDeId, l.substituiId]).filter((x): x is string => !!x))]
      .filter((x) => !vistos.has(x) || novos.some((l) => l.id === x));
  }
  if (vistos.size < 2) return [];
  const ids = [...vistos.keys()];
  const [logs, txs] = await Promise.all([
    db.select({ lancamentoId: lancamentoLog.lancamentoId, motivo: lancamentoLog.motivo, loteId: lancamentoLog.loteId, usuarioId: lancamentoLog.usuarioId, email: contadores.email })
      .from(lancamentoLog).leftJoin(contadores, eq(contadores.userId, lancamentoLog.usuarioId))
      .where(and(inArray(lancamentoLog.lancamentoId, ids), eq(lancamentoLog.acao, "criado"))),
    db.select({ lancamentoId: transacoesBancarias.lancamentoId, data: transacoesBancarias.data }).from(transacoesBancarias)
      .where(inArray(transacoesBancarias.lancamentoId, ids)),
  ]);
  const ls = [...vistos.values()];
  const banco = (l: (typeof ls)[number]): string | null =>
    l.dataPagamento ?? txs.find((t) => t.lancamentoId === l.id)?.data ?? (l.estornoDeId ? vistos.get(l.estornoDeId)?.dataPagamento ?? null : null);
  return ls.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.numero - b.numero).map((l) => {
    const g = logs.find((x) => x.lancamentoId === l.id);
    return {
      ...l, dataBanco: banco(l), motivo: g?.motivo ?? null, loteId: g?.loteId ?? null, usuario: g?.email ?? g?.usuarioId?.slice(0, 8) ?? null,
      estornoDe: l.estornoDeId ? vistos.get(l.estornoDeId)?.numero ?? null : null,
      substitui: l.substituiId ? vistos.get(l.substituiId)?.numero ?? null : null,
    };
  });
}
