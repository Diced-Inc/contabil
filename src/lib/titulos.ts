import { and, eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { planoContas, titulos } from "@/db/schema";
import { cents, fromCents, hoje, PAPEIS } from "./format";
import { criarLancamento, estornarLancamento, type PartidaInput } from "./lancamentos";

export type TipoTitulo = "receber" | "pagar";
export type Papel = keyof typeof PAPEIS;

export async function contaPorPapel(tx: Tx, empresaId: string, papel: Papel) {
  const [c] = await tx
    .select({ id: planoContas.id, codigo: planoContas.codigo, nome: planoContas.nome })
    .from(planoContas)
    .where(and(eq(planoContas.empresaId, empresaId), eq(planoContas.papel, papel)));
  if (!c) throw new Error(`Marque uma conta com o papel ${PAPEIS[papel]} no plano de contas`);
  return c;
}

const papelDo = (tipo: TipoTitulo): Papel => (tipo === "receber" ? "clientes" : "fornecedores");

export type TituloInput = {
  empresaId: string; tipo: TipoTitulo; contraparte: string; documento?: string | null; descricao: string;
  valor: string; competencia: string; vencimento?: string | null; contaResultadoId: string; usuarioId?: string | null;
};

/** Lançamento de competência na data do fato: receber D Clientes / C resultado; pagar D resultado / C Fornecedores. */
export async function criarTitulo(tx: Tx, input: TituloInput) {
  if (!(cents(input.valor) > 0)) throw new Error("Valor do título deve ser maior que zero");
  const valor = fromCents(cents(input.valor));
  const papel = await contaPorPapel(tx, input.empresaId, papelDo(input.tipo));
  const [d, c] = input.tipo === "receber" ? [papel.id, input.contaResultadoId] : [input.contaResultadoId, papel.id];
  const l = await criarLancamento(tx, {
    empresaId: input.empresaId, data: input.competencia,
    historico: `${input.tipo === "receber" ? "Título a receber" : "Título a pagar"}: ${input.contraparte} - ${input.descricao}`,
    documento: input.documento ?? null, origem: "manual", usuarioId: input.usuarioId,
    partidas: [{ contaId: d, debito: valor }, { contaId: c, credito: valor }],
  });
  const [t] = await tx.insert(titulos).values({
    empresaId: input.empresaId, tipo: input.tipo, contraparte: input.contraparte, documento: input.documento ?? null,
    descricao: input.descricao, valor, competencia: input.competencia, vencimento: input.vencimento ?? null,
    lancamentoId: l.id,
  }).returning();
  return t;
}

/** Só título aberto; estorna o lançamento de competência (data de hoje) e marca cancelado. */
export async function cancelarTitulo(tx: Tx, empresaId: string, id: string, usuarioId?: string | null) {
  const [t] = await tx
    .update(titulos)
    .set({ status: "cancelado" })
    .where(and(eq(titulos.id, id), eq(titulos.empresaId, empresaId), eq(titulos.status, "aberto")))
    .returning();
  if (!t) throw new Error("Título não encontrado ou não está em aberto");
  if (t.lancamentoId) await estornarLancamento(tx, t.lancamentoId, hoje(), usuarioId);
  return t;
}

/**
 * Partidas da baixa (valores em reais, string). receber: D Banco pago, C Clientes valor;
 * pagar: D Fornecedores valor, C Banco pago. A diferença vai para `contaDiferencaId`
 * no lado que fecha o lançamento (desconto/juros).
 */
export function partidasBaixa(p: {
  tipo: TipoTitulo; valorTitulo: string | number; valorPago: string | number;
  contaBancoId: string; contaPapelId: string; contaDiferencaId?: string | null;
}): PartidaInput[] {
  const valor = cents(p.valorTitulo), pago = cents(p.valorPago);
  if (!(pago > 0)) throw new Error("Valor pago deve ser maior que zero");
  const dif = pago - valor;
  const receber = p.tipo === "receber";
  const ps: PartidaInput[] = receber
    ? [{ contaId: p.contaBancoId, debito: fromCents(pago) }, { contaId: p.contaPapelId, credito: fromCents(valor) }]
    : [{ contaId: p.contaPapelId, debito: fromCents(valor) }, { contaId: p.contaBancoId, credito: fromCents(pago) }];
  if (dif !== 0) {
    if (!p.contaDiferencaId) throw new Error("Valor pago difere do título: informe a conta da diferença (juros/desconto)");
    const v = fromCents(Math.abs(dif));
    // receber: pago a menor → D diferença; pagar: pago a maior → D diferença
    const debita = receber ? dif < 0 : dif > 0;
    ps.push(debita ? { contaId: p.contaDiferencaId, debito: v } : { contaId: p.contaDiferencaId, credito: v });
  }
  return ps;
}

export type BaixaInput = {
  empresaId: string; tituloId: string; contaBancariaContabilId: string; valorPago: string;
  data: string; contaDiferencaId?: string | null; usuarioId?: string | null;
};

/** Gera o lançamento de baixa (origem conciliação), marca o título como baixado e devolve o lançamento. */
export async function baixarTitulo(tx: Tx, input: BaixaInput) {
  const [t] = await tx
    .select()
    .from(titulos)
    .where(and(eq(titulos.id, input.tituloId), eq(titulos.empresaId, input.empresaId)))
    .for("update");
  if (!t) throw new Error("Título não encontrado");
  if (t.status !== "aberto") throw new Error("Título não está em aberto");
  const papel = await contaPorPapel(tx, input.empresaId, papelDo(t.tipo));
  const l = await criarLancamento(tx, {
    empresaId: input.empresaId, data: input.data, dataPagamento: input.data,
    historico: `Baixa de título ${t.tipo === "receber" ? "a receber" : "a pagar"}: ${t.contraparte} - ${t.descricao}`,
    documento: t.documento, origem: "conciliacao", usuarioId: input.usuarioId,
    partidas: partidasBaixa({
      tipo: t.tipo, valorTitulo: t.valor, valorPago: input.valorPago,
      contaBancoId: input.contaBancariaContabilId, contaPapelId: papel.id, contaDiferencaId: input.contaDiferencaId,
    }),
  });
  await tx.update(titulos).set({ status: "baixado", baixaLancamentoId: l.id }).where(eq(titulos.id, t.id));
  return l;
}
