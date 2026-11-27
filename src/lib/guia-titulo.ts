/**
 * Guia anexada no Fechamento vira obrigação (título a pagar, origem guia) já no upload: reconhecida no último dia do mês
 * da competência, D despesa do tributo / C a recolher (ou só o título, quando a obrigação já está registrada).
 * Editar a guia ajusta o título por estorno + novo (mês aberto); remover cancela. Guia já baixada pelo banco não muda.
 */
import { and, eq, gt } from "drizzle-orm";
import type { Tx } from "@/db";
import { baixas, lancamentos, partidas, planoContas, titulos } from "@/db/schema";
import { cents, fimDoMes, fmtCompetencia, fromCents, primeiroDiaDoMes } from "./format";
import { rotuloGuia, type TipoGuia } from "./guias";
import { criarLancamento, estornarLancamento, mesesFechados } from "./lancamentos";
import { historicoTitulo, partidasTitulo } from "./operacoes";
import { contaSobDemanda } from "./conciliacao";
import { acharConta, contasDaGuia } from "./tributos";
import { cancelarTitulo, contaAnalitica, criarTitulo, validarContasTitulo } from "./titulos";

export type GuiaBase = { id: string; tipo: TipoGuia; descricao: string | null; valor: string; vencimento: string; codigoReceita: string | null };
/** Contas da obrigação: `despesaId` null = obrigação já registrada (sem lançamento). */
export type ContasGuiaEscolhidas = { obrigacaoId: string; despesaId: string | null };

/** Contraparte, descrição e data do título da guia (puro). */
export function dadosTituloGuia(g: GuiaBase, competencia: string) {
  return {
    contraparte: g.tipo === "das" || g.tipo === "das_mei" ? "Simples Nacional (Receita Federal)" : "Receita Federal",
    descricao: `${rotuloGuia(g)} ${fmtCompetencia(competencia)}`,
    documento: g.codigoReceita ? `${rotuloGuia(g)} ${g.codigoReceita}` : rotuloGuia(g),
    competencia: fimDoMes(competencia),
  };
}

export type EstadoObrigacao = { valor: string; vencimento: string | null; obrigacaoId: string; despesaId: string | null };

/**
 * O que a edição da guia faz no título (puro): nada; só o vencimento (não mexe no lançamento); ou reconhecer de novo
 * (estorno + novo) quando muda valor ou conta. Baixa pelo banco ou mês fechado recusam.
 */
export function ajusteGuia(antes: EstadoObrigacao, depois: EstadoObrigacao, ctx: { temBaixa: boolean; mesFechado: boolean; competencia: string }) {
  const reconhecer = cents(antes.valor) !== cents(depois.valor) || antes.obrigacaoId !== depois.obrigacaoId || antes.despesaId !== depois.despesaId;
  const vencimento = antes.vencimento !== depois.vencimento;
  if (!reconhecer && !vencimento) return "nada" as const;
  if (ctx.temBaixa) throw new Error("Esta guia já foi baixada (na conciliação ou consolidada num parcelamento): desfaça a baixa ou cancele o parcelamento antes de mudar a guia");
  if (!reconhecer) return "vencimento" as const;
  if (ctx.mesFechado) throw new Error(`O mês ${fmtCompetencia(ctx.competencia)} está fechado: reabra-o em Fechamento para mudar a obrigação da guia`);
  return "reconhecer" as const;
}

/** Contas escolhidas no diálogo, ou as do mapa do tributo (cria a analítica que faltar, ex.: PIS/COFINS/CSLL retidos). */
export async function resolverContasGuia(tx: Tx, empresaId: string, g: Pick<GuiaBase, "tipo" | "codigoReceita">, escolhidas?: ContasGuiaEscolhidas | null) {
  if (escolhidas) return escolhidas;
  const mapa = contasDaGuia(g.tipo, g.codigoReceita);
  if (!mapa) throw new Error("Tributo desta guia não reconhecido pelo código da receita: escolha as contas da obrigação");
  const contas = await tx
    .select({ id: planoContas.id, codigo: planoContas.codigo, nome: planoContas.nome, papel: planoContas.papel })
    .from(planoContas)
    .where(and(eq(planoContas.empresaId, empresaId), eq(planoContas.tipo, "analitica"), eq(planoContas.ativa, true)));
  const resolver = async (alvo: typeof mapa.obrigacao) => {
    const c = acharConta(contas, alvo);
    if (c) return c.id;
    if (alvo.criar) return (await contaSobDemanda(tx, empresaId, { paiCodigo: alvo.criar.pai, nome: alvo.criar.nome, natureza: alvo.criar.natureza })).id;
    throw new Error(`Conta de ${mapa.tributo} não encontrada no plano: escolha as contas da obrigação`);
  };
  const obrigacaoId = await resolver(mapa.obrigacao);
  const despesaId = mapa.modo === "despesa" && mapa.despesa ? await resolver(mapa.despesa) : null;
  return { obrigacaoId, despesaId };
}

const tituloDaGuia = async (tx: Tx, guiaId: string) =>
  (await tx.select().from(titulos).where(eq(titulos.guiaId, guiaId)).for("update"))[0];

/**
 * Título da guia recém-anexada. Mês da competência fechado: não registra (a guia entra igual) e devolve o aviso.
 */
export async function criarTituloDaGuia(tx: Tx, p: {
  empresaId: string; guia: GuiaBase; competencia: string; contas?: ContasGuiaEscolhidas | null; usuarioId?: string | null;
}): Promise<{ aviso?: string }> {
  if ((await mesesFechados(tx, p.empresaId)).has(primeiroDiaDoMes(p.competencia)))
    return { aviso: `Mês ${fmtCompetencia(p.competencia)} fechado: a obrigação desta guia não foi registrada em Títulos.` };
  const contas = await resolverContasGuia(tx, p.empresaId, p.guia, p.contas);
  const d = dadosTituloGuia(p.guia, p.competencia);
  await criarTitulo(tx, {
    empresaId: p.empresaId, tipo: "pagar", ...d, valor: p.guia.valor, vencimento: p.guia.vencimento,
    contaId: contas.obrigacaoId, contaResultadoId: contas.despesaId, origem: "guia", guiaId: p.guia.id, usuarioId: p.usuarioId,
  });
  return {};
}

/** Conta debitada no reconhecimento do título a pagar (a despesa), ou null sem lançamento. */
async function despesaDoReconhecimento(tx: Tx, lancamentoId: string | null) {
  if (!lancamentoId) return null;
  const [p] = await tx.select({ contaId: partidas.contaId }).from(partidas)
    .where(and(eq(partidas.lancamentoId, lancamentoId), gt(partidas.debito, "0"))).orderBy(partidas.ordem).limit(1);
  return p?.contaId ?? null;
}

/** Guia editada: ajusta o título (sem título ainda, cria). */
export async function atualizarTituloDaGuia(tx: Tx, p: {
  empresaId: string; guia: GuiaBase; competencia: string; contas?: ContasGuiaEscolhidas | null; usuarioId?: string | null;
}): Promise<{ aviso?: string }> {
  const t = await tituloDaGuia(tx, p.guia.id);
  if (!t || t.status === "cancelado") return criarTituloDaGuia(tx, p);
  const fechados = await mesesFechados(tx, p.empresaId);
  const antes: EstadoObrigacao = {
    valor: t.valor, vencimento: t.vencimento, obrigacaoId: t.contaId ?? "", despesaId: await despesaDoReconhecimento(tx, t.lancamentoId),
  };
  // sem contas na edição (mês fechado no diálogo): valem as do próprio título, não as do mapa do tributo
  const contas = p.contas ?? (t.contaId ? { obrigacaoId: t.contaId, despesaId: antes.despesaId } : await resolverContasGuia(tx, p.empresaId, p.guia));
  const [b] = await tx.select({ id: baixas.id }).from(baixas).where(eq(baixas.tituloId, t.id)).limit(1);
  const d = dadosTituloGuia(p.guia, p.competencia);
  const acao = ajusteGuia(antes, { valor: p.guia.valor, vencimento: p.guia.vencimento, ...contas }, {
    temBaixa: !!b, mesFechado: fechados.has(primeiroDiaDoMes(t.competencia)) || fechados.has(primeiroDiaDoMes(d.competencia)), competencia: p.competencia,
  });
  if (acao === "nada") return {};
  if (acao === "vencimento") {
    await tx.update(titulos).set({ vencimento: p.guia.vencimento }).where(eq(titulos.id, t.id));
    return {};
  }
  const obrigacao = await contaAnalitica(tx, p.empresaId, contas.obrigacaoId);
  const despesa = contas.despesaId ? await contaAnalitica(tx, p.empresaId, contas.despesaId) : null;
  validarContasTitulo("pagar", obrigacao, despesa);
  if (t.lancamentoId) {
    const [orig] = await tx.select({ data: lancamentos.data, status: lancamentos.status }).from(lancamentos).where(eq(lancamentos.id, t.lancamentoId));
    if (orig.status !== "estornado") await estornarLancamento(tx, t.lancamentoId, orig.data, p.usuarioId);
  }
  const valor = fromCents(cents(p.guia.valor));
  const l = despesa && await criarLancamento(tx, {
    empresaId: p.empresaId, data: d.competencia, historico: historicoTitulo("pagar", d.contraparte, d.descricao),
    documento: d.documento, origem: "manual", usuarioId: p.usuarioId,
    partidas: partidasTitulo("pagar", obrigacao.id, despesa.id, valor),
  });
  await tx.update(titulos).set({
    valor, vencimento: p.guia.vencimento, contaId: obrigacao.id, lancamentoId: l ? l.id : null,
    contraparte: d.contraparte, descricao: d.descricao, documento: d.documento, competencia: d.competencia,
  }).where(eq(titulos.id, t.id));
  return {};
}

/** Guia removida: cancela o título (estorno no mês da competência, que precisa estar aberto). */
export async function cancelarTituloDaGuia(tx: Tx, empresaId: string, guiaId: string, usuarioId?: string | null) {
  const t = await tituloDaGuia(tx, guiaId);
  if (!t || t.status === "cancelado") return;
  const [b] = await tx.select({ id: baixas.id }).from(baixas).where(eq(baixas.tituloId, t.id)).limit(1);
  if (b) throw new Error("Esta guia já foi baixada (na conciliação ou consolidada num parcelamento): desfaça a baixa ou cancele o parcelamento antes de remover a guia");
  await cancelarTitulo(tx, empresaId, t.id, usuarioId, { origens: ["guia"], mesAberto: true });
}
