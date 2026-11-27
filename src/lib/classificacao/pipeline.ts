import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { contasBancarias, lancamentos, partidas, planoContas, regras, transacoesBancarias } from "@/db/schema";
import { normalizarMemo, selecionarExemplos } from "./exemplos";
import { classificarLoteIA, type ExemploIA } from "./ia";
import { aplicarTemplate, primeiraRegra } from "./regras";
import { parearTransferencias } from "./transferencias";

export const LOTE_IA = 20; // transações por chamada à IA
export const PARALELO_IA = 3; // chamadas simultâneas
const MAX_IA = 120; // transações por chamada de sugerirPendentes
const PRAZO_IA_MS = 200_000; // folga sob os 300 s da função na Vercel
const MIN_PARA_LOTE_MS = 30_000; // com menos prazo que isso, o lote fica para a próxima rodada
const MAX_POOL = 500;

export type ResultadoSugestao = {
  regras: number; transferencias: number; ia: number;
  /** Pendentes ainda sem sugestão que a IA pode pegar numa próxima rodada. */
  restantes: number;
  erros: string[];
};

/** Pool few-shot: conciliações aprovadas da empresa (memo → conta de contrapartida), da mais nova para a mais antiga. */
export async function exemplosAprovados(empresaId: string): Promise<ExemploIA[]> {
  const txs = await db
    .select({ memo: transacoesBancarias.memo, valor: transacoesBancarias.valor, lancamentoId: lancamentos.id, contaBanco: contasBancarias.contaContabilId })
    .from(transacoesBancarias)
    .innerJoin(contasBancarias, eq(contasBancarias.id, transacoesBancarias.contaBancariaId))
    .innerJoin(lancamentos, eq(lancamentos.id, transacoesBancarias.lancamentoId))
    .where(and(eq(contasBancarias.empresaId, empresaId), eq(transacoesBancarias.status, "classificada"), eq(lancamentos.status, "aprovado")))
    .orderBy(desc(lancamentos.createdAt))
    .limit(MAX_POOL);
  if (!txs.length) return [];
  const ps = await db
    .select({ lancamentoId: partidas.lancamentoId, contaId: partidas.contaId, codigo: planoContas.codigo, debito: partidas.debito, credito: partidas.credito })
    .from(partidas)
    .innerJoin(planoContas, eq(planoContas.id, partidas.contaId))
    .where(inArray(partidas.lancamentoId, txs.map((t) => t.lancamentoId)));
  return txs.flatMap((t) => {
    const contra = ps
      .filter((p) => p.lancamentoId === t.lancamentoId && p.contaId !== t.contaBanco)
      .sort((a, b) => Math.max(Number(b.debito), Number(b.credito)) - Math.max(Number(a.debito), Number(a.credito)))[0];
    return contra ? [{ memo: t.memo, valor: t.valor, contaCodigo: contra.codigo }] : [];
  });
}

/** Lotes de memos parecidos juntos (ordem pelo memo normalizado): os exemplos de cada lote ficam mais focados. */
export function lotesIA<T extends { memo: string }>(ts: T[], tamanho = LOTE_IA): T[][] {
  const ordenadas = ts
    .map((t) => ({ t, k: normalizarMemo(t.memo).join(" ") }))
    .sort((a, b) => a.k.localeCompare(b.k))
    .map((x) => x.t);
  const out: T[][] = [];
  for (let i = 0; i < ordenadas.length; i += tamanho) out.push(ordenadas.slice(i, i + tamanho));
  return out;
}

/**
 * Regras valem para pendentes sem sugestão ou com sugestão da IA (regra nova sobrepõe a IA);
 * transferências e IA só para as sem sugestão. A IA pega até `maxIa` por chamada, em lotes de LOTE_IA
 * (PARALELO_IA simultâneos), dentro do prazo; o que sobrar volta em `restantes`.
 */
export async function sugerirPendentes(
  empresaId: string, transacaoIds?: string[], { ia = true, maxIa = MAX_IA }: { ia?: boolean; maxIa?: number } = {},
): Promise<ResultadoSugestao> {
  const prazo = Date.now() + PRAZO_IA_MS;
  const out: ResultadoSugestao = { regras: 0, transferencias: 0, ia: 0, restantes: 0, erros: [] };

  const [pendentes, regrasAtivas, contas] = await Promise.all([
    db
      .select({
        id: transacoesBancarias.id, contaBancariaId: transacoesBancarias.contaBancariaId, data: transacoesBancarias.data,
        valor: transacoesBancarias.valor, memo: transacoesBancarias.memo,
        contaContabilBanco: contasBancarias.contaContabilId, sugestaoOrigem: transacoesBancarias.sugestaoOrigem,
      })
      .from(transacoesBancarias)
      .innerJoin(contasBancarias, eq(contasBancarias.id, transacoesBancarias.contaBancariaId))
      .where(and(
        eq(contasBancarias.empresaId, empresaId), eq(transacoesBancarias.status, "pendente"),
        or(isNull(transacoesBancarias.sugestaoOrigem), eq(transacoesBancarias.sugestaoOrigem, "ia")),
      )),
    db.select().from(regras).where(and(eq(regras.empresaId, empresaId), eq(regras.ativa, true))),
    db.select({ id: planoContas.id, codigo: planoContas.codigo, nome: planoContas.nome, natureza: planoContas.natureza })
      .from(planoContas)
      .where(and(eq(planoContas.empresaId, empresaId), eq(planoContas.tipo, "analitica"), eq(planoContas.ativa, true))),
  ]);
  if (!pendentes.length) return out;

  const filtro = transacaoIds && new Set(transacaoIds);
  const alvos = filtro ? pendentes.filter((t) => filtro.has(t.id)) : pendentes;
  const resolvidas = new Set<string>();

  const porId = new Map(pendentes.map((t) => [t.id, t]));

  await db.transaction(async (tx) => {
    for (const t of alvos) {
      const r = primeiraRegra(regrasAtivas, t);
      if (!r) continue;
      await tx.update(transacoesBancarias).set({
        sugestaoContaId: r.contaId, sugestaoRegraId: r.id, sugestaoOrigem: "regra", sugestaoConfianca: "1.00",
        sugestaoHistorico: aplicarTemplate(r.historicoTemplate, t), sugestaoJustificativa: null,
      }).where(eq(transacoesBancarias.id, t.id));
      resolvidas.add(t.id);
      out.regras++;
    }

    // Candidatas: todas as pendentes sem sugestão da empresa, não só as novas.
    const semSugestao = pendentes.filter((t) => !t.sugestaoOrigem && !resolvidas.has(t.id));
    for (const [sId, eId] of parearTransferencias(semSugestao)) {
      for (const [eu, par] of [[sId, eId], [eId, sId]] as const) {
        await tx.update(transacoesBancarias).set({
          sugestaoContaId: porId.get(par)!.contaContabilBanco, sugestaoRegraId: null, sugestaoOrigem: "transferencia",
          sugestaoConfianca: "0.90", sugestaoHistorico: "Transferência entre contas", sugestaoJustificativa: null, transferenciaParId: par,
        }).where(eq(transacoesBancarias.id, eu));
        resolvidas.add(eu);
      }
      out.transferencias++;
    }
  });

  const semIa = alvos.filter((t) => !t.sugestaoOrigem && !resolvidas.has(t.id));
  if (!ia || !semIa.length) return out;
  out.restantes = semIa.length;
  if (!process.env.ANTHROPIC_API_KEY) {
    out.erros.push("IA desativada: ANTHROPIC_API_KEY ausente");
    return out;
  }

  const contasIA = contas.map(({ codigo, nome, natureza }) => ({ codigo, nome, natureza }));
  const idPorCodigo = new Map(contas.map((c) => [c.codigo, c.id]));
  const pool = await exemplosAprovados(empresaId);
  const fila = lotesIA(semIa.slice(0, maxIa));

  const trabalhador = async () => {
    for (let lote = fila.shift(); lote; lote = fila.shift()) {
      const resta = prazo - Date.now();
      if (resta < MIN_PARA_LOTE_MS) return;
      try {
        const sugestoes = await classificarLoteIA(lote, contasIA, selecionarExemplos(pool, lote), { timeoutMs: resta });
        await Promise.all([...sugestoes].map(async ([i, s]) => {
          // Só se continua pendente e sem sugestão: o usuário pode ter agido enquanto a IA rodava.
          const feitas = await db.update(transacoesBancarias).set({
            sugestaoContaId: idPorCodigo.get(s.contaCodigo)!, sugestaoRegraId: null, sugestaoOrigem: "ia",
            sugestaoConfianca: s.confianca.toFixed(2), sugestaoHistorico: s.historico, sugestaoJustificativa: s.justificativa,
          }).where(and(eq(transacoesBancarias.id, lote[i].id), eq(transacoesBancarias.status, "pendente"), isNull(transacoesBancarias.sugestaoOrigem)))
            .returning({ id: transacoesBancarias.id });
          out.ia += feitas.length;
        }));
      } catch (e) {
        out.erros.push(`IA (lote de ${lote.length}): ${(e as Error)?.message ?? String(e)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: PARALELO_IA }, trabalhador));
  out.restantes = semIa.length - out.ia;
  return out;
}
