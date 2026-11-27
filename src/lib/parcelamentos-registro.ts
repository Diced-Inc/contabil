/** Parcelamento no banco: registrar, transferir LP → CP e cancelar (regras puras em ./parcelamentos). */
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import type { Tx } from "@/db";
import { lancamentos, parcelamentoLancamentos, parcelamentos, titulos } from "@/db/schema";
import { cents, fmtCompetencia, fmtData, fromCents, hoje, primeiroDiaDoMes, somarMeses } from "./format";
import { criarLancamento, dataNoMesAberto, estornarLancamento, mesesFechados } from "./lancamentos";
import { montarParcelamento, PARCELAS_CP, parcelasParaCurtoPrazo, type MovimentoCurtoPrazo, type ParcelamentoInput } from "./parcelamentos";
import { contaAnalitica, criarTitulo, somasBaixas } from "./titulos";

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
