/**
 * Reclassificação em lote (fase 5), puro: filtro das conciliadas, situação de cada uma (reclassifica, pula ou bloqueia),
 * os lançamentos que serão gravados (estorno + novo, com as mesmas funções do painel) e o efeito agregado nos saldos, na
 * DRE e no Balanço. O servidor grava pelas funções da conciliação e confere tudo de novo dentro da transação.
 * Também a correção dos estornos fora do mês do original (Moodlr, item 10 do Bruno).
 */
import { CONTA_ADIANTAMENTO, partidasAdiantamento, tipoDaEntrada } from "./adiantamentos";
import { cents, fmtCompetencia, fromCents, primeiroDiaDoMes } from "./format";
import type { PartidaInput } from "./lancamentos";
import {
  contaServe, contraparteDoMemo, IDS_OPERACAO, lancamentosDireta, OPERACOES, operacaoDaConta, partidasClassificacao, permitida,
  type LancPrevia, type Operacao,
} from "./operacoes";
import { contaDeTitulo, type ContaComPapel } from "./sem-titulo";
import { acharConta } from "./tributos";

/** Baixas ficam fora: cada uma escolhe o título, no painel. */
export type OperacaoLote = Exclude<Operacao, "baixa_receber" | "baixa_pagar" | "baixa_imposto">;
export const OPERACOES_LOTE = IDS_OPERACAO.filter((op): op is OperacaoLote => !op.startsWith("baixa_"));

/** Prefixos do motivo gravado no log: identificam o lote de desfazer e o de correção (que não se desfazem pela tela). */
export const PREFIXO_DESFAZER = "Desfazer lote ";
export const PREFIXO_CORRECAO = "Estorno fora do mês do original: ";

export type Alvo = {
  /** null: só a conta (como a reclassificação do painel). */
  operacao: OperacaoLote | null;
  /** Ignorada no adiantamento: a conta sai do plano pelo nome, como no painel. */
  contaId: string | null;
  /** Receita/despesa direta: competência fixa "YYYY-MM-01"; null = mês do extrato de cada transação. */
  competencia: string | null;
  /** Destino Clientes sem título: decisão explícita do contador (decisão 5 do Bruno). */
  confirmarSemTitulo?: boolean;
};

export type Candidata = {
  transacaoId: string; contaBancariaId: string; contaBancariaNome: string; contaBanco: string;
  data: string; valor: string; memo: string; status: "classificada" | "transferencia";
  lancamentoId: string; numero: number; lancData: string; competencia: string; historico: string; documento: string | null;
  partidas: PartidaInput[];
  baixa: boolean; adiantamento: boolean;
  /** Lançamento de baixa de título: conta de resultado e competência do reconhecimento (receita/despesa direta em outro mês). */
  reconhecido: { contaId: string; competencia: string }[];
};

export type FiltroLote = {
  contaBancariaId?: string; contaId?: string; operacao?: Operacao; memo?: string; sinal?: "entrada" | "saida";
  /** Valor absoluto, "1234.56". */
  valorMin?: string; valorMax?: string;
  /** Data do extrato. */
  de?: string; ate?: string;
  /** Competência do lançamento atual, "YYYY-MM-01". */
  compDe?: string; compAte?: string;
};

type Conta = ContaComPapel & { id: string };
const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const entradaDe = (c: Pick<Candidata, "valor">) => cents(c.valor) > 0;
const inverter = (ps: PartidaInput[]) => ps.map((p) => ({ contaId: p.contaId, debito: p.credito, credito: p.debito }));

/** Contrapartidas do lançamento atual (tudo menos o banco), com o valor absoluto. */
export function contrapartidas(c: Pick<Candidata, "partidas" | "contaBanco">) {
  return c.partidas.filter((p) => p.contaId !== c.contaBanco)
    .map((p) => ({ contaId: p.contaId, valor: fromCents(Math.abs(cents(p.debito || 0) - cents(p.credito || 0))) }));
}

/** Operação do lançamento atual, derivada da contrapartida (transferência casada é transferência). */
export function operacaoAtual(c: Candidata, contas: ReadonlyMap<string, ContaComPapel>): Operacao | null {
  if (c.status === "transferencia") return "transferencia";
  return operacaoDaConta(contas.get(contrapartidas(c)[0]?.contaId ?? ""), entradaDe(c));
}

export function filtrarCandidatas(cs: Candidata[], f: FiltroLote, contas: ReadonlyMap<string, ContaComPapel>) {
  const q = f.memo ? norm(f.memo.trim()) : "";
  const min = f.valorMin ? cents(f.valorMin) : null, max = f.valorMax ? cents(f.valorMax) : null;
  return cs.filter((c) => {
    const v = Math.abs(cents(c.valor));
    return (!f.contaBancariaId || c.contaBancariaId === f.contaBancariaId)
      && (!f.contaId || contrapartidas(c).some((x) => x.contaId === f.contaId))
      && (!f.operacao || operacaoAtual(c, contas) === f.operacao)
      && (!q || norm(c.memo).includes(q))
      && (!f.sinal || entradaDe(c) === (f.sinal === "entrada"))
      && (min === null || v >= min) && (max === null || v <= max)
      && (!f.de || c.data >= f.de) && (!f.ate || c.data <= f.ate)
      && (!f.compDe || c.competencia >= f.compDe) && (!f.compAte || c.competencia <= f.compAte);
  });
}

export type ItemLote = {
  c: Candidata;
  tipo: "reclassificar" | "pulada" | "bloqueada";
  motivo?: string;
  /** Meses fechados que bloqueiam o item ("YYYY-MM-01"). */
  fechados?: string[];
  /** Estorno do atual + os novos, na ordem em que são gravados. */
  lancs: LancPrevia[];
};

export type ContextoLote = {
  /** Analíticas ativas (destino válido); a do adiantamento sai daqui pelo nome. */
  contas: Conta[];
  fechados: ReadonlySet<string>;
};

/** Estorno do lançamento atual: na data e competência dele (o mês precisa estar aberto; o lote não manda para hoje). */
export const estornoDe = (c: Candidata): LancPrevia => ({
  data: c.lancData, competencia: c.competencia, historico: `Estorno do lançamento ${c.numero}: ${c.historico}`, partidas: inverter(c.partidas),
});

/** Conta de destino efetiva: a escolhida ou, no adiantamento, a do plano pelo nome. */
export function contaDestino(alvo: Alvo, entrada: boolean, contas: Conta[]) {
  if (alvo.operacao === "adiantamento") return acharConta(contas, CONTA_ADIANTAMENTO[tipoDaEntrada(entrada)]);
  return contas.find((c) => c.id === alvo.contaId) ?? null;
}

/** Novos lançamentos do item (mesmas funções puras que o painel e o servidor usam). */
export function novosLancamentos(c: Candidata, alvo: Alvo, destino: Conta, contas: Conta[]): LancPrevia[] {
  const entrada = entradaDe(c);
  const total = fromCents(Math.abs(cents(c.valor)));
  const mes = primeiroDiaDoMes(c.data);
  if (alvo.operacao === "receita_direta" || alvo.operacao === "despesa_direta") {
    const papel = contas.find((x) => x.papel === (entrada ? "clientes" : "fornecedores"))?.id ?? null;
    return lancamentosDireta({
      valorTx: c.valor, dataBanco: c.data, contaBancoId: c.contaBanco, contaPapelId: papel, contras: [{ contaId: destino.id, valor: total }],
      competencia: alvo.competencia ?? mes, historico: c.historico, contraparte: contraparteDoMemo(c.memo),
    });
  }
  if (alvo.operacao === "adiantamento")
    return [{ data: c.data, competencia: mes, historico: c.historico, partidas: partidasAdiantamento(tipoDaEntrada(entrada), c.contaBanco, destino.id, total) }];
  return [{ data: c.data, competencia: mes, historico: c.historico, partidas: partidasClassificacao(c.valor, c.contaBanco, [{ contaId: destino.id, valor: total }]) }];
}

/** O lançamento atual já é o destino (idempotência: rodar o lote de novo não reclassifica duas vezes). */
export function jaNoDestino(c: Candidata, alvo: Alvo, destino: Conta) {
  const mes = primeiroDiaDoMes(c.data);
  const comp = (alvo.operacao === "receita_direta" || alvo.operacao === "despesa_direta") ? alvo.competencia ?? mes : mes;
  if (c.status !== "classificada") return false;
  if (c.baixa)
    return comp !== mes && c.reconhecido.length === 1 && c.reconhecido[0].contaId === destino.id && c.reconhecido[0].competencia === comp;
  const cs = contrapartidas(c);
  return comp === mes && c.competencia === mes && cs.length === 1 && cs[0].contaId === destino.id
    && c.adiantamento === (alvo.operacao === "adiantamento");
}

/** Reclassifica, pula (já está no destino) ou bloqueia (com o motivo), e os lançamentos da prévia. */
export function situacao(c: Candidata, alvo: Alvo, ctx: ContextoLote): ItemLote {
  const entrada = entradaDe(c);
  const op = alvo.operacao;
  const bloq = (motivo: string, fechados?: string[]): ItemLote => ({ c, tipo: "bloqueada", motivo, fechados, lancs: [] });
  const destino = contaDestino(alvo, entrada, ctx.contas);
  if (!destino)
    return bloq(op === "adiantamento"
      ? `Conta ${CONTA_ADIANTAMENTO[tipoDaEntrada(entrada)].criar!.nome} não existe: registre um adiantamento pelo painel (cria a conta) ou crie-a no plano`
      : "Escolha a conta de destino (analítica ativa)");
  if (jaNoDestino(c, alvo, destino)) return { c, tipo: "pulada", motivo: `Já está em ${destino.codigo} ${destino.nome}`, lancs: [] };
  if (c.status === "transferencia") return bloq("Transferência entre contas casada com o par: desfaça o par na Conciliação");
  if (c.baixa) return bloq("Baixou título: desfaça a conciliação e reclassifique pelo painel (o título volta a ficar em aberto)");
  if (c.adiantamento) return bloq("Adiantamento registrado (contraparte guardada para a compensação): desfaça a conciliação pelo painel");
  if (op && !permitida(op, entrada)) return bloq(`${OPERACOES[op].rotulo} não vale para ${entrada ? "entrada" : "saída"}`);
  if (op && !contaServe(op, destino, entrada)) return bloq(`A conta ${destino.codigo} ${destino.nome} não cabe na operação ${OPERACOES[op].rotulo}`);
  if (contaDeTitulo(destino) === "clientes" && !alvo.confirmarSemTitulo)
    return bloq("Destino Clientes sem título: marque a confirmação (recebimento só vai para Clientes por decisão explícita)");
  let lancs: LancPrevia[];
  try {
    lancs = [estornoDe(c), ...novosLancamentos(c, alvo, destino, ctx.contas)];
  } catch (e) {
    return bloq((e as Error).message);
  }
  // o trigger barra data ou competência em mês fechado; o lote não empurra para hoje: pede para reabrir
  const fechados = [...new Set(lancs.flatMap((l) => [primeiroDiaDoMes(l.data), primeiroDiaDoMes(l.competencia)]))]
    .filter((m) => ctx.fechados.has(m)).sort();
  if (fechados.length) return bloq(`Mês ${fechados.map(fmtCompetencia).join(", ")} fechado: reabra em Fechamento (em sequência) para reclassificar`, fechados);
  return { c, tipo: "reclassificar", lancs };
}

export function resumoLote(itens: ItemLote[], contas: ReadonlyMap<string, ContaComPapel>) {
  const n = (t: ItemLote["tipo"]) => itens.filter((i) => i.tipo === t).length;
  const papel = (id: string) => contas.get(id)?.papel;
  return {
    reclassificar: n("reclassificar"), puladas: n("pulada"), bloqueadas: n("bloqueada"),
    total: fromCents(itens.filter((i) => i.tipo === "reclassificar").reduce((s, i) => s + Math.abs(cents(i.c.valor)), 0)),
    mesesFechados: [...new Set(itens.flatMap((i) => i.fechados ?? []))].sort(),
    titulos: itens.filter((i) => i.c.baixa).length,
    adiantamentos: itens.filter((i) => i.c.adiantamento).length,
    transferencias: itens.filter((i) => i.c.status === "transferencia").length,
    /** Classificadas na conta de transferências (sem par): saem da transitória. */
    semPar: itens.filter((i) => i.tipo === "reclassificar" && contrapartidas(i.c).some((x) => papel(x.contaId) === "transferencias")).length,
  };
}

// ---------- efeito agregado ----------

/** Movimento (D − C) da conta no ano de competência; `semApuracao` sem a apuração e seu estorno (DRE). */
export type BaseSaldo = { contaId: string; ano: number; saldo: string; semApuracao: string };
export type ContaInfo = { id: string; codigo: string; nome: string; natureza: "D" | "C" };
type Antes = { antes: number; depois: number };
export type EfeitoConta = ContaInfo & Antes;

const classe = (codigo: string, c: string) => codigo === c || codigo.startsWith(`${c}.`);

/**
 * Efeito dos itens a reclassificar, em centavos D − C: saldo de cada conta (todo o período), e por ano afetado a DRE
 * (resultado de cada conta 3, C − D, e o líquido) e o Balanço em 31/12 (contas 1 e 2 e totais; o resultado não apurado
 * entra no Passivo + PL, como no relatório).
 */
export function efeitoLote(itens: ItemLote[], base: BaseSaldo[], contas: ReadonlyMap<string, ContaInfo>) {
  const delta = new Map<string, Map<number, number>>();
  for (const i of itens) {
    if (i.tipo !== "reclassificar") continue;
    for (const l of i.lancs) {
      const ano = Number(l.competencia.slice(0, 4));
      for (const p of l.partidas) {
        const m = delta.get(p.contaId) ?? new Map<number, number>();
        m.set(ano, (m.get(ano) ?? 0) + cents(p.debito || 0) - cents(p.credito || 0));
        delta.set(p.contaId, m);
      }
    }
  }
  const baseDe = new Map<string, BaseSaldo[]>();
  for (const b of base) baseDe.set(b.contaId, [...(baseDe.get(b.contaId) ?? []), b]);
  const info = (id: string): ContaInfo => contas.get(id) ?? { id, codigo: "?", nome: "Conta", natureza: "D" };
  const soma = (m: Map<number, number> | undefined, ate = Infinity, so?: number) =>
    [...(m ?? [])].reduce((s, [a, v]) => s + ((so === undefined ? a <= ate : a === so) ? v : 0), 0);
  const baseAte = (id: string, ate = Infinity) => (baseDe.get(id) ?? []).reduce((s, b) => s + (b.ano <= ate ? cents(b.saldo) : 0), 0);
  const porCodigo = (a: ContaInfo, b: ContaInfo) => a.codigo.localeCompare(b.codigo, "pt-BR", { numeric: true });

  const porConta: EfeitoConta[] = [...delta].filter(([, m]) => soma(m) !== 0)
    .map(([id, m]) => ({ ...info(id), antes: baseAte(id), depois: baseAte(id) + soma(m) })).sort(porCodigo);

  const anos = [...new Set([...delta.values()].flatMap((m) => [...m].filter(([, v]) => v !== 0).map(([a]) => a)))].sort();
  const todas = [...new Set([...baseDe.keys(), ...delta.keys()])];
  const porAno = anos.map((ano) => {
    const resultado = todas.filter((id) => classe(info(id).codigo, "3"));
    const mov = (id: string) => 0 - (baseDe.get(id) ?? []).reduce((s, b) => s + (b.ano === ano ? cents(b.semApuracao) : 0), 0);
    const dreContas = resultado.filter((id) => soma(delta.get(id), Infinity, ano) !== 0)
      .map((id) => ({ ...info(id), antes: mov(id), depois: mov(id) - soma(delta.get(id), Infinity, ano) })).sort(porCodigo);
    const liquido = {
      antes: resultado.reduce((s, id) => s + mov(id), 0),
      depois: resultado.reduce((s, id) => s + mov(id) - soma(delta.get(id), Infinity, ano), 0),
    };
    const cum = (id: string) => ({ antes: baseAte(id, ano), depois: baseAte(id, ano) + soma(delta.get(id), ano) });
    const total = (f: (codigo: string) => boolean) => todas.filter((id) => f(info(id).codigo))
      .reduce((s, id) => { const x = cum(id); return { antes: s.antes + x.antes, depois: s.depois + x.depois }; }, { antes: 0, depois: 0 });
    const balancoContas = todas.filter((id) => /^[12](\.|$)/.test(info(id).codigo) && soma(delta.get(id), ano) !== 0)
      .map((id) => ({ ...info(id), ...cum(id) })).sort(porCodigo);
    return {
      ano,
      dre: { contas: dreContas, liquido },
      balanco: {
        contas: balancoContas,
        ativo: total((c) => classe(c, "1")),
        passivoPl: total((c) => classe(c, "2") || classe(c, "3")),
      },
    };
  });
  return { contas: porConta, anos: porAno };
}
export type EfeitoLote = ReturnType<typeof efeitoLote>;

// ---------- estorno fora do mês do original ----------

export type LancamentoPar = {
  id: string; numero: number; data: string; competencia: string; historico: string; documento: string | null; partidas: PartidaInput[];
};
export type ParEstorno = { estorno: LancamentoPar & { status: "aprovado" | "estornado"; origem: string }; original: LancamentoPar };

/** Estorno aprovado em competência diferente do lançamento que ele estorna (o mês do original conta em dobro com o novo). */
export const estornoForaDoMes = (p: ParEstorno) =>
  p.estorno.origem === "estorno" && p.estorno.status === "aprovado" && p.estorno.competencia !== p.original.competencia;

/** Correção: estorna o estorno no mês dele e lança o estorno de novo na data e competência do original. */
export function lancamentosCorrecao(p: ParEstorno): LancPrevia[] {
  const e = p.estorno, o = p.original;
  return [
    { data: e.data, competencia: e.competencia, historico: `Estorno do lançamento ${e.numero}: ${e.historico}`, partidas: inverter(e.partidas) },
    { data: o.data, competencia: o.competencia, historico: `Estorno do lançamento ${o.numero}: ${o.historico}`, partidas: inverter(o.partidas) },
  ];
}

/** Os dois meses (das datas e das competências) precisam estar abertos. */
export function bloqueioCorrecao(p: ParEstorno, fechados: ReadonlySet<string>) {
  const ms = [...new Set([p.estorno.data, p.estorno.competencia, p.original.data, p.original.competencia].map(primeiroDiaDoMes))]
    .filter((m) => fechados.has(m)).sort();
  return ms.length ? `Reabra ${ms.map(fmtCompetencia).join(", ")} em Fechamento para corrigir` : null;
}
