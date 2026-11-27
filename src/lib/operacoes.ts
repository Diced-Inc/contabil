/**
 * Operações da conciliação (fase 2): o que a transação do extrato representa, que contas cabem em cada uma e as partidas
 * que ela gera. Puro (sem banco): o painel monta a prévia com as mesmas funções que o servidor usa para lançar.
 */
import { cents, fromCents, primeiroDiaDoMes } from "./format";
import type { PartidaInput } from "./lancamentos";
import { contaDeTitulo, type ContaComPapel } from "./sem-titulo";

export type TipoTitulo = "receber" | "pagar";
type Sinal = "entrada" | "saida" | "ambos";
type Explica = string | { entrada: string; saida: string };

export const OPERACOES = {
  receita_direta: {
    rotulo: "Receita direta", sinal: "entrada", grupo: "Resultado",
    explica: "D Banco / C Receita. Competência em outro mês: D Clientes / C Receita na competência e D Banco / C Clientes na data do extrato.",
  },
  despesa_direta: {
    rotulo: "Despesa direta", sinal: "saida", grupo: "Resultado",
    explica: "D Despesa / C Banco. Competência em outro mês: D Despesa / C Fornecedores na competência e D Fornecedores / C Banco na data do extrato.",
  },
  baixa_receber: {
    rotulo: "Baixa de contas a receber", sinal: "entrada", grupo: "Títulos",
    explica: "D Banco / C Clientes pelo título; juros a crédito em receita financeira, desconto a débito em despesa.",
  },
  baixa_pagar: {
    rotulo: "Baixa de contas a pagar", sinal: "saida", grupo: "Títulos",
    explica: "D Fornecedores / C Banco pelo título; juros a débito em despesa financeira, desconto a crédito em receita.",
  },
  baixa_imposto: {
    rotulo: "Baixa de imposto", sinal: "saida", grupo: "Títulos",
    explica: "D Imposto a recolher / C Banco: quita a obrigação já registrada na competência.",
  },
  adiantamento: {
    rotulo: "Adiantamento (receita/despesa ainda não reconhecida)", sinal: "ambos", grupo: "Títulos",
    explica: {
      entrada: "D Banco / C Adiantamentos de Clientes: recebido antes da receita; compense depois com o título do cliente.",
      saida: "D Adiantamentos a Fornecedores / C Banco: pago antes da despesa; compense depois com o título do fornecedor.",
    },
  },
  transferencia: {
    rotulo: "Transferência entre contas próprias", sinal: "ambos", grupo: "Movimentos",
    explica: "D Banco de destino / C Banco de origem. Sem o par no extrato, a outra ponta fica na conta de transferências.",
  },
  adiantamento_socio: {
    rotulo: "Adiantamento a sócio", sinal: "ambos", grupo: "Movimentos",
    explica: {
      saida: "D Adiantamentos a sócios / C Banco: crédito contra o sócio até a compensação.",
      entrada: "D Banco / C Adiantamentos a sócios: devolução do sócio.",
    },
  },
  distribuicao_lucros: {
    rotulo: "Distribuição de lucros", sinal: "saida", grupo: "Movimentos",
    explica: "D Lucros distribuídos (PL) / C Banco.",
  },
  emprestimo: {
    rotulo: "Empréstimo", sinal: "ambos", grupo: "Movimentos",
    explica: {
      entrada: "D Banco / C Empréstimos (passivo): empréstimo tomado.",
      saida: "D Empréstimos (principal) + D Juros passivos / C Banco: use Dividir para separar os juros da parcela.",
    },
  },
  estorno: {
    rotulo: "Estorno/devolução", sinal: "ambos", grupo: "Outros",
    explica: {
      entrada: "D Banco / C na despesa estornada: reduz a despesa (ex.: tarifa devolvida, compra cancelada).",
      saida: "D Deduções/devoluções de venda / C Banco: devolução ao cliente.",
    },
  },
  a_identificar: {
    rotulo: "A identificar", sinal: "ambos", grupo: "Outros",
    explica: {
      entrada: "D Banco / C Recebimentos a identificar (passivo circulante) até descobrir a origem; depois reclassifique.",
      saida: "D Pagamentos a identificar (ativo circulante) / C Banco até descobrir o destino; depois reclassifique.",
    },
  },
  outra: {
    rotulo: "Outra classificação", sinal: "ambos", grupo: "Outros",
    explica: "Qualquer conta analítica (ex.: aplicação financeira, imobilizado). Entrada: D Banco / C conta; saída: D conta / C Banco.",
  },
} as const satisfies Record<string, { rotulo: string; sinal: Sinal; grupo: string; explica: Explica }>;

export type Operacao = keyof typeof OPERACOES;
export const IDS_OPERACAO = Object.keys(OPERACOES) as Operacao[];
export const ehOperacao = (s: unknown): s is Operacao => typeof s === "string" && s in OPERACOES;

export const permitida = (op: Operacao, entrada: boolean) => {
  const s: Sinal = OPERACOES[op].sinal;
  return s === "ambos" || (s === "entrada") === entrada;
};
export const operacoesPara = (entrada: boolean) => IDS_OPERACAO.filter((op) => permitida(op, entrada));
export function explicacao(op: Operacao, entrada: boolean) {
  const e: Explica = OPERACOES[op].explica;
  return typeof e === "string" ? e : e[entrada ? "entrada" : "saida"];
}

const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const em = (c: ContaComPapel, prefixo: string) => c.codigo === prefixo || c.codigo.startsWith(`${prefixo}.`);
export const NOMES_A_IDENTIFICAR = { entrada: "Recebimentos a identificar", saida: "Pagamentos a identificar" } as const;
/** Onde a conta "a identificar" é criada sob demanda: passivo circulante (entrada) ou ativo circulante (saída). */
export const PAI_A_IDENTIFICAR = { entrada: { codigo: "2.1.5", natureza: "C" }, saida: { codigo: "1.1.4", natureza: "D" } } as const;

/** Conta serve à operação (restringe o seletor; o servidor confere de novo). Baixas de título não escolhem conta. */
export function contaServe(op: Operacao, c: ContaComPapel, entrada: boolean): boolean {
  const n = norm(c.nome);
  switch (op) {
    case "receita_direta": return em(c, "3.1");
    case "despesa_direta": return em(c, "3.2");
    case "baixa_receber": return c.papel === "clientes";
    case "baixa_pagar": return c.papel === "fornecedores";
    case "baixa_imposto": return contaDeTitulo(c) === "impostos";
    case "adiantamento": return !c.papel && (entrada ? em(c, "2") && /^adiantamentos? de clientes?$/.test(n) : em(c, "1") && /^adiantamentos? a fornecedor(es)?$/.test(n));
    case "transferencia": return c.papel === "transferencias";
    case "adiantamento_socio": return em(c, "1") && /socio/.test(n);
    case "distribuicao_lucros": return em(c, "2") && /lucro/.test(n) && !/prejuizo/.test(n);
    case "emprestimo":
      return (em(c, "2") && /emprestimo|financiamento|cheque especial/.test(n)) || (!entrada && /juros passivos|despesas? financeira/.test(n) && em(c, "3.2"));
    case "estorno": return em(c, "3");
    case "a_identificar":
      return /a identificar/.test(n) && em(c, entrada ? "2" : "1");
    case "outra": return true;
  }
}

export function contasDaOperacao<T extends ContaComPapel>(op: Operacao, contas: T[], entrada: boolean) {
  return contas.filter((c) => contaServe(op, c, entrada));
}

/** Conta pré-escolhida ao abrir a operação: a sugerida, se servir; senão a mais típica do grupo. */
export function contaPadrao<T extends ContaComPapel & { id: string }>(op: Operacao, contas: T[], entrada: boolean, sugerida?: string | null) {
  const ok = contasDaOperacao(op, contas, entrada);
  const s = ok.find((c) => c.id === sugerida);
  if (s) return s.id;
  const tipica: Partial<Record<Operacao, RegExp>> = {
    adiantamento_socio: /adiantamento/, distribuicao_lucros: /lucros distribuidos/, emprestimo: /emprestimo/,
    estorno: entrada ? /^$/ : /dedu|devolu/, transferencia: /./, a_identificar: /./,
  };
  const re = tipica[op];
  return (re && ok.find((c) => re.test(norm(c.nome)))?.id) || (ok.length === 1 && op !== "outra" ? ok[0].id : null);
}

/** Operação mais provável para a conta sugerida (regra, IA sem operação válida, reclassificação). */
export function operacaoDaConta(c: ContaComPapel | null | undefined, entrada: boolean): Operacao | null {
  if (!c) return null;
  const ordem: Operacao[] = [
    "transferencia", "baixa_receber", "baixa_pagar", "baixa_imposto", "a_identificar", "adiantamento_socio",
    "distribuicao_lucros", "emprestimo", "adiantamento", "receita_direta", "despesa_direta", "estorno",
  ];
  return ordem.find((op) => permitida(op, entrada) && contaServe(op, c, entrada)) ?? "outra";
}

/**
 * Operação que a IA sugeriu, se fizer sentido para o sinal e a conta; senão a derivada da conta.
 * A IA nunca sugere baixa a receber (não sabe se há título; Clientes nem está na lista dela) nem adiantamento (precisa da
 * contraparte, que o contador confirma).
 */
export function operacaoSugerida(op: unknown, c: ContaComPapel | null | undefined, entrada: boolean): Operacao | null {
  if (ehOperacao(op) && op !== "baixa_receber" && op !== "adiantamento" && permitida(op, entrada) && c && contaServe(op, c, entrada)) return op;
  return operacaoDaConta(c, entrada);
}

// ---------- partidas ----------

export type Contrapartida = { contaId: string; valor: string };
export type LancPrevia = { data: string; competencia: string; historico: string; partidas: PartidaInput[] };

/**
 * Partidas da conciliação: entrada → D banco |valor| / C contrapartidas;
 * saída → D contrapartidas / C banco. Σ contrapartidas precisa ser |valor| (centavos).
 */
export function partidasClassificacao(valorTx: string, contaBancoId: string, contras: Contrapartida[]): PartidaInput[] {
  if (!contras.length) throw new Error("Informe ao menos uma contrapartida");
  const total = Math.abs(cents(valorTx));
  let soma = 0;
  for (const c of contras) {
    const v = cents(c.valor);
    if (!(v > 0)) throw new Error("Cada contrapartida precisa de valor maior que zero");
    if (c.contaId === contaBancoId) throw new Error("A contrapartida não pode ser a própria conta do banco");
    soma += v;
  }
  if (soma !== total) throw new Error(`Soma das contrapartidas (${fromCents(soma)}) difere do valor da transação (${fromCents(total)})`);
  const banco = fromCents(total);
  const entrada = cents(valorTx) > 0;
  const lados = contras.map((c) => (entrada ? { contaId: c.contaId, credito: fromCents(cents(c.valor)) } : { contaId: c.contaId, debito: fromCents(cents(c.valor)) }));
  return entrada ? [{ contaId: contaBancoId, debito: banco }, ...lados] : [...lados, { contaId: contaBancoId, credito: banco }];
}

export type Retencao = { contaId: string; valor: string };

/**
 * Reconhecimento do título: receber D Clientes (líquido) + D retenções a compensar / C resultado (bruto); pagar
 * D resultado (bruto) / C retenções a recolher + C Fornecedores (líquido). Sem retenção, bruto = líquido = `valor`.
 */
export function partidasTitulo(
  tipo: TipoTitulo, contaPapelId: string, contaResultadoId: string, valor: string, retencoes: Retencao[] = [],
): PartidaInput[] {
  const liquido = cents(valor);
  if (!(liquido > 0)) throw new Error("Valor do título deve ser maior que zero");
  if (retencoes.some((r) => cents(r.valor) < 0 || Number.isNaN(cents(r.valor)))) throw new Error("Retenção precisa ser maior que zero");
  // uma partida por conta (PIS, COFINS e CSLL retidos caem na mesma)
  const porConta = new Map<string, number>();
  for (const r of retencoes) if (cents(r.valor) > 0) porConta.set(r.contaId, (porConta.get(r.contaId) ?? 0) + cents(r.valor));
  const rs = [...porConta];
  const bruto = liquido + rs.reduce((x, [, v]) => x + v, 0);
  const f = fromCents;
  return tipo === "receber"
    ? [{ contaId: contaPapelId, debito: f(liquido) }, ...rs.map(([contaId, v]) => ({ contaId, debito: f(v) })), { contaId: contaResultadoId, credito: f(bruto) }]
    : [{ contaId: contaResultadoId, debito: f(bruto) }, ...rs.map(([contaId, v]) => ({ contaId, credito: f(v) })), { contaId: contaPapelId, credito: f(liquido) }];
}

export const historicoTitulo = (tipo: TipoTitulo, contraparte: string, descricao: string) =>
  `${tipo === "receber" ? "Título a receber" : "Título a pagar"}: ${contraparte} - ${descricao}`;

export function historicoBaixa(tipo: TipoTitulo, ts: { contraparte: string; descricao: string }[]) {
  const lado = tipo === "receber" ? "a receber" : "a pagar";
  if (ts.length === 1) return `Baixa de título ${lado}: ${ts[0].contraparte} - ${ts[0].descricao}`;
  return `Baixa de ${ts.length} títulos ${lado}: ${[...new Set(ts.map((t) => t.contraparte))].join(", ")}`;
}

/**
 * Quanto abater de cada título: `valor` sai do título; o banco movimenta valor + juros − desconto. `contaId`: conta
 * patrimonial do título (imposto a recolher, parcelamento); sem ela, a conta de papel do tipo.
 */
export type ItemBaixa = { valor: string; juros?: string; desconto?: string; contaId?: string | null };
const c0 = (s?: string) => cents(s || 0);
export const bancoDoItem = (i: ItemBaixa) => c0(i.valor) + c0(i.juros) - c0(i.desconto);
export const totalBaixa = (itens: ItemBaixa[]) => itens.reduce((s, i) => s + bancoDoItem(i), 0);

/**
 * Um lançamento para a baixa de um ou mais títulos pela mesma transação, uma partida por conta de título.
 * receber: D Banco total + D Desconto / C Clientes Σvalor + C Juros; pagar: D Fornecedores Σvalor + D Juros / C Desconto + C Banco total.
 */
export function partidasBaixas(p: {
  tipo: TipoTitulo; contaBancoId: string; contaPapelId: string | null; itens: ItemBaixa[];
  contaJurosId?: string | null; contaDescontoId?: string | null;
}): PartidaInput[] {
  if (!p.itens.length) throw new Error("Escolha ao menos um título");
  let valor = 0, juros = 0, desconto = 0;
  const porConta = new Map<string, number>();
  for (const i of p.itens) {
    const v = c0(i.valor), j = c0(i.juros), d = c0(i.desconto);
    if (!(v > 0) || j < 0 || d < 0 || Number.isNaN(v + j + d)) throw new Error("Valor a abater precisa ser maior que zero; juros e desconto, zero ou mais");
    if (d >= v + j) throw new Error("Desconto não pode ser maior que o valor baixado");
    const conta = i.contaId || p.contaPapelId;
    if (!conta) throw new Error(`Marque a conta de papel ${p.tipo === "receber" ? "Clientes" : "Fornecedores"} no plano de contas`);
    porConta.set(conta, (porConta.get(conta) ?? 0) + v);
    valor += v; juros += j; desconto += d;
  }
  const titulosD = [...porConta].map(([contaId, v]) => ({ contaId, debito: fromCents(v) }));
  const titulosC = [...porConta].map(([contaId, v]) => ({ contaId, credito: fromCents(v) }));
  if (juros && !p.contaJurosId) throw new Error("Informe a conta dos juros/multa");
  if (desconto && !p.contaDescontoId) throw new Error("Informe a conta do desconto");
  const banco = valor + juros - desconto;
  const f = fromCents;
  if (p.tipo === "receber") {
    return [
      { contaId: p.contaBancoId, debito: f(banco) },
      ...(desconto ? [{ contaId: p.contaDescontoId!, debito: f(desconto) }] : []),
      ...titulosC,
      ...(juros ? [{ contaId: p.contaJurosId!, credito: f(juros) }] : []),
    ];
  }
  return [
    ...titulosD,
    ...(juros ? [{ contaId: p.contaJurosId!, debito: f(juros) }] : []),
    ...(desconto ? [{ contaId: p.contaDescontoId!, credito: f(desconto) }] : []),
    { contaId: p.contaBancoId, credito: f(banco) },
  ];
}

/** Conta padrão de juros/desconto da baixa, pelo nome no plano (ITG 1000 do seed). */
export function contasDiferencaPadrao<T extends ContaComPapel & { id: string }>(contas: T[], tipo: TipoTitulo) {
  const achar = (re: RegExp, prefixo: string) => contas.find((c) => em(c, prefixo) && re.test(norm(c.nome)))?.id ?? null;
  return tipo === "receber"
    ? { juros: achar(/juros ativos/, "3.1"), desconto: achar(/descontos? concedidos?/, "3.2") ?? achar(/outras despesas financeiras/, "3.2") }
    : { juros: achar(/juros passivos/, "3.2"), desconto: achar(/descontos? obtidos?/, "3.1") };
}

/** Status do título pela soma do que já foi abatido (centavos). */
export function statusPorBaixas(valorTitulo: string | number, somaBaixas: number): "aberto" | "parcial" | "quitado" {
  if (somaBaixas <= 0) return "aberto";
  return somaBaixas >= cents(valorTitulo) ? "quitado" : "parcial";
}

/**
 * Data do reconhecimento: a do extrato se a competência é o mesmo mês; senão o 1º dia do mês de competência.
 * Competência depois do extrato é adiantamento (Clientes credor/Fornecedores devedor até lá): recusa.
 */
export function dataReconhecimento(competencia: string, dataBanco: string) {
  const c = primeiroDiaDoMes(competencia), b = primeiroDiaDoMes(dataBanco);
  if (c > b)
    throw new Error("Competência depois do mês do extrato: a receita/despesa ainda não aconteceu. Registre como adiantamento (de cliente ou a fornecedor) e compense quando o título for reconhecido");
  return b === c ? dataBanco : c;
}

/** Receita/despesa direta com competência em outro mês: reconhece (um título por contrapartida) e baixa na data do extrato. */
export const competenciaSeparada = (competencia: string, dataBanco: string) => primeiroDiaDoMes(competencia) !== primeiroDiaDoMes(dataBanco);

/**
 * Lançamentos da receita/despesa direta. Mesmo mês: um só (D Banco / C Receita, D Despesa / C Banco).
 * Outro mês: reconhecimento por contrapartida no mês da competência + uma baixa na data do extrato.
 */
export function lancamentosDireta(p: {
  valorTx: string; dataBanco: string; contaBancoId: string; contaPapelId: string | null; contras: Contrapartida[];
  competencia: string; historico: string; contraparte: string;
}): LancPrevia[] {
  const competencia = primeiroDiaDoMes(p.competencia);
  if (!competenciaSeparada(competencia, p.dataBanco))
    return [{ data: p.dataBanco, competencia, historico: p.historico, partidas: partidasClassificacao(p.valorTx, p.contaBancoId, p.contras) }];
  if (!p.contaPapelId) throw new Error("Marque as contas de papel Clientes e Fornecedores no plano de contas");
  const tipo: TipoTitulo = cents(p.valorTx) > 0 ? "receber" : "pagar";
  partidasClassificacao(p.valorTx, p.contaBancoId, p.contras); // mesma validação de soma/valores
  const data = dataReconhecimento(competencia, p.dataBanco);
  return [
    ...p.contras.map((c) => ({
      data, competencia, historico: historicoTitulo(tipo, p.contraparte, p.historico),
      partidas: partidasTitulo(tipo, p.contaPapelId!, c.contaId, c.valor),
    })),
    {
      data: p.dataBanco, competencia: primeiroDiaDoMes(p.dataBanco),
      historico: historicoBaixa(tipo, p.contras.map(() => ({ contraparte: p.contraparte, descricao: p.historico }))),
      partidas: partidasBaixas({ tipo, contaBancoId: p.contaBancoId, contaPapelId: p.contaPapelId, itens: p.contras.map((c) => ({ valor: c.valor })) }),
    },
  ];
}

// ---------- títulos sugeridos ----------

export type TituloRankeavel = { contraparte: string; descricao?: string; saldo: string; vencimento: string | null; competencia: string };
/** Memo de pagamento de guia de imposto (DAS, DARF, "RECEITA FED"...). */
export const MEMO_IMPOSTO = /\b(das|darf|receita fed\w*|simples nacional|pgdas\w*|dctfweb|sefaz|tributos?)\b/i;
const tokens = (s: string) => new Set(norm(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 3));
const dias = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

/** Fração das palavras da contraparte (3+ letras) que aparecem no memo. */
export function similaridadeNome(contraparte: string, memo: string) {
  const t = tokens(contraparte);
  if (!t.size) return 0;
  const m = tokens(memo);
  return [...t].filter((w) => m.has(w)).length / t.size;
}

/**
 * Títulos em aberto do tipo certo, mais prováveis primeiro: saldo igual ao valor da transação, depois o saldo mais
 * próximo, o vencimento (ou competência) mais perto da data do extrato e o nome da contraparte no memo.
 */
export function rankearTitulos<T extends TituloRankeavel>(ts: T[], alvo: { valor: string; data: string; memo: string }) {
  const v = Math.abs(cents(alvo.valor));
  return ts
    .map((t) => {
      const s = cents(t.saldo);
      const exato = s === v;
      const nome = Math.max(similaridadeNome(t.contraparte, alvo.memo), t.descricao ? similaridadeNome(t.descricao, alvo.memo) : 0);
      const score = (exato ? 0 : 10 + Math.min(Math.abs(s - v) / Math.max(v, 1), 5) * 3)
        + Math.min(dias(t.vencimento ?? t.competencia, alvo.data), 120) / 60 - nome * 2;
      return { ...t, exato, nomeParecido: nome >= 0.5, score };
    })
    .sort((a, b) => a.score - b.score);
}

/**
 * Abatimento sugerido ao marcar títulos: preenche cada um até o saldo, na ordem marcada, sem passar do valor da
 * transação; o que sobrar vira juros no último (o usuário ajusta). Valores em centavos.
 */
export function distribuirBaixa(saldos: number[], total: number): { valor: number; juros: number }[] {
  let resta = total;
  const out = saldos.map((s) => {
    const v = Math.max(0, Math.min(s, resta));
    resta -= v;
    return { valor: v, juros: 0 };
  });
  if (resta > 0 && out.length) out[out.length - 1].juros = resta;
  return out;
}

/**
 * Contrapartida possível no reconhecimento de título/nota: analítica de ativo ou resultado sem papel, fora caixa e bancos
 * (1.1.1). Receber começa pelas receitas (3.1), pagar pelos custos e despesas (3.2), estoque e imobilizado.
 */
export function contasDeContrapartida<T extends ContaComPapel>(contas: T[], tipo: TipoTitulo) {
  const ok = contas.filter((c) => !c.papel && /^[13]\./.test(c.codigo) && !em(c, "1.1.1"));
  const primeiro = tipo === "receber" ? "3.1" : "3.2";
  return [...ok.filter((c) => em(c, primeiro)), ...ok.filter((c) => !em(c, primeiro))];
}
