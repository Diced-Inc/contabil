/**
 * Reclassificação em lote no banco (regras em ./reclassificacao): cada item na sua transação do Postgres, sempre
 * estorno + novo pelas funções da conciliação, com lote_id/motivo no log e substitui_id no novo (contextoLog).
 * Também o desfazer do lote e a correção dos estornos fora do mês do original.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import { contasBancarias, lancamentos, planoContas, titulos, transacoesBancarias } from "@/db/schema";
import { documentoDoMemo } from "./adiantamentos";
import {
  adiantarTransacao, classificarTransacao, desfazerConciliacao, lancarDireta, travar,
} from "./conciliacao";
import { cents, fromCents, primeiroDiaDoMes } from "./format";
import { contextoLog, criarLancamento, estornarLancamento, mesesFechados, type PartidaInput } from "./lancamentos";
import { contraparteDoMemo } from "./operacoes";
import {
  bloqueioCorrecao, estornoForaDoMes, PREFIXO_CORRECAO, PREFIXO_DESFAZER, situacao, type Alvo, type BaseSaldo, type Candidata,
  type ContextoLote, type ParEstorno,
} from "./reclassificacao";
import { cancelarTitulo } from "./titulos";

type Exec = Db | Tx;
const partidasJson = (lanc: ReturnType<typeof sql.raw>) => sql`coalesce((
  select json_agg(json_build_object('contaId', p.conta_id, 'debito', p.debito::text, 'credito', p.credito::text) order by p.ordem)
  from partidas p where p.lancamento_id = ${lanc}), '[]')`;

/** Conciliadas (classificada/transferência) com o lançamento aprovado atual; `transacaoId` restringe a uma. */
export async function listarCandidatas(exec: Exec, empresaId: string, transacaoId?: string): Promise<Candidata[]> {
  const rows = await exec.execute<Candidata>(sql`
    SELECT t.id AS "transacaoId", t.conta_bancaria_id AS "contaBancariaId", cb.nome AS "contaBancariaNome",
      cb.conta_contabil_id AS "contaBanco", t.data::text AS data, t.valor::text AS valor, t.memo, t.status::text AS status,
      l.id AS "lancamentoId", l.numero, l.data::text AS "lancData", l.competencia::text AS competencia, l.historico, l.documento,
      ${partidasJson(sql.raw("l.id"))} AS partidas,
      exists (select 1 from baixas b where b.lancamento_id = l.id) AS baixa,
      exists (select 1 from adiantamentos a where a.lancamento_id = l.id) AS adiantamento,
      coalesce((select json_agg(json_build_object('contaId', p.conta_id, 'competencia', ti.competencia::text))
        from baixas b join titulos ti on ti.id = b.titulo_id join partidas p on p.lancamento_id = ti.lancamento_id
        join plano_contas pc on pc.id = p.conta_id
        where b.lancamento_id = l.id and pc.codigo like '3%'), '[]') AS reconhecido
    FROM transacoes_bancarias t
    JOIN contas_bancarias cb ON cb.id = t.conta_bancaria_id
    JOIN lancamentos l ON l.id = t.lancamento_id AND l.status = 'aprovado'
    WHERE cb.empresa_id = ${empresaId} AND t.status IN ('classificada', 'transferencia')
      ${transacaoId ? sql`AND t.id = ${transacaoId}` : sql``}
    ORDER BY t.data, t.valor, t.id`);
  return [...rows];
}

/** Analíticas ativas (destino) e meses fechados: o que a situação de cada item precisa. */
export async function contextoLote(exec: Exec, empresaId: string): Promise<ContextoLote> {
  const [contas, fechados] = await Promise.all([
    exec.select({ id: planoContas.id, codigo: planoContas.codigo, nome: planoContas.nome, papel: planoContas.papel }).from(planoContas)
      .where(and(eq(planoContas.empresaId, empresaId), eq(planoContas.tipo, "analitica"), eq(planoContas.ativa, true))),
    mesesFechados(exec, empresaId),
  ]);
  return { contas, fechados };
}

/** Movimento por conta e ano de competência (D − C), para o efeito do lote nos saldos, DRE e Balanço. */
export async function baseSaldos(exec: Exec, empresaId: string): Promise<BaseSaldo[]> {
  const rows = await exec.execute<BaseSaldo>(sql`
    SELECT p.conta_id AS "contaId", extract(year from l.competencia)::int AS ano,
      sum(p.debito - p.credito)::text AS saldo,
      coalesce(sum(p.debito - p.credito) FILTER (WHERE l.origem <> 'apuracao'), 0)::text AS "semApuracao"
    FROM partidas p JOIN lancamentos l ON l.id = p.lancamento_id
    WHERE l.empresa_id = ${empresaId}
    GROUP BY 1, 2`);
  return [...rows];
}

/** Mensagem do trigger/validação, sem SQL (Drizzle embrulha o erro do Postgres em `cause`). */
export function mensagem(e: unknown) {
  const err = e as { message?: string; cause?: { message?: string } };
  return (err.cause?.message ?? err.message ?? "").replace(/^error:\s*/i, "") || "Erro";
}

/** Um item: reconfere a situação com a linha travada; pulado devolve o motivo, bloqueado vira erro. */
export async function reclassificarItem(tx: Tx, p: { empresaId: string; transacaoId: string; alvo: Alvo; usuarioId?: string | null }) {
  await travar(tx, p.empresaId, p.transacaoId);
  const [c] = await listarCandidatas(tx, p.empresaId, p.transacaoId);
  if (!c) throw new Error("Transação não está mais conciliada");
  const item = situacao(c, p.alvo, await contextoLote(tx, p.empresaId));
  if (item.tipo === "pulada") return { pulada: item.motivo! };
  if (item.tipo === "bloqueada") throw new Error(item.motivo);
  await desfazerConciliacao(tx, p.empresaId, p.transacaoId, p.usuarioId, "reclassificar em lote");
  await contextoLog(tx, { substituiId: c.lancamentoId });
  const base = {
    empresaId: p.empresaId, transacaoId: p.transacaoId, usuarioId: p.usuarioId, historico: c.historico, documento: c.documento,
    partidas: [{ contaId: p.alvo.contaId ?? "", valor: fromCents(Math.abs(cents(c.valor))) }],
  };
  const op = p.alvo.operacao;
  if (op === "receita_direta" || op === "despesa_direta")
    await lancarDireta(tx, { ...base, competencia: p.alvo.competencia ?? primeiroDiaDoMes(c.data), contraparte: contraparteDoMemo(c.memo) });
  else if (op === "adiantamento")
    await adiantarTransacao(tx, { ...base, contraparte: contraparteDoMemo(c.memo), documento: documentoDoMemo(c.memo) });
  else await classificarTransacao(tx, { ...base, operacao: op ?? undefined, confirmarSemTitulo: p.alvo.confirmarSemTitulo });
  return {};
}

export type ResultadoLote = {
  loteId: string; feitas: number;
  puladas: { id: string; memo: string; motivo: string }[];
  erros: { id: string; memo: string; motivo: string }[];
};

/**
 * Cada item na sua transação do Postgres (um erro não desfaz os outros). O contexto é zerado no início e no fim do
 * item: dentro de uma transação maior (teste), set_config local sobreviveria ao savepoint.
 */
async function porItem<T extends { id: string; memo: string }>(
  exec: Exec, ctx: { loteId: string; motivo: string }, itens: T[], fn: (tx: Tx, item: T) => Promise<{ pulada?: string }>,
): Promise<ResultadoLote> {
  const r: ResultadoLote = { loteId: ctx.loteId, feitas: 0, puladas: [], erros: [] };
  for (const item of itens) {
    try {
      const x = await exec.transaction(async (tx) => {
        await contextoLog(tx, { ...ctx, substituiId: null });
        const y = await fn(tx, item);
        await contextoLog(tx, { loteId: "", motivo: "", substituiId: null });
        return y;
      });
      if (x.pulada) r.puladas.push({ id: item.id, memo: item.memo, motivo: x.pulada });
      else r.feitas++;
    } catch (e) {
      r.erros.push({ id: item.id, memo: item.memo, motivo: mensagem(e) });
    }
  }
  return r;
}

export async function reclassificarLote(exec: Exec, p: {
  empresaId: string; transacaoIds: string[]; alvo: Alvo; motivo: string; usuarioId?: string | null;
}) {
  if (p.motivo.trim().length < 5) throw new Error("Informe o motivo da reclassificação (vai para o histórico de cada lançamento)");
  const txs = await exec.select({ id: transacoesBancarias.id, memo: transacoesBancarias.memo }).from(transacoesBancarias)
    .innerJoin(contasBancarias, eq(contasBancarias.id, transacoesBancarias.contaBancariaId))
    .where(and(eq(contasBancarias.empresaId, p.empresaId), inArray(transacoesBancarias.id, [...new Set(p.transacaoIds)])))
    .orderBy(transacoesBancarias.data, transacoesBancarias.id);
  return porItem(exec, { loteId: randomUUID(), motivo: p.motivo.trim() }, txs, (tx, t) =>
    reclassificarItem(tx, { empresaId: p.empresaId, transacaoId: t.id, alvo: p.alvo, usuarioId: p.usuarioId }));
}

/** Lotes da empresa, mais recentes primeiro, com quantos lançamentos cada um estornou e quem rodou. */
export async function listarLotes(exec: Exec, empresaId: string, limite = 20) {
  const rows = await exec.execute<{
    loteId: string; quando: string; motivo: string | null; usuarioId: string | null; email: string | null; estornados: number; novos: number;
  }>(sql`
    SELECT g.lote_id AS "loteId", min(g.created_at)::text AS quando, max(g.motivo) AS motivo, max(g.usuario_id::text) AS "usuarioId",
      max(c.email) AS email,
      count(*) FILTER (WHERE g.acao = 'estornado')::int AS estornados,
      count(*) FILTER (WHERE g.acao = 'criado' AND l.substitui_id IS NOT NULL AND l.origem <> 'estorno')::int AS novos
    FROM lancamento_log g
    LEFT JOIN lancamentos l ON l.id = g.lancamento_id
    LEFT JOIN contadores c ON c.user_id = g.usuario_id
    WHERE g.empresa_id = ${empresaId} AND g.lote_id IS NOT NULL
    GROUP BY g.lote_id ORDER BY min(g.created_at) DESC LIMIT ${limite}`);
  return [...rows].map((l) => ({
    ...l,
    tipo: l.motivo?.startsWith(PREFIXO_DESFAZER) ? "desfazer" as const : l.motivo?.startsWith(PREFIXO_CORRECAO) ? "correcao" as const : "reclassificacao" as const,
  }));
}

/**
 * Desfaz o lote, também por estorno + novo: estorna o que o lote criou (desfazer a conciliação; títulos reconhecidos
 * pelo lote são cancelados) e lança de novo a classificação original, ligada à transação. Item que mudou depois do
 * lote é pulado. Lote de desfazer ou de correção não se desfaz por aqui.
 */
export async function desfazerLote(exec: Exec, p: { empresaId: string; loteId: string; motivo: string; usuarioId?: string | null }) {
  if (p.motivo.trim().length < 5) throw new Error("Informe o motivo para desfazer o lote");
  const [lote] = await exec.execute<{ motivo: string | null }>(sql`
    SELECT max(motivo) AS motivo FROM lancamento_log WHERE empresa_id = ${p.empresaId} AND lote_id = ${p.loteId}`);
  if (!lote?.motivo) throw new Error("Lote não encontrado");
  if (lote.motivo.startsWith(PREFIXO_DESFAZER) || lote.motivo.startsWith(PREFIXO_CORRECAO))
    throw new Error("Este lote já é um desfazer/correção: reclassifique de novo em vez de desfazê-lo");
  // original → lançamentos que o lote criou no lugar dele (reconhecimentos + baixa, ou o novo)
  const grupos = await exec.execute<{ original: string; novos: string[]; memo: string; id: string }>(sql`
    SELECT n.substitui_id AS original, array_agg(n.id::text) AS novos, coalesce(max(t.memo), '') AS memo,
      coalesce(max(t.id::text), n.substitui_id::text) AS id
    FROM lancamento_log g
    JOIN lancamentos n ON n.id = g.lancamento_id
    LEFT JOIN transacoes_bancarias t ON t.lancamento_id = n.id
    WHERE g.empresa_id = ${p.empresaId} AND g.lote_id = ${p.loteId} AND g.acao = 'criado'
      AND n.substitui_id IS NOT NULL AND n.origem <> 'estorno'
    GROUP BY n.substitui_id`);
  const motivo = `${PREFIXO_DESFAZER}${p.loteId.slice(0, 8)}: ${p.motivo.trim()}`;
  return porItem(exec, { loteId: randomUUID(), motivo }, [...grupos], async (tx, g) => {
    const [t] = await tx.select({ id: transacoesBancarias.id }).from(transacoesBancarias)
      .where(inArray(transacoesBancarias.lancamentoId, g.novos));
    if (!t) return { pulada: "A transação não está mais no lançamento do lote (desfeita ou reclassificada depois)" };
    const tr = await travar(tx, p.empresaId, t.id);
    if (tr.status !== "classificada" || !tr.lancamentoId || !g.novos.includes(tr.lancamentoId))
      return { pulada: "A transação mudou depois do lote" };
    const orig = await tx.query.lancamentos.findFirst({ where: eq(lancamentos.id, g.original), with: { partidas: true } });
    if (!orig) throw new Error("Lançamento original não encontrado");
    const datas = await tx.select({ data: lancamentos.data, competencia: lancamentos.competencia }).from(lancamentos)
      .where(inArray(lancamentos.id, g.novos));
    const fechados = await mesesFechados(tx, p.empresaId);
    const meses = [...new Set([...datas, orig].flatMap((l) => [primeiroDiaDoMes(l.data), l.competencia]))].filter((m) => fechados.has(m)).sort();
    if (meses.length) throw new Error(`Mês ${meses.map((m) => `${m.slice(5, 7)}/${m.slice(0, 4)}`).join(", ")} fechado: reabra em Fechamento para desfazer`);
    await desfazerConciliacao(tx, p.empresaId, t.id, p.usuarioId, "desfazer o lote");
    const ts = await tx.select({ id: titulos.id }).from(titulos)
      .where(and(eq(titulos.empresaId, p.empresaId), inArray(titulos.lancamentoId, g.novos), ne(titulos.status, "cancelado")));
    for (const x of ts) await cancelarTitulo(tx, p.empresaId, x.id, p.usuarioId, { mesAberto: true });
    await contextoLog(tx, { substituiId: tr.lancamentoId });
    const copia = await criarLancamento(tx, {
      empresaId: p.empresaId, data: orig.data, competencia: orig.competencia, dataPagamento: orig.dataPagamento,
      historico: orig.historico, documento: orig.documento, origem: "conciliacao", usuarioId: p.usuarioId,
      partidas: [...orig.partidas].sort((a, b) => a.ordem - b.ordem).map((x) => ({ contaId: x.contaId, debito: x.debito, credito: x.credito })),
    });
    await tx.update(transacoesBancarias).set({ status: "classificada", lancamentoId: copia.id }).where(eq(transacoesBancarias.id, t.id));
    return {};
  });
}

// ---------- estorno fora do mês do original ----------

/** Estornos aprovados em competência diferente da do original, com o mês do original aberto; `bloqueio` se não dá para corrigir. */
export async function estornosForaDoMes(exec: Exec, empresaId: string) {
  const rows = await exec.execute<{
    eId: string; eNumero: number; eData: string; eCompetencia: string; eHistorico: string; eDocumento: string | null; eStatus: "aprovado";
    eOrigem: string; ePartidas: PartidaInput[]; eCriado: string;
    oId: string; oNumero: number; oData: string; oCompetencia: string; oHistorico: string; oDocumento: string | null; oPartidas: PartidaInput[];
    valor: string;
  }>(sql`
    SELECT e.id AS "eId", e.numero AS "eNumero", e.data::text AS "eData", e.competencia::text AS "eCompetencia", e.historico AS "eHistorico",
      e.documento AS "eDocumento", e.status::text AS "eStatus", e.origem::text AS "eOrigem", ${partidasJson(sql.raw("e.id"))} AS "ePartidas",
      e.created_at::text AS "eCriado",
      o.id AS "oId", o.numero AS "oNumero", o.data::text AS "oData", o.competencia::text AS "oCompetencia", o.historico AS "oHistorico",
      o.documento AS "oDocumento", ${partidasJson(sql.raw("o.id"))} AS "oPartidas",
      (select coalesce(sum(p.debito), 0)::text from partidas p where p.lancamento_id = o.id) AS valor
    FROM lancamentos e JOIN lancamentos o ON o.id = e.estorno_de_id
    WHERE e.empresa_id = ${empresaId} AND e.origem = 'estorno' AND e.status = 'aprovado' AND e.competencia <> o.competencia
      AND NOT EXISTS (SELECT 1 FROM fechamentos f WHERE f.empresa_id = ${empresaId} AND f.competencia = o.competencia)
    ORDER BY o.data, o.numero`);
  const fechados = await mesesFechados(exec, empresaId);
  return [...rows].map((r) => {
    const par: ParEstorno = {
      estorno: { id: r.eId, numero: r.eNumero, data: r.eData, competencia: r.eCompetencia, historico: r.eHistorico, documento: r.eDocumento,
        status: r.eStatus, origem: r.eOrigem, partidas: r.ePartidas },
      original: { id: r.oId, numero: r.oNumero, data: r.oData, competencia: r.oCompetencia, historico: r.oHistorico, documento: r.oDocumento,
        partidas: r.oPartidas },
    };
    return { ...par, valor: r.valor, criado: r.eCriado, bloqueio: bloqueioCorrecao(par, fechados) };
  }).filter(estornoForaDoMes);
}
export type EstornoForaDoMes = Awaited<ReturnType<typeof estornosForaDoMes>>[number];

/**
 * "Corrigir": para cada par, estorna o estorno no mês dele e lança o estorno de novo na data e competência do original
 * (substitui_id = o estorno corrigido). Mesmo lote e motivo nos dois lançamentos. `ids`: só esses estornos.
 */
export async function corrigirEstornosForaDoMes(exec: Exec, p: { empresaId: string; motivo: string; ids?: string[]; usuarioId?: string | null }) {
  if (p.motivo.trim().length < 5) throw new Error("Informe o motivo da correção");
  const pares = (await estornosForaDoMes(exec, p.empresaId)).filter((x) => !p.ids || p.ids.includes(x.estorno.id));
  const itens = pares.map((x) => ({ ...x, id: x.estorno.id, memo: `Lançamento ${x.original.numero} / estorno ${x.estorno.numero}` }));
  return porItem(exec, { loteId: randomUUID(), motivo: `${PREFIXO_CORRECAO}${p.motivo.trim()}` }, itens, async (tx, x) => {
    const [e] = await tx.select({ status: lancamentos.status }).from(lancamentos)
      .where(and(eq(lancamentos.id, x.estorno.id), eq(lancamentos.empresaId, p.empresaId))).for("update");
    if (!e || e.status !== "aprovado") return { pulada: "Estorno já corrigido" };
    const b = bloqueioCorrecao(x, await mesesFechados(tx, p.empresaId));
    if (b) throw new Error(b);
    await estornarLancamento(tx, x.estorno.id, x.estorno.data, p.usuarioId);
    await contextoLog(tx, { substituiId: x.estorno.id });
    const o = x.original;
    await criarLancamento(tx, {
      empresaId: p.empresaId, data: o.data, competencia: o.competencia, historico: `Estorno do lançamento ${o.numero}: ${o.historico}`,
      documento: o.documento, origem: "estorno", estornoDeId: o.id, usuarioId: p.usuarioId,
      partidas: o.partidas.map((q) => ({ contaId: q.contaId, debito: q.credito, credito: q.debito })),
    });
    return {};
  });
}
