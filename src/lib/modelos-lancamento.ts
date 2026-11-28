/**
 * Modelos de lançamento manual (puro, roda no cliente): cada um preenche o formulário de partidas, que continua
 * editável. As contas saem do plano pelo código (com o nome conferido) ou, num plano diferente, pelo nome no grupo; a que não
 * existir fica em branco e é nomeada em `faltando`.
 */
import { cents, fromCents } from "./format";
import { norm, type ContaPlano } from "./tributos";

/** Onde achar a conta: pelo código (com o nome conferido), senão pelo nome dentro do grupo. `nome` aparece se faltar. */
type Alvo = { nome: string; codigo: string; prefixo: string; re: RegExp };

const em = (codigo: string, prefixo: string) => codigo === prefixo || codigo.startsWith(`${prefixo}.`);
export function acharAlvo<T extends ContaPlano>(contas: T[], a: Alvo): T | null {
  const casa = (c: T) => a.re.test(norm(c.nome));
  return contas.find((c) => c.codigo === a.codigo && casa(c)) ?? contas.find((c) => em(c.codigo, a.prefixo) && !c.papel && casa(c)) ?? null;
}

const A = {
  depreciacao: { nome: "Depreciação e Amortização (despesa)", codigo: "3.2.2.09", prefixo: "3.2", re: /^depreciacao/ },
  depreciacaoAcumulada: { nome: "(-) Depreciação Acumulada", codigo: "1.3.3.07", prefixo: "1.3", re: /^depreciacao acumulada$/ },
  deducoes: { nome: "(-) Deduções de Tributos (receita)", codigo: "3.1.1.04", prefixo: "3.1", re: /deduc/ },
  simples: { nome: "Simples Nacional a Recolher", codigo: "2.1.3.01", prefixo: "2.1", re: /^simples nacional a recolher$/ },
  pis: { nome: "PIS a Recolher", codigo: "2.1.3.06", prefixo: "2.1", re: /^pis a recolher$/ },
  cofins: { nome: "COFINS a Recolher", codigo: "2.1.3.07", prefixo: "2.1", re: /^cofins a recolher$/ },
  iss: { nome: "ISSQN a Recolher", codigo: "2.1.3.03", prefixo: "2.1", re: /^iss(qn)? a recolher$/ },
  irpj: { nome: "IRPJ a Recolher", codigo: "2.1.3.08", prefixo: "2.1", re: /^irpj a recolher$/ },
  csll: { nome: "CSLL a Recolher", codigo: "2.1.3.09", prefixo: "2.1", re: /^csll a recolher$/ },
  irpjDesp: { nome: "IRPJ (despesa)", codigo: "3.2.5.01", prefixo: "3.2", re: /^irpj$/ },
  csllDesp: { nome: "CSLL (despesa)", codigo: "3.2.5.02", prefixo: "3.2", re: /^csll$/ },
  proLabore: { nome: "Pró-labore e Encargos (despesa)", codigo: "3.2.2.02", prefixo: "3.2", re: /^pro-?labore e encargos$/ },
  proLaborePagar: { nome: "Pró-labore a Pagar", codigo: "2.1.4.02", prefixo: "2.1", re: /^pro-?labore a pagar$/ },
  inss: { nome: "INSS a Recolher", codigo: "2.1.4.04", prefixo: "2.1", re: /^inss a recolher$/ },
  irrf: { nome: "IRRF a Recolher", codigo: "2.1.3.04", prefixo: "2.1", re: /^irrf a recolher$/ },
  lucrosDistribuidos: { nome: "(-) Lucros Distribuídos", codigo: "2.3.3.03", prefixo: "2.3", re: /^(lucros distribuidos|dividendos)/ },
  lucrosDistribuir: { nome: "Lucros a Distribuir", codigo: "2.1.5.06", prefixo: "2.1", re: /^(lucros|dividendos) a (distribuir|pagar)$/ },
  adiantamentoSocios: { nome: "Adiantamentos a Sócios", codigo: "1.1.4.06", prefixo: "1.1", re: /^adiantamentos? (a|aos) socios?$/ },
} satisfies Record<string, Alvo>;

export const TRIBUTOS_PROVISAO = {
  simples: { rotulo: "Simples Nacional", despesa: A.deducoes, obrigacao: A.simples },
  pis: { rotulo: "PIS", despesa: A.deducoes, obrigacao: A.pis },
  cofins: { rotulo: "COFINS", despesa: A.deducoes, obrigacao: A.cofins },
  iss: { rotulo: "ISS", despesa: A.deducoes, obrigacao: A.iss },
  irpj: { rotulo: "IRPJ", despesa: A.irpjDesp, obrigacao: A.irpj },
  csll: { rotulo: "CSLL", despesa: A.csllDesp, obrigacao: A.csll },
} as const;
export type TributoProvisao = keyof typeof TRIBUTOS_PROVISAO;

/** INSS do contribuinte individual retido do pró-labore. */
export const INSS_PRO_LABORE = 0.11;

/** Valores do modelo em centavos (campos opcionais: 0). */
export type Parametros = { valor: number; irrf: number; tributo: TributoProvisao };
type Linha = { alvo: Alvo | null; debito?: number; credito?: number };

export type Modelo = {
  id: string; rotulo: string; descricao: string;
  /** Campos pedidos antes de preencher (valor sempre; irrf e tributo quando o modelo usa). */
  campos: { valor: string; irrf?: string; tributo?: true };
  montar: (p: Parametros) => { historico: string; linhas: Linha[] };
} | { id: string; rotulo: string; descricao: string; link: (empresaId: string) => string };

const simples = (historico: string, debito: Alvo | null, credito: Alvo | null) => (p: Parametros) => ({
  historico, linhas: [{ alvo: debito, debito: p.valor }, { alvo: credito, credito: p.valor }],
});

export const MODELOS: Modelo[] = [
  {
    id: "depreciacao", rotulo: "Depreciação mensal", descricao: "D Depreciação e Amortização / C (-) Depreciação Acumulada.",
    campos: { valor: "Depreciação do mês" }, montar: simples("Depreciação do mês", A.depreciacao, A.depreciacaoAcumulada),
  },
  {
    id: "provisao-impostos", rotulo: "Provisão de impostos",
    descricao: "Tributo sobre a receita (Simples, PIS, COFINS, ISS): D Deduções / C a recolher. IRPJ/CSLL: D despesa / C a recolher.",
    campos: { valor: "Valor do tributo", tributo: true },
    montar: (p) => {
      const t = TRIBUTOS_PROVISAO[p.tributo];
      return simples(`Provisão de ${t.rotulo} da competência`, t.despesa, t.obrigacao)(p);
    },
  },
  {
    id: "pro-labore", rotulo: "Pró-labore",
    descricao: "D Pró-labore (bruto) / C INSS a recolher (11% retido) / C IRRF a recolher (se houver) / C Pró-labore a pagar (líquido).",
    campos: { valor: "Pró-labore bruto", irrf: "IRRF retido (opcional)" },
    montar: (p) => {
      const inss = Math.round(p.valor * INSS_PRO_LABORE);
      const liquido = p.valor - inss - p.irrf;
      if (liquido <= 0) throw new Error("INSS e IRRF passam do pró-labore bruto");
      return {
        historico: "Pró-labore do mês",
        linhas: [
          { alvo: A.proLabore, debito: p.valor },
          { alvo: A.inss, credito: inss },
          ...(p.irrf ? [{ alvo: A.irrf, credito: p.irrf }] : []),
          { alvo: A.proLaborePagar, credito: liquido },
        ],
      };
    },
  },
  {
    id: "distribuicao-lucros", rotulo: "Distribuição de lucros",
    descricao: "D (-) Lucros Distribuídos / C Lucros a Distribuir; o pagamento baixa Lucros a Distribuir na conciliação.",
    campos: { valor: "Lucro distribuído" }, montar: simples("Distribuição de lucros aos sócios", A.lucrosDistribuidos, A.lucrosDistribuir),
  },
  {
    id: "compensacao-adiantamento-socio", rotulo: "Compensação de adiantamento a sócios",
    descricao: "O adiantamento vira distribuição de lucros: D (-) Lucros Distribuídos / C Adiantamentos a Sócios.",
    campos: { valor: "Valor compensado" },
    montar: simples("Compensação de adiantamento a sócios com distribuição de lucros", A.lucrosDistribuidos, A.adiantamentoSocios),
  },
  {
    id: "parcelamento", rotulo: "Constituição de parcelamento",
    descricao: "Parcelamento tem título-mãe, parcelas e a divisão curto/longo prazo: use o formulário de Títulos.",
    link: (empresaId) => `/e/${empresaId}/titulos?tipo=parcelamentos`,
  },
  {
    id: "ajuste", rotulo: "Ajuste/reclassificação",
    descricao: "D conta de destino / C conta de origem: escolha as duas contas nas partidas.",
    campos: { valor: "Valor reclassificado" }, montar: simples("Reclassificação: ", null, null),
  },
];

/**
 * Partidas do modelo no formato do formulário (valores "123.45", conta vazia quando falta) e os nomes das contas que
 * não estão no plano.
 */
export function aplicarModelo(m: Extract<Modelo, { montar: unknown }>, p: Parametros, contas: ContaPlano[]) {
  if (!(p.valor > 0)) throw new Error("Informe o valor");
  if (p.irrf < 0) throw new Error("IRRF inválido");
  const { historico, linhas } = m.montar(p);
  const faltando: string[] = [];
  const partidas = linhas.map((l) => {
    const conta = l.alvo ? acharAlvo(contas, l.alvo) : null;
    if (l.alvo && !conta) faltando.push(l.alvo.nome);
    return { contaId: conta?.id ?? "", debito: l.debito ? fromCents(l.debito) : "", credito: l.credito ? fromCents(l.credito) : "" };
  });
  const d = partidas.reduce((s, x) => s + cents(x.debito || 0), 0), c = partidas.reduce((s, x) => s + cents(x.credito || 0), 0);
  if (d !== c) throw new Error("Modelo desbalanceado"); // não acontece: conferido nos testes
  return { historico, partidas, faltando };
}
