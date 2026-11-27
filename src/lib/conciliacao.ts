import { and, eq, inArray, lte, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { baixas, contasBancarias, lancamentos, partidas, planoContas, regras, transacoesBancarias } from "@/db/schema";
import { cents, fmtCompetencia, fmtData, fmtValor, fromCents, hoje, primeiroDiaDoMes } from "./format";
import { criarLancamento, dataNoMesAberto, estornarLancamento, mesesFechados, type PartidaInput } from "./lancamentos";
import {
  competenciaSeparada, contaServe, dataReconhecimento, OPERACOES, partidasClassificacao, type Contrapartida, type ItemBaixa,
  type Operacao, type TipoTitulo,
} from "./operacoes";
import { contaDeTitulo, MSG_CONFIRMAR_CLIENTES } from "./sem-titulo";
import { baixarTitulos, contaPorPapel, criarTitulo, removerBaixas } from "./titulos";
import { registrarAdiantamento, soltarAdiantamento } from "./adiantamentos-registro";

export { dataNoMesAberto, mesesFechados, partidasClassificacao, type Contrapartida };
export type NovaRegra = {
  nome: string; tipoMatch: "memo_contem" | "documento" | "valor_exato"; padrao: string; sinal: "entrada" | "saida" | "qualquer";
};

/** Transação da empresa com a conta contábil do banco, travada para a transação do Postgres. */
async function travar(tx: Tx, empresaId: string, transacaoId: string) {
  const [t] = await tx
    .select({
      id: transacoesBancarias.id, contaBancariaId: transacoesBancarias.contaBancariaId, data: transacoesBancarias.data,
      valor: transacoesBancarias.valor, memo: transacoesBancarias.memo, status: transacoesBancarias.status,
      lancamentoId: transacoesBancarias.lancamentoId, contaBanco: contasBancarias.contaContabilId,
    })
    .from(transacoesBancarias)
    .innerJoin(contasBancarias, eq(contasBancarias.id, transacoesBancarias.contaBancariaId))
    .where(and(eq(transacoesBancarias.id, transacaoId), eq(contasBancarias.empresaId, empresaId)))
    .for("update", { of: transacoesBancarias });
  if (!t) throw new Error("Transação não encontrada");
  return t;
}

async function travarPendente(tx: Tx, empresaId: string, transacaoId: string) {
  const t = await travar(tx, empresaId, transacaoId);
  if (t.status !== "pendente") throw new Error("Transação não está pendente (já conciliada ou ignorada)");
  return t;
}

/** Contas analíticas ativas da empresa (com papel, para o guard rail de título). */
async function exigirContas(tx: Tx, empresaId: string, ids: string[]) {
  const unicos = [...new Set(ids)];
  const ok = await tx
    .select({ id: planoContas.id, codigo: planoContas.codigo, nome: planoContas.nome, papel: planoContas.papel })
    .from(planoContas)
    .where(and(inArray(planoContas.id, unicos), eq(planoContas.empresaId, empresaId), eq(planoContas.tipo, "analitica"), eq(planoContas.ativa, true)));
  if (ok.length !== unicos.length) throw new Error("Conta inválida: use contas analíticas ativas desta empresa");
  return ok;
}

const marcar = (tx: Tx, id: string, set: Partial<typeof transacoesBancarias.$inferInsert>) =>
  tx.update(transacoesBancarias).set(set).where(eq(transacoesBancarias.id, id));

export async function classificarTransacao(tx: Tx, input: {
  empresaId: string; transacaoId: string; partidas: Contrapartida[]; historico: string; documento?: string | null;
  competencia?: string; criarRegra?: NovaRegra; usuarioId?: string | null;
  /** Só a reclassificação: data do novo lançamento (hoje, se o mês do extrato fechou), competência do extrato. */
  data?: string;
  /** "Sei o que estou fazendo": direto em Clientes sem título (regra criada pelo contador também conta como decisão dele). */
  confirmarSemTitulo?: boolean;
  /** Operação escolhida no painel: as contrapartidas precisam ser do grupo dela. */
  operacao?: Operacao;
}) {
  const t = await travarPendente(tx, input.empresaId, input.transacaoId);
  const contas = await exigirContas(tx, input.empresaId, input.partidas.map((p) => p.contaId));
  if (!input.confirmarSemTitulo && contas.some((c) => contaDeTitulo(c) === "clientes")) throw new ErroSemTitulo();
  const op = input.operacao;
  if (op === "adiantamento") throw new Error("Adiantamento guarda a contraparte para a compensação: use Registrar adiantamento");
  if (op) {
    const entrada = cents(t.valor) > 0;
    const fora = contas.find((c) => !contaServe(op, c, entrada));
    if (fora) throw new Error(`A conta ${fora.codigo} ${fora.nome} não cabe na operação ${OPERACOES[op].rotulo}`);
  }
  const l = await criarLancamento(tx, {
    empresaId: input.empresaId, data: input.data ?? t.data, dataPagamento: t.data,
    competencia: input.competencia ?? primeiroDiaDoMes(t.data),
    historico: input.historico, documento: input.documento ?? null, origem: "conciliacao", usuarioId: input.usuarioId,
    partidas: partidasClassificacao(t.valor, t.contaBanco, input.partidas),
  });
  await marcar(tx, t.id, { status: "classificada", lancamentoId: l.id });
  if (input.criarRegra) await inserirRegra(tx, input.empresaId, input.criarRegra, input.partidas[0].contaId, input.historico);
  return l;
}

/**
 * Adiantamento pela transação: entrada D Banco / C Adiantamentos de Clientes, saída D Adiantamentos a Fornecedores /
 * C Banco, guardando a contraparte (nome e CPF/CNPJ) para compensar depois com o título dela.
 */
export async function adiantarTransacao(tx: Tx, input: {
  empresaId: string; transacaoId: string; contraparte: string; documento?: string | null; historico: string; usuarioId?: string | null;
}) {
  const t = await travarPendente(tx, input.empresaId, input.transacaoId);
  const l = await registrarAdiantamento(tx, {
    empresaId: input.empresaId, transacao: { id: t.id, data: t.data, valor: t.valor, contaBanco: t.contaBanco },
    contraparte: input.contraparte, documento: input.documento, historico: input.historico, usuarioId: input.usuarioId,
  });
  await marcar(tx, t.id, { status: "classificada", lancamentoId: l.id });
  return l;
}

/** Classificação direta em Clientes sem a confirmação explícita. */
export class ErroSemTitulo extends Error {
  constructor() {
    super(MSG_CONFIRMAR_CLIENTES);
  }
}

export async function inserirRegra(tx: Tx, empresaId: string, regra: NovaRegra, contaId: string, historicoTemplate: string) {
  await exigirContas(tx, empresaId, [contaId]);
  await tx.insert(regras).values({ empresaId, ...regra, contaId, historicoTemplate });
}

/** Baixa total/parcial de um ou mais títulos pela transação (tabela `baixas`). */
export async function baixarTitulosPorTransacao(tx: Tx, input: {
  empresaId: string; transacaoId: string; itens: (ItemBaixa & { tituloId: string })[];
  contaJurosId?: string | null; contaDescontoId?: string | null; usuarioId?: string | null;
}) {
  const t = await travarPendente(tx, input.empresaId, input.transacaoId);
  const extras = [input.contaJurosId, input.contaDescontoId].filter((x): x is string => !!x);
  if (extras.length) await exigirContas(tx, input.empresaId, extras);
  const l = await baixarTitulos(tx, {
    empresaId: input.empresaId, transacao: { id: t.id, contaBanco: t.contaBanco, data: t.data, valor: t.valor },
    itens: input.itens, contaJurosId: input.contaJurosId, contaDescontoId: input.contaDescontoId, usuarioId: input.usuarioId,
  });
  await marcar(tx, t.id, { status: "classificada", lancamentoId: l.id });
  return l;
}

const PREFIXO_RESULTADO: Record<TipoTitulo, string> = { receber: "3.1", pagar: "3.2" };

/**
 * "Reconhecer agora": cria um título por linha (D Clientes / C receita ou D despesa / C Fornecedores, no mês da
 * competência) e baixa todos pela transação, no mesmo lançamento de baixa. Os dois meses precisam estar abertos.
 */
export async function reconhecerEBaixar(tx: Tx, input: {
  empresaId: string; transacaoId: string; contraparte: string; descricao: string; documento?: string | null;
  competencia: string; vencimento?: string | null; linhas: Contrapartida[]; usuarioId?: string | null;
}) {
  const t = await travarPendente(tx, input.empresaId, input.transacaoId);
  const tipo: TipoTitulo = cents(t.valor) > 0 ? "receber" : "pagar";
  partidasClassificacao(t.valor, t.contaBanco, input.linhas); // soma = valor da transação, valores > 0
  const contas = await exigirContas(tx, input.empresaId, input.linhas.map((l) => l.contaId));
  const prefixo = PREFIXO_RESULTADO[tipo];
  const fora = contas.find((c) => !(c.codigo === prefixo || c.codigo.startsWith(`${prefixo}.`)));
  if (fora) throw new Error(`${fora.codigo} ${fora.nome}: o título ${tipo === "receber" ? "a receber reconhece receita (3.1)" : "a pagar reconhece custo ou despesa (3.2)"}`);
  const data = dataReconhecimento(input.competencia, t.data);
  const fechados = await mesesFechados(tx, input.empresaId);
  for (const d of [data, t.data])
    if (fechados.has(primeiroDiaDoMes(d))) throw new Error(`O mês ${fmtCompetencia(d)} está fechado: reabra-o em Fechamento para reconhecer e baixar`);
  const ts = [];
  for (const l of input.linhas)
    ts.push(await criarTitulo(tx, {
      empresaId: input.empresaId, tipo, contraparte: input.contraparte, descricao: input.descricao, documento: input.documento,
      valor: l.valor, competencia: data, vencimento: input.vencimento ?? null, contaResultadoId: l.contaId, usuarioId: input.usuarioId,
    }));
  return baixarTitulosPorTransacao(tx, {
    empresaId: input.empresaId, transacaoId: input.transacaoId, usuarioId: input.usuarioId,
    itens: ts.map((x) => ({ tituloId: x.id, valor: x.valor })),
  });
}

/**
 * Receita/despesa direta: competência no mês do extrato → um lançamento (D Banco / C Receita); em outro mês →
 * reconhecimento na competência + baixa na data do extrato (via título, para o desfazer reabrir o título).
 */
export async function lancarDireta(tx: Tx, input: {
  empresaId: string; transacaoId: string; partidas: Contrapartida[]; historico: string; documento?: string | null;
  competencia: string; contraparte: string; usuarioId?: string | null;
}) {
  const t = await travarPendente(tx, input.empresaId, input.transacaoId);
  const operacao: Operacao = cents(t.valor) > 0 ? "receita_direta" : "despesa_direta";
  const contas = await exigirContas(tx, input.empresaId, input.partidas.map((p) => p.contaId));
  const fora = contas.find((c) => !contaServe(operacao, c, cents(t.valor) > 0));
  if (fora) throw new Error(`A conta ${fora.codigo} ${fora.nome} não cabe na operação ${OPERACOES[operacao].rotulo}`);
  if (!competenciaSeparada(input.competencia, t.data))
    return { separada: false, l: await classificarTransacao(tx, { ...input, operacao, competencia: primeiroDiaDoMes(input.competencia) }) };
  return {
    separada: true,
    l: await reconhecerEBaixar(tx, {
      empresaId: input.empresaId, transacaoId: input.transacaoId, contraparte: input.contraparte, descricao: input.historico,
      documento: input.documento, competencia: input.competencia, linhas: input.partidas, usuarioId: input.usuarioId,
    }),
  };
}

/**
 * Analítica criada sob demanda (ex.: "Bancos – Outra Conta", "Pagamentos a identificar"): devolve a ativa com esse
 * nome ou cria no próximo código livre do grupo sintético `paiCodigo`.
 */
export async function contaSobDemanda(tx: Tx, empresaId: string, p: { paiCodigo: string; nome: string; natureza: "D" | "C" }) {
  const sel = { id: planoContas.id, codigo: planoContas.codigo, nome: planoContas.nome, papel: planoContas.papel };
  const [ja] = await tx.select(sel).from(planoContas)
    .where(and(eq(planoContas.empresaId, empresaId), eq(planoContas.nome, p.nome), eq(planoContas.tipo, "analitica"), eq(planoContas.ativa, true)));
  if (ja) return ja;
  const [pai] = await tx.select(sel).from(planoContas)
    .where(and(eq(planoContas.empresaId, empresaId), eq(planoContas.codigo, p.paiCodigo), eq(planoContas.tipo, "sintetica")))
    .for("update");
  if (!pai) throw new Error(`Grupo ${p.paiCodigo} não encontrado: crie a conta no plano de contas`);
  const filhos = await tx.select({ codigo: planoContas.codigo }).from(planoContas).where(eq(planoContas.parentId, pai.id));
  const n = Math.max(0, ...filhos.map((f) => Number(f.codigo.split(".").at(-1)) || 0)) + 1;
  const [c] = await tx.insert(planoContas).values({
    empresaId, parentId: pai.id, codigo: `${p.paiCodigo}.${String(n).padStart(2, "0")}`, nome: p.nome, natureza: p.natureza, tipo: "analitica",
  }).returning(sel);
  return c;
}

/** Um lançamento D banco destino / C banco origem, ligado às duas transações. */
export async function transferirEntreContas(tx: Tx, input: {
  empresaId: string; transacaoId: string; parId: string; usuarioId?: string | null;
}) {
  if (input.transacaoId === input.parId) throw new Error("Escolha outra transação como par");
  // trava em ordem de id para não dar deadlock com a aprovação simultânea do par
  const [x, y] = [input.transacaoId, input.parId].sort();
  const a = await travarPendente(tx, input.empresaId, x);
  const b = await travarPendente(tx, input.empresaId, y);
  if (a.contaBancariaId === b.contaBancariaId) throw new Error("As transações precisam ser de contas bancárias diferentes");
  const va = cents(a.valor);
  if (va === 0 || va + cents(b.valor) !== 0) throw new Error("As transações precisam ter valores opostos");
  const [origem, destino] = va < 0 ? [a, b] : [b, a];
  const v = fromCents(Math.abs(va));
  // ponytail: data da saída; se o crédito cair em outro dia, a conferência do destino fica 1 dia defasada
  const l = await criarLancamento(tx, {
    empresaId: input.empresaId, data: origem.data, dataPagamento: origem.data, historico: "Transferência entre contas",
    origem: "conciliacao", usuarioId: input.usuarioId,
    partidas: [{ contaId: destino.contaBanco, debito: v }, { contaId: origem.contaBanco, credito: v }],
  });
  await marcar(tx, a.id, { status: "transferencia", lancamentoId: l.id, transferenciaParId: b.id });
  await marcar(tx, b.id, { status: "transferencia", lancamentoId: l.id, transferenciaParId: a.id });
  return l;
}

/**
 * Estorna o lançamento no dia dele (hoje, se o mês fechou), devolve a(s) transação(ões) a pendente e apaga as baixas
 * dele (os títulos voltam a aberto/parcial; o reconhecimento continua). Retorna a data do estorno e quantos títulos reabriu.
 */
export async function desfazerConciliacao(
  tx: Tx, empresaId: string, transacaoId: string, usuarioId?: string | null, acao = "desfazer",
) {
  const t = await travar(tx, empresaId, transacaoId);
  if (!t.lancamentoId || (t.status !== "classificada" && t.status !== "transferencia"))
    throw new Error("Transação não está conciliada");
  const lancId = t.lancamentoId;
  const [orig] = await tx.select({ data: lancamentos.data }).from(lancamentos).where(eq(lancamentos.id, lancId));
  const data = dataNoMesAberto(orig.data, hoje(), await mesesFechados(tx, empresaId), acao);
  await tx.select({ id: transacoesBancarias.id }).from(transacoesBancarias)
    .where(eq(transacoesBancarias.lancamentoId, lancId)).for("update");
  await soltarAdiantamento(tx, lancId);
  await estornarLancamento(tx, lancId, data, usuarioId);
  await tx.update(transacoesBancarias).set({
    status: "pendente", lancamentoId: null, transferenciaParId: null, sugestaoContaId: null, sugestaoConfianca: null,
    sugestaoOrigem: null, sugestaoRegraId: null, sugestaoHistorico: null, sugestaoJustificativa: null, sugestaoOperacao: null,
  }).where(eq(transacoesBancarias.lancamentoId, lancId));
  const titulosReabertos = await removerBaixas(tx, lancId);
  return { data, titulosReabertos };
}

/** pendente ↔ ignorada. */
export async function alterarIgnorada(tx: Tx, empresaId: string, transacaoId: string, ignorar: boolean, motivo?: string | null) {
  const t = await travar(tx, empresaId, transacaoId);
  if (t.status !== (ignorar ? "pendente" : "ignorada"))
    throw new Error(ignorar ? "Só transações pendentes podem ser ignoradas" : "Transação não está ignorada");
  await marcar(tx, t.id, { status: ignorar ? "ignorada" : "pendente", sugestaoJustificativa: ignorar ? motivo || null : null });
}

/**
 * Estorna e classifica de novo, na mesma transação do Postgres: estorno na data do original e novo lançamento na
 * do extrato; mês fechado vai para hoje, com a competência do extrato. Retorna as datas se alguma saiu do lugar.
 */
export async function reclassificarTransacao(tx: Tx, input: {
  empresaId: string; transacaoId: string; partidas: Contrapartida[]; historico: string; documento?: string | null;
  competencia?: string; usuarioId?: string | null; confirmarSemTitulo?: boolean;
}) {
  const t = await travar(tx, input.empresaId, input.transacaoId);
  if (t.status !== "classificada" || !t.lancamentoId) throw new Error("Só transações classificadas podem ser reclassificadas");
  const [baixa] = await tx.select({ id: baixas.id }).from(baixas).where(eq(baixas.lancamentoId, t.lancamentoId)).limit(1);
  if (baixa) throw new Error("Transação baixou um título: desfaça a conciliação em vez de reclassificar");
  const data = dataNoMesAberto(t.data, hoje(), await mesesFechados(tx, input.empresaId), "reclassificar");
  const { data: estorno } = await desfazerConciliacao(tx, input.empresaId, input.transacaoId, input.usuarioId, "reclassificar");
  await classificarTransacao(tx, { ...input, data });
  return data === t.data ? null : { extrato: t.data, novo: data, estorno };
}

type PartidaConciliada = { transacaoId: string; contaId: string | null; codigo: string | null; nome: string | null; debito: string | null; credito: string | null };
export type ContraConciliada = { contaId: string; codigo: string; nome: string; valor: string };

/** Linhas (uma por contrapartida, na ordem da consulta) → uma por transação, com o valor de cada contrapartida. */
export function agruparContrapartidas<T extends PartidaConciliada>(linhas: T[]) {
  const porTx = new Map<string, Omit<T, "contaId" | "codigo" | "nome" | "debito" | "credito"> & { contras: ContraConciliada[] }>();
  for (const { contaId, codigo, nome, debito, credito, ...resto } of linhas) {
    let item = porTx.get(resto.transacaoId);
    if (!item) porTx.set(resto.transacaoId, (item = { ...resto, contras: [] }));
    if (contaId) item.contras.push({ contaId, codigo: codigo ?? "", nome: nome ?? "", valor: fromCents(Math.abs(cents(debito ?? 0) - cents(credito ?? 0))) });
  }
  return [...porTx.values()];
}

/** Saldo (D − C, centavos) da conta até a data, inclusive. */
async function saldoContaAte(tx: Tx, contaId: string, data: string) {
  const [r] = await tx
    .select({ s: sql<string>`coalesce(sum(${partidas.debito} - ${partidas.credito}), 0)::text` })
    .from(partidas)
    .innerJoin(lancamentos, eq(lancamentos.id, partidas.lancamentoId))
    .where(and(eq(partidas.contaId, contaId), lte(lancamentos.data, data)));
  return cents(r.s);
}

/** Zera a transitória: saldo credor → D transitória / C contrapartida; devedor → D contrapartida / C transitória. */
export function partidasZerarTransitoria(saldo: number, transitoriaId: string, contraId: string): PartidaInput[] {
  if (saldo === 0) throw new Error("A conta de transferências já está zerada nessa data");
  if (transitoriaId === contraId) throw new Error("Escolha uma contrapartida diferente da conta de transferências");
  const v = fromCents(Math.abs(saldo));
  return saldo < 0
    ? [{ contaId: transitoriaId, debito: v }, { contaId: contraId, credito: v }]
    : [{ contaId: contraId, debito: v }, { contaId: transitoriaId, credito: v }];
}

/** Conta de papel transferências e o saldo dela (centavos) na data. */
export async function previaZerarTransitoria(tx: Tx, empresaId: string, data: string) {
  const t = await contaPorPapel(tx, empresaId, "transferencias");
  return { ...t, saldo: await saldoContaAte(tx, t.id, data) };
}

/**
 * "Zerar manualmente" enquanto a outra conta bancária não é cadastrada: um lançamento manual (estornável depois) que
 * leva o saldo da transitória na data para `contaId`. `saldoEsperado` é o da prévia confirmada; se mudou, recusa.
 */
export async function zerarTransitoria(tx: Tx, input: {
  empresaId: string; contaId: string; data: string; historico: string; saldoEsperado: number; usuarioId?: string | null;
}) {
  if ((await mesesFechados(tx, input.empresaId)).has(primeiroDiaDoMes(input.data)))
    throw new Error(`O mês ${fmtCompetencia(input.data)} está fechado: escolha uma data em mês aberto ou reabra o mês em Fechamento`);
  // trava a transitória: duas confirmações simultâneas não lançam o ajuste duas vezes
  const tr = await contaPorPapel(tx, input.empresaId, "transferencias");
  await tx.select({ id: planoContas.id }).from(planoContas).where(eq(planoContas.id, tr.id)).for("update");
  const t = await previaZerarTransitoria(tx, input.empresaId, input.data);
  await exigirContas(tx, input.empresaId, [input.contaId]);
  if (t.saldo !== input.saldoEsperado)
    throw new Error(`O saldo da conta de transferências em ${fmtData(input.data)} mudou para R$ ${fmtValor(fromCents(t.saldo))}: revise a prévia`);
  return criarLancamento(tx, {
    empresaId: input.empresaId, data: input.data, historico: input.historico, origem: "manual", usuarioId: input.usuarioId,
    partidas: partidasZerarTransitoria(t.saldo, t.id, input.contaId),
  });
}

/**
 * Casa uma transação classificada na transitória (sem par) com o par que apareceu: desfaz a(s) classificada(s) na
 * transitória (estorno no mês aberto, regra de desfazerConciliacao) e registra a transferência entre os dois bancos.
 */
export async function parearTransferenciaSemPar(tx: Tx, input: { empresaId: string; transacaoId: string; parId: string; usuarioId?: string | null }) {
  const t = await contaPorPapel(tx, input.empresaId, "transferencias");
  const fechados = await mesesFechados(tx, input.empresaId);
  for (const id of [input.transacaoId, input.parId].sort()) {
    const x = await travar(tx, input.empresaId, id);
    // a transferência é lançada na data da saída
    if (cents(x.valor) < 0 && fechados.has(primeiroDiaDoMes(x.data)))
      throw new Error(`Reabra o mês ${fmtCompetencia(x.data)} em Fechamento para parear a transferência`);
    if (x.status === "pendente") continue;
    if (x.status !== "classificada" || !x.lancamentoId) throw new Error("Uma das transações já está conciliada de outro jeito: desfaça antes");
    const [p] = await tx.select({ id: partidas.id }).from(partidas)
      .where(and(eq(partidas.lancamentoId, x.lancamentoId), eq(partidas.contaId, t.id))).limit(1);
    if (!p) throw new Error("Só dá para parear transação pendente ou classificada na conta de transferências");
    await desfazerConciliacao(tx, input.empresaId, id, input.usuarioId, "parear a transferência");
  }
  return transferirEntreContas(tx, input);
}
