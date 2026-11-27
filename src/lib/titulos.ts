import { and, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { baixas, lancamentos, planoContas, titulos } from "@/db/schema";
import { cents, fromCents, hoje, PAPEIS } from "./format";
import { criarLancamento, dataNoMesAberto, estornarLancamento, mesesFechados } from "./lancamentos";
import {
  bancoDoItem, historicoBaixa, historicoTitulo, partidasBaixas, partidasTitulo, statusPorBaixas, type ItemBaixa, type TipoTitulo,
} from "./operacoes";

export type { TipoTitulo };
export type Papel = keyof typeof PAPEIS;

export async function contaPorPapel(tx: Tx, empresaId: string, papel: Papel) {
  const [c] = await tx
    .select({ id: planoContas.id, codigo: planoContas.codigo, nome: planoContas.nome })
    .from(planoContas)
    .where(and(eq(planoContas.empresaId, empresaId), eq(planoContas.papel, papel)));
  if (!c) throw new Error(`Marque uma conta com o papel ${PAPEIS[papel]} no plano de contas`);
  return c;
}

export const papelDo = (tipo: TipoTitulo): Papel => (tipo === "receber" ? "clientes" : "fornecedores");

export type TituloInput = {
  empresaId: string; tipo: TipoTitulo; contraparte: string; documento?: string | null; descricao: string;
  valor: string; competencia: string; vencimento?: string | null; contaResultadoId: string; usuarioId?: string | null;
};

/** Lançamento de competência na data do fato: receber D Clientes / C resultado; pagar D resultado / C Fornecedores. */
export async function criarTitulo(tx: Tx, input: TituloInput) {
  if (!(cents(input.valor) > 0)) throw new Error("Valor do título deve ser maior que zero");
  const valor = fromCents(cents(input.valor));
  const papel = await contaPorPapel(tx, input.empresaId, papelDo(input.tipo));
  const l = await criarLancamento(tx, {
    empresaId: input.empresaId, data: input.competencia,
    historico: historicoTitulo(input.tipo, input.contraparte, input.descricao),
    documento: input.documento ?? null, origem: "manual", usuarioId: input.usuarioId,
    partidas: partidasTitulo(input.tipo, papel.id, input.contaResultadoId, valor),
  });
  const [t] = await tx.insert(titulos).values({
    empresaId: input.empresaId, tipo: input.tipo, contraparte: input.contraparte, documento: input.documento ?? null,
    descricao: input.descricao, valor, competencia: input.competencia, vencimento: input.vencimento ?? null,
    lancamentoId: l.id,
  }).returning();
  return t;
}

/**
 * Só título aberto (sem baixa); estorna o lançamento de competência na data dele enquanto o mês estiver aberto (senão
 * hoje; hoje também fechado → pede para reabrir) e marca cancelado.
 */
export async function cancelarTitulo(tx: Tx, empresaId: string, id: string, usuarioId?: string | null) {
  const [t] = await tx
    .update(titulos)
    .set({ status: "cancelado" })
    .where(and(eq(titulos.id, id), eq(titulos.empresaId, empresaId), eq(titulos.status, "aberto"),
      // SQL cru: num update de tabela única o drizzle não qualifica a coluna (casaria b.id)
      sql`not exists (select 1 from baixas b where b.titulo_id = "titulos"."id")`))
    .returning();
  if (!t) throw new Error("Título não encontrado ou não está em aberto (com baixa parcial, desfaça a conciliação da baixa antes)");
  if (t.lancamentoId) {
    const [orig] = await tx.select({ data: lancamentos.data }).from(lancamentos).where(eq(lancamentos.id, t.lancamentoId));
    const data = dataNoMesAberto(orig.data, hoje(), await mesesFechados(tx, empresaId), "cancelar o título");
    await estornarLancamento(tx, t.lancamentoId, data, usuarioId);
  }
  return t;
}

/** Soma abatida (centavos) por título. */
async function somasBaixas(tx: Tx, ids: string[]) {
  if (!ids.length) return new Map<string, number>();
  const rs = await tx
    .select({ id: baixas.tituloId, s: sql<string>`coalesce(sum(${baixas.valor}), 0)::text` })
    .from(baixas)
    .where(inArray(baixas.tituloId, ids))
    .groupBy(baixas.tituloId);
  return new Map(rs.map((r) => [r.id, cents(r.s)]));
}

/** Recalcula aberto/parcial/quitado pela soma das baixas (cancelado não muda). */
export async function recalcularStatus(tx: Tx, ids: string[]) {
  const unicos = [...new Set(ids)];
  if (!unicos.length) return;
  const ts = await tx.select({ id: titulos.id, valor: titulos.valor, status: titulos.status }).from(titulos).where(inArray(titulos.id, unicos));
  const somas = await somasBaixas(tx, unicos);
  for (const t of ts) {
    if (t.status === "cancelado") continue;
    const status = statusPorBaixas(t.valor, somas.get(t.id) ?? 0);
    if (status !== t.status) await tx.update(titulos).set({ status }).where(eq(titulos.id, t.id));
  }
}

export type BaixaTitulos = {
  empresaId: string; transacao: { id: string; contaBanco: string; data: string; valor: string };
  itens: (ItemBaixa & { tituloId: string })[]; contaJurosId?: string | null; contaDescontoId?: string | null;
  usuarioId?: string | null;
};

/**
 * Baixa (total ou parcial) de um ou mais títulos pela mesma transação: um lançamento na data do extrato, uma linha
 * em `baixas` por título e o status recalculado. Σ(valor + juros − desconto) precisa ser o valor da transação.
 */
export async function baixarTitulos(tx: Tx, input: BaixaTitulos) {
  const ids = input.itens.map((i) => i.tituloId);
  if (!ids.length) throw new Error("Escolha ao menos um título");
  if (new Set(ids).size !== ids.length) throw new Error("Título repetido na baixa");
  // trava em ordem de id: duas baixas simultâneas do mesmo título não passam do saldo
  const ts = await tx.select().from(titulos)
    .where(and(inArray(titulos.id, ids), eq(titulos.empresaId, input.empresaId)))
    .orderBy(titulos.id)
    .for("update");
  if (ts.length !== ids.length) throw new Error("Título não encontrado");
  const entrada = cents(input.transacao.valor) > 0;
  const tipo: TipoTitulo = entrada ? "receber" : "pagar";
  const somas = await somasBaixas(tx, ids);
  for (const t of ts) {
    if (t.tipo !== tipo) throw new Error(entrada ? "Entrada só baixa título a receber" : "Saída só baixa título a pagar");
    if (t.status !== "aberto" && t.status !== "parcial") throw new Error(`Título ${t.contraparte} não está em aberto`);
    const item = input.itens.find((i) => i.tituloId === t.id)!;
    const saldo = cents(t.valor) - (somas.get(t.id) ?? 0);
    if (cents(item.valor) > saldo)
      throw new Error(`Valor a abater de ${t.contraparte} (${fromCents(cents(item.valor))}) passa do saldo em aberto (${fromCents(saldo)})`);
  }
  const total = input.itens.reduce((s, i) => s + bancoDoItem(i), 0);
  if (total !== Math.abs(cents(input.transacao.valor)))
    throw new Error(`Baixa de ${fromCents(total)} difere do valor da transação (${fromCents(Math.abs(cents(input.transacao.valor)))})`);
  const papel = await contaPorPapel(tx, input.empresaId, papelDo(tipo));
  const ordenados = ids.map((id) => ts.find((t) => t.id === id)!);
  const l = await criarLancamento(tx, {
    empresaId: input.empresaId, data: input.transacao.data, dataPagamento: input.transacao.data,
    historico: historicoBaixa(tipo, ordenados), documento: ordenados.length === 1 ? ordenados[0].documento : null,
    origem: "conciliacao", usuarioId: input.usuarioId,
    partidas: partidasBaixas({
      tipo, contaBancoId: input.transacao.contaBanco, contaPapelId: papel.id, itens: input.itens,
      contaJurosId: input.contaJurosId, contaDescontoId: input.contaDescontoId,
    }),
  });
  await tx.insert(baixas).values(input.itens.map((i) => ({
    tituloId: i.tituloId, transacaoId: input.transacao.id, lancamentoId: l.id, valor: fromCents(cents(i.valor)),
    juros: fromCents(cents(i.juros || 0)), desconto: fromCents(cents(i.desconto || 0)), createdBy: input.usuarioId ?? null,
  })));
  await recalcularStatus(tx, ids);
  return l;
}

/** Desfaz as baixas de um lançamento (desfazer conciliação) e reabre os títulos. Retorna quantos títulos voltaram. */
export async function removerBaixas(tx: Tx, lancamentoId: string) {
  // trava os títulos em ordem de id (como baixarTitulos): uma baixa simultânea não recalcula com a baixa que sai
  const afetados = await tx.selectDistinct({ id: baixas.tituloId }).from(baixas).where(eq(baixas.lancamentoId, lancamentoId));
  if (afetados.length)
    await tx.select({ id: titulos.id }).from(titulos).where(inArray(titulos.id, afetados.map((r) => r.id))).orderBy(titulos.id).for("update");
  const rs = await tx.delete(baixas).where(eq(baixas.lancamentoId, lancamentoId)).returning({ tituloId: baixas.tituloId });
  await recalcularStatus(tx, rs.map((r) => r.tituloId));
  return new Set(rs.map((r) => r.tituloId)).size;
}
