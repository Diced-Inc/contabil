/**
 * Parcelamento de tributos: reconhece a dívida consolidada (principal + multa + juros) em Parcelamentos de Tributos,
 * curto prazo (as próximas 12 parcelas) e longo prazo (o resto); cada parcela é um título a pagar na conta dela, baixado
 * pela conciliação. "Transferir para curto prazo" leva do LP para o CP as parcelas que vencem em até 12 meses.
 */
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import type { Tx } from "@/db";
import { lancamentos, parcelamentoLancamentos, parcelamentos, titulos } from "@/db/schema";
import { cents, fmtCompetencia, fmtData, fromCents, hoje, primeiroDiaDoMes, somarMeses } from "./format";
import { criarLancamento, dataNoMesAberto, estornarLancamento, mesesFechados, type PartidaInput } from "./lancamentos";
import { contaAnalitica, criarTitulo, somasBaixas } from "./titulos";

export const PARCELAS_CP = 12;

export type Parcela = { numero: number; vencimento: string; valor: number };

/** Parcelas mensais (centavos): n − 1 no valor informado e a última com o resto, para somar o total exato. */
export function parcelasDoParcelamento(p: { total: number; n: number; valorParcela: number; primeiroVencimento: string }): Parcela[] {
  if (!Number.isInteger(p.n) || p.n < 1 || p.n > 240) throw new Error("Número de parcelas entre 1 e 240");
  if (!(p.total > 0)) throw new Error("A dívida consolidada precisa ser maior que zero");
  if (!(p.valorParcela > 0)) throw new Error("Valor da parcela precisa ser maior que zero");
  const ultima = p.total - (p.n - 1) * p.valorParcela;
  if (ultima <= 0) throw new Error(`${p.n} parcelas de ${fromCents(p.valorParcela)} passam da dívida consolidada (${fromCents(p.total)}): reduza o valor ou as parcelas`);
  return Array.from({ length: p.n }, (_, i) => ({
    numero: i + 1, vencimento: somarMeses(p.primeiroVencimento, i), valor: i === p.n - 1 ? ultima : p.valorParcela,
  }));
}

/** Valor sugerido da parcela: o total dividido igualmente (centavos, arredondado). */
export const parcelaSugerida = (total: number, n: number) => (n > 0 ? Math.round(total / n) : 0);

/** CP = as próximas 12 parcelas; LP = o resto (centavos). */
export function divisaoCpLp(parcelas: Parcela[]) {
  const cp = parcelas.slice(0, PARCELAS_CP).reduce((s, x) => s + x.valor, 0);
  const lp = parcelas.slice(PARCELAS_CP).reduce((s, x) => s + x.valor, 0);
  return { cp, lp };
}

/**
 * Reconhecimento: D principal (a obrigação original, se já reconhecida, ou a despesa do tributo) + D multa + D juros /
 * C Parcelamentos CP + C Parcelamentos LP.
 */
export function partidasParcelamento(p: {
  principal: number; multa: number; juros: number; cp: number; lp: number;
  contaPrincipalId: string; contaMultaId: string | null; contaJurosId: string | null; contaCpId: string; contaLpId: string;
}): PartidaInput[] {
  if (p.principal + p.multa + p.juros !== p.cp + p.lp) throw new Error("Principal + multa + juros difere da soma das parcelas");
  if (p.multa && !p.contaMultaId) throw new Error("Escolha a conta da multa");
  if (p.juros && !p.contaJurosId) throw new Error("Escolha a conta dos juros");
  const f = fromCents;
  return [
    ...(p.principal ? [{ contaId: p.contaPrincipalId, debito: f(p.principal) }] : []),
    ...(p.multa ? [{ contaId: p.contaMultaId!, debito: f(p.multa) }] : []),
    ...(p.juros ? [{ contaId: p.contaJurosId!, debito: f(p.juros) }] : []),
    ...(p.cp ? [{ contaId: p.contaCpId, credito: f(p.cp) }] : []),
    ...(p.lp ? [{ contaId: p.contaLpId, credito: f(p.lp) }] : []),
  ];
}

export type ParcelaAberta = { id: string; vencimento: string | null; contaId: string | null; saldo: number };

/** Parcelas no LP com saldo que vencem em até 12 meses da data (inclusive): vão para o CP. */
export function parcelasParaCurtoPrazo<T extends ParcelaAberta>(ps: T[], contaLpId: string, data: string) {
  const limite = somarMeses(data, PARCELAS_CP);
  return ps.filter((x) => x.contaId === contaLpId && x.saldo > 0 && !!x.vencimento && x.vencimento <= limite);
}

export type ParcelamentoInput = {
  empresaId: string; descricao: string; principal: string; multa: string; juros: string; nParcelas: number; valorParcela: string;
  primeiroVencimento: string; data: string; contaPrincipalId: string; contaMultaId: string | null; contaJurosId: string | null;
  contaCpId: string; contaLpId: string; contraparte?: string; usuarioId?: string | null;
};

/** Parcelas, divisão CP/LP e partidas do parcelamento (puro: a prévia do cliente usa o mesmo). */
export function montarParcelamento(p: Omit<ParcelamentoInput, "empresaId" | "usuarioId">) {
  const principal = cents(p.principal), multa = cents(p.multa || 0), juros = cents(p.juros || 0);
  if ([principal, multa, juros].some((x) => Number.isNaN(x) || x < 0)) throw new Error("Principal, multa e juros: zero ou mais");
  if (p.contaCpId === p.contaLpId) throw new Error("Contas de curto e longo prazo precisam ser diferentes");
  const parcelas = parcelasDoParcelamento({ total: principal + multa + juros, n: p.nParcelas, valorParcela: cents(p.valorParcela), primeiroVencimento: p.primeiroVencimento });
  const { cp, lp } = divisaoCpLp(parcelas);
  const ps = partidasParcelamento({
    principal, multa, juros, cp, lp, contaPrincipalId: p.contaPrincipalId, contaMultaId: p.contaMultaId, contaJurosId: p.contaJurosId,
    contaCpId: p.contaCpId, contaLpId: p.contaLpId,
  });
  return { parcelas, cp, lp, partidas: ps, historico: `Parcelamento: ${p.descricao} (${p.nParcelas} parcelas)` };
}

const exigirMesAberto = async (tx: Tx, empresaId: string, data: string, acao: string) => {
  if ((await mesesFechados(tx, empresaId)).has(primeiroDiaDoMes(data)))
    throw new Error(`O mês ${fmtCompetencia(data)} está fechado: escolha uma data em mês aberto ou reabra o mês em Fechamento para ${acao}`);
};

export async function criarParcelamento(tx: Tx, input: ParcelamentoInput) {
  const m = montarParcelamento(input);
  await exigirMesAberto(tx, input.empresaId, input.data, "registrar o parcelamento");
  const cp = await contaAnalitica(tx, input.empresaId, input.contaCpId);
  const lp = await contaAnalitica(tx, input.empresaId, input.contaLpId);
  for (const c of [cp, lp]) if (!/^2\.[12]\./.test(c.codigo) || c.papel) throw new Error(`${c.codigo} ${c.nome}: parcelamento fica no passivo (circulante e não circulante)`);
  const principal = await contaAnalitica(tx, input.empresaId, input.contaPrincipalId);
  if (principal.papel || ![/^2\.[12]\./, /^3\./].some((re) => re.test(principal.codigo)) || [cp.id, lp.id].includes(principal.id))
    throw new Error(`${principal.codigo} ${principal.nome}: o principal debita a obrigação original (passivo) ou a despesa do tributo`);
  for (const id of [input.contaMultaId, input.contaJurosId].filter((x): x is string => !!x)) {
    const c = await contaAnalitica(tx, input.empresaId, id);
    if (!/^3\./.test(c.codigo) || c.papel) throw new Error(`${c.codigo} ${c.nome}: multa e juros são despesa (classe 3)`);
  }
  const [parc] = await tx.insert(parcelamentos).values({
    empresaId: input.empresaId, descricao: input.descricao, principal: fromCents(cents(input.principal)), multa: fromCents(cents(input.multa || 0)),
    juros: fromCents(cents(input.juros || 0)), nParcelas: input.nParcelas, valorParcela: fromCents(cents(input.valorParcela)),
    primeiroVencimento: input.primeiroVencimento, data: input.data, contaCpId: cp.id, contaLpId: lp.id, createdBy: input.usuarioId ?? null,
  }).returning();
  const l = await criarLancamento(tx, {
    empresaId: input.empresaId, data: input.data, historico: m.historico, origem: "manual", usuarioId: input.usuarioId, partidas: m.partidas,
  });
  await tx.insert(parcelamentoLancamentos).values({ parcelamentoId: parc.id, lancamentoId: l.id, tipo: "reconhecimento" });
  for (const x of m.parcelas)
    await criarTitulo(tx, {
      empresaId: input.empresaId, tipo: "pagar", contraparte: input.contraparte || "Receita Federal",
      descricao: `${input.descricao} - parcela ${x.numero}/${input.nParcelas}`, documento: `Parcela ${x.numero}/${input.nParcelas}`,
      valor: fromCents(x.valor), competencia: input.data, vencimento: x.vencimento, contaResultadoId: null,
      contaId: x.numero <= PARCELAS_CP ? cp.id : lp.id, origem: "parcelamento", parcela: x.numero, parcelamentoId: parc.id,
      usuarioId: input.usuarioId,
    });
  return { parcelamento: parc, lancamento: l };
}

/** Parcelas abertas (com saldo) de um parcelamento, travadas em ordem de id. */
async function parcelasAbertas(tx: Tx, parcelamentoId: string) {
  const ts = await tx.select({ id: titulos.id, vencimento: titulos.vencimento, contaId: titulos.contaId, valor: titulos.valor, parcela: titulos.parcela })
    .from(titulos)
    .where(and(eq(titulos.parcelamentoId, parcelamentoId), inArray(titulos.status, ["aberto", "parcial"])))
    .orderBy(titulos.id)
    .for("update");
  const somas = await somasBaixas(tx, ts.map((t) => t.id));
  return ts.map((t) => ({ ...t, saldo: cents(t.valor) - (somas.get(t.id) ?? 0) }));
}

export type MovimentoCurtoPrazo = { parcelamentoId: string; descricao: string; parcelas: number[]; valor: number; contaLpId: string; contaCpId: string };

/**
 * Prévia (aplicar = false) ou transferência LP → CP das parcelas que vencem em até 12 meses de `data`: um lançamento
 * D LP / C CP por parcelamento e os títulos passam para a conta do CP. Segunda chamada não acha nada (no-op).
 */
export async function transferirParaCurtoPrazo(tx: Tx, p: { empresaId: string; data: string; aplicar: boolean; usuarioId?: string | null }) {
  if (p.aplicar) await exigirMesAberto(tx, p.empresaId, p.data, "transferir para o curto prazo");
  const ativos = await tx.select().from(parcelamentos)
    .where(and(eq(parcelamentos.empresaId, p.empresaId), eq(parcelamentos.status, "ativo")))
    .orderBy(asc(parcelamentos.id))
    .for("update");
  const movs: MovimentoCurtoPrazo[] = [];
  for (const parc of ativos) {
    const mover = parcelasParaCurtoPrazo(await parcelasAbertas(tx, parc.id), parc.contaLpId, p.data);
    if (!mover.length) continue;
    const valor = mover.reduce((s, x) => s + x.saldo, 0);
    movs.push({
      parcelamentoId: parc.id, descricao: parc.descricao, parcelas: mover.map((x) => x.parcela ?? 0).sort((a, b) => a - b), valor,
      contaLpId: parc.contaLpId, contaCpId: parc.contaCpId,
    });
    if (!p.aplicar) continue;
    const l = await criarLancamento(tx, {
      empresaId: p.empresaId, data: p.data, origem: "manual", usuarioId: p.usuarioId,
      historico: `Transferência para o curto prazo: ${parc.descricao} (vencem até ${fmtData(somarMeses(p.data, PARCELAS_CP))})`,
      partidas: [{ contaId: parc.contaLpId, debito: fromCents(valor) }, { contaId: parc.contaCpId, credito: fromCents(valor) }],
    });
    await tx.insert(parcelamentoLancamentos).values({ parcelamentoId: parc.id, lancamentoId: l.id, tipo: "reclassificacao" });
    await tx.update(titulos).set({ contaId: parc.contaCpId }).where(inArray(titulos.id, mover.map((x) => x.id)));
  }
  return movs;
}

/**
 * Cancela o parcelamento sem nenhuma parcela baixada: estorna o reconhecimento e as transferências (no mês de cada um
 * enquanto aberto, senão hoje) e cancela as parcelas.
 */
export async function cancelarParcelamento(tx: Tx, empresaId: string, id: string, usuarioId?: string | null) {
  const [parc] = await tx.select().from(parcelamentos)
    .where(and(eq(parcelamentos.id, id), eq(parcelamentos.empresaId, empresaId), eq(parcelamentos.status, "ativo"))).for("update");
  if (!parc) throw new Error("Parcelamento não encontrado ou já cancelado");
  const ts = await tx.select({ id: titulos.id, status: titulos.status }).from(titulos).where(eq(titulos.parcelamentoId, id)).orderBy(titulos.id).for("update");
  const somas = await somasBaixas(tx, ts.map((t) => t.id));
  if ([...somas.values()].some((s) => s > 0) || ts.some((t) => t.status !== "aberto" && t.status !== "cancelado"))
    throw new Error("Há parcela baixada na conciliação: desfaça as baixas antes de cancelar o parcelamento");
  const ls = await tx.select({ id: lancamentos.id, data: lancamentos.data })
    .from(parcelamentoLancamentos)
    .innerJoin(lancamentos, eq(lancamentos.id, parcelamentoLancamentos.lancamentoId))
    .where(and(eq(parcelamentoLancamentos.parcelamentoId, id), eq(lancamentos.status, "aprovado"), ne(parcelamentoLancamentos.tipo, "cancelamento")));
  const fechados = await mesesFechados(tx, empresaId);
  for (const l of ls) {
    const e = await estornarLancamento(tx, l.id, dataNoMesAberto(l.data, hoje(), fechados, "cancelar o parcelamento"), usuarioId);
    await tx.insert(parcelamentoLancamentos).values({ parcelamentoId: id, lancamentoId: e.id, tipo: "cancelamento" });
  }
  await tx.update(titulos).set({ status: "cancelado" }).where(eq(titulos.parcelamentoId, id));
  await tx.update(parcelamentos).set({ status: "cancelado" }).where(eq(parcelamentos.id, id));
}
