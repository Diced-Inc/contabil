import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { contasBancarias, lancamentos, partidas, planoContas, regras, transacoesBancarias } from "@/db/schema";
import { classificarComIA, type ExemploIA } from "./ia";
import { aplicarTemplate, primeiraRegra } from "./regras";
import { parearTransferencias } from "./transferencias";

const CONCORRENCIA_IA = 4;
const MAX_EXEMPLOS = 30;

export type ResultadoSugestao = { regras: number; transferencias: number; ia: number; erros: string[] };

/** Exemplos few-shot: últimas conciliações aprovadas da empresa (memo → conta de contrapartida). */
async function exemplosAprovados(empresaId: string): Promise<ExemploIA[]> {
  const txs = await db
    .select({ memo: transacoesBancarias.memo, valor: transacoesBancarias.valor, lancamentoId: lancamentos.id, contaBanco: contasBancarias.contaContabilId })
    .from(transacoesBancarias)
    .innerJoin(contasBancarias, eq(contasBancarias.id, transacoesBancarias.contaBancariaId))
    .innerJoin(lancamentos, eq(lancamentos.id, transacoesBancarias.lancamentoId))
    .where(and(eq(contasBancarias.empresaId, empresaId), eq(transacoesBancarias.status, "classificada"), eq(lancamentos.status, "aprovado")))
    .orderBy(desc(lancamentos.createdAt))
    .limit(MAX_EXEMPLOS);
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

/**
 * Regras valem para pendentes sem sugestão ou com sugestão da IA (regra nova sobrepõe a IA);
 * transferências e IA só para as sem sugestão. IA limitada a `limiteIa` por chamada (tempo de função).
 */
export async function sugerirPendentes(
  empresaId: string, transacaoIds?: string[], { ia = true, limiteIa = 40 }: { ia?: boolean; limiteIa?: number } = {},
): Promise<ResultadoSugestao> {
  const out: ResultadoSugestao = { regras: 0, transferencias: 0, ia: 0, erros: [] };

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
  const restantes = semIa.slice(0, limiteIa);
  if (semIa.length > limiteIa) {
    out.erros.push(`IA: ${semIa.length - limiteIa} transações restantes, clique em Sugerir com IA novamente`);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    out.erros.push("IA desativada: ANTHROPIC_API_KEY ausente");
    return out;
  }

  const contasIA = contas.map(({ codigo, nome, natureza }) => ({ codigo, nome, natureza }));
  const idPorCodigo = new Map(contas.map((c) => [c.codigo, c.id]));
  const exemplos = await exemplosAprovados(empresaId);

  for (let i = 0; i < restantes.length; i += CONCORRENCIA_IA) {
    const fatia = restantes.slice(i, i + CONCORRENCIA_IA);
    const res = await Promise.allSettled(fatia.map(async (t) => {
      const s = await classificarComIA(t, contasIA, exemplos);
      await db.update(transacoesBancarias).set({
        sugestaoContaId: idPorCodigo.get(s.contaCodigo)!, sugestaoRegraId: null, sugestaoOrigem: "ia",
        sugestaoConfianca: s.confianca.toFixed(2), sugestaoHistorico: s.historico, sugestaoJustificativa: s.justificativa,
      }).where(and(eq(transacoesBancarias.id, t.id), isNull(transacoesBancarias.sugestaoOrigem)));
    }));
    res.forEach((r, k) => {
      if (r.status === "fulfilled") out.ia++;
      else out.erros.push(`${fatia[k].memo.slice(0, 40)}: ${(r.reason as Error)?.message ?? String(r.reason)}`);
    });
  }
  return out;
}
