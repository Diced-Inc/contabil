/**
 * Contas dos tributos (puro, roda no cliente e no servidor): guia → obrigação a recolher + despesa, e retenções de nota
 * fiscal → a compensar (nota emitida) ou a recolher (nota recebida). Códigos de receita conferidos no Manual da DCTFWeb
 * (RFB, jan/2025) e na tabela de códigos de receita da RFB.
 */
import type { TipoGuia } from "./guias";
import type { TipoTitulo } from "./operacoes";

export type ContaPlano = { id: string; codigo: string; nome: string; papel?: string | null };
/** Onde achar a conta no plano (prefixo + nome normalizado) e, se faltar, como criá-la (analítica sob `pai`). */
export type AlvoConta = { prefixo: string; re: RegExp; criar?: { pai: string; nome: string; natureza: "D" | "C" } };

export const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\(-\)/g, " ").replace(/\s+/g, " ").trim();
const em = (codigo: string, prefixo: string) => codigo === prefixo || codigo.startsWith(`${prefixo}.`);

/** Primeira analítica que casa o alvo (pelo nome dentro do grupo), ou null. */
export function acharConta<T extends ContaPlano>(contas: T[], alvo: AlvoConta | null | undefined): T | null {
  if (!alvo) return null;
  return contas.find((c) => em(c.codigo, alvo.prefixo) && !c.papel && alvo.re.test(norm(c.nome)))
    ?? (alvo.criar ? contas.find((c) => norm(c.nome) === norm(alvo.criar!.nome)) ?? null : null);
}

const C = {
  simples: { prefixo: "2.1", re: /^simples nacional a recolher$/ },
  inss: { prefixo: "2.1", re: /^inss a recolher$/ },
  irpj: { prefixo: "2.1", re: /^irpj a recolher$/ },
  csll: { prefixo: "2.1", re: /^csll a recolher$/ },
  pis: { prefixo: "2.1", re: /^pis a recolher$/ },
  cofins: { prefixo: "2.1", re: /^cofins a recolher$/ },
  irrf: { prefixo: "2.1", re: /^irrf a recolher$/ },
  iss: { prefixo: "2.1", re: /^iss(qn)? a recolher$/ },
  csrf: { prefixo: "2.1", re: /^pis\/cofins\/csll retid[oa]s? a recolher$/, criar: { pai: "2.1.3", nome: "PIS/COFINS/CSLL Retidos a Recolher", natureza: "C" } },
  // despesas
  deducoes: { prefixo: "3.1", re: /deduc/ },
  irpjDesp: { prefixo: "3.2", re: /^irpj$/ },
  csllDesp: { prefixo: "3.2", re: /^csll$/ },
  proLabore: { prefixo: "3.2", re: /^pro-?labore e encargos$/ },
  impostosTaxas: { prefixo: "3.2", re: /^impostos e taxas$/ },
  // a compensar (retido pelo tomador na nota emitida)
  irrfCompensar: { prefixo: "1.1", re: /^irrf retido a compensar$/, criar: { pai: "1.1.4", nome: "IRRF Retido a Compensar", natureza: "D" } },
  csrfCompensar: { prefixo: "1.1", re: /^pis\/cofins\/csll retid[oa]s? a compensar$/, criar: { pai: "1.1.4", nome: "PIS/COFINS/CSLL Retidos a Compensar", natureza: "D" } },
  inssCompensar: { prefixo: "1.1", re: /^inss retido a compensar$/, criar: { pai: "1.1.4", nome: "INSS Retido a Compensar", natureza: "D" } },
} satisfies Record<string, AlvoConta>;

/**
 * despesa: a guia reconhece a despesa (D despesa / C a recolher). ja_registrada: a obrigação nasceu antes (retenção na
 * nota recebida): o título só aponta para a conta a recolher, sem lançamento.
 */
export type ModoGuia = "despesa" | "ja_registrada";
export type ContasGuia = { tributo: string; obrigacao: AlvoConta; despesa: AlvoConta | null; modo: ModoGuia; nota?: string };

type Tributo = Omit<ContasGuia, "nota"> & { codigos: string[]; nota?: string };
const NOTA_FOLHA = "Retenção sobre pró-labore/salário: sem folha lançada, entra como encargo do pró-labore. Se o pró-labore já foi lançado bruto com a retenção a recolher, use “Obrigação já registrada”.";
const NOTA_NF = "Retenção na nota de um fornecedor: a obrigação nasce no registro da nota (Títulos). Se a nota não foi registrada, escolha a despesa.";
const NOTA_ESTIMATIVA = "Estimativa mensal (lucro real): antecipação do ajuste anual.";

/** Códigos de receita do DARF (4 dígitos, sem a extensão). */
const TRIBUTOS: Tributo[] = [
  { tributo: "IRPJ", codigos: ["2089", "0220", "3373"], obrigacao: C.irpj, despesa: C.irpjDesp, modo: "despesa" },
  { tributo: "IRPJ", codigos: ["2362", "5993"], obrigacao: C.irpj, despesa: C.irpjDesp, modo: "despesa", nota: NOTA_ESTIMATIVA },
  { tributo: "CSLL", codigos: ["2372", "6012", "6773"], obrigacao: C.csll, despesa: C.csllDesp, modo: "despesa" },
  { tributo: "CSLL", codigos: ["2484"], obrigacao: C.csll, despesa: C.csllDesp, modo: "despesa", nota: NOTA_ESTIMATIVA },
  { tributo: "PIS", codigos: ["8109", "6912", "8301"], obrigacao: C.pis, despesa: C.deducoes, modo: "despesa" },
  { tributo: "COFINS", codigos: ["2172", "5856"], obrigacao: C.cofins, despesa: C.deducoes, modo: "despesa" },
  { tributo: "IRRF", codigos: ["0561", "0588"], obrigacao: C.irrf, despesa: C.proLabore, modo: "despesa", nota: NOTA_FOLHA },
  { tributo: "IRRF", codigos: ["1708", "3208", "8045", "3280", "5706"], obrigacao: C.irrf, despesa: C.impostosTaxas, modo: "ja_registrada", nota: NOTA_NF },
  { tributo: "PIS/COFINS/CSLL retidos", codigos: ["5952", "5979", "5960", "5987"], obrigacao: C.csrf, despesa: C.impostosTaxas, modo: "ja_registrada", nota: NOTA_NF },
  { tributo: "INSS", codigos: ["1082", "1099"], obrigacao: C.inss, despesa: C.proLabore, modo: "despesa", nota: NOTA_FOLHA },
  { tributo: "INSS", codigos: ["1162"], obrigacao: C.inss, despesa: C.impostosTaxas, modo: "ja_registrada", nota: NOTA_NF },
  {
    tributo: "INSS", codigos: ["1138", "1141", "1646", "1170", "1176", "1191", "1196", "1200", "1213", "1221"],
    obrigacao: C.inss, despesa: C.proLabore, modo: "despesa",
  },
];

/** "0561-07" → "0561". */
export const codigoBase = (codigo: string | null | undefined) => (codigo ?? "").replace(/\D/g, "").slice(0, 4);

/**
 * Contas da guia pelo tipo e código da receita. DAS: D Deduções (o Simples é tributo sobre a receita) / C Simples
 * Nacional a Recolher. DARF previdenciário: INSS a Recolher. DARF de impostos: pelo código. null = desconhecido (o
 * contador escolhe as contas).
 */
export function contasDaGuia(tipo: TipoGuia, codigoReceita?: string | null): ContasGuia | null {
  if (tipo === "das" || tipo === "das_mei") return { tributo: "Simples Nacional", obrigacao: C.simples, despesa: C.deducoes, modo: "despesa" };
  const cod = codigoBase(codigoReceita);
  const t = cod ? TRIBUTOS.find((x) => x.codigos.includes(cod)) : undefined;
  if (tipo === "darf_previdenciario") {
    if (t && t.obrigacao === C.inss) return { tributo: t.tributo, obrigacao: t.obrigacao, despesa: t.despesa, modo: t.modo, nota: t.nota };
    return { tributo: "INSS", obrigacao: C.inss, despesa: C.proLabore, modo: "despesa" };
  }
  if (!t) return null;
  return { tributo: t.tributo, obrigacao: t.obrigacao, despesa: t.despesa, modo: t.modo, nota: t.nota };
}

// ---------- retenções de nota fiscal ----------

/** csrf: PIS/COFINS/CSLL retidos somados (NFS-e nacional depois da NT 007/2026 traz tudo em vRetCSLL). */
export const TIPOS_RETENCAO = ["iss", "irrf", "pis", "cofins", "csll", "csrf", "inss", "outras"] as const;
export type TipoRetencao = (typeof TIPOS_RETENCAO)[number];
export const NOMES_RETENCAO: Record<TipoRetencao, string> = {
  iss: "ISS retido", irrf: "IRRF", pis: "PIS retido", cofins: "COFINS retida", csll: "CSLL retida", csrf: "PIS/COFINS/CSLL retidos", inss: "INSS retido", outras: "Outras retenções",
};

/**
 * Conta da retenção. Nota emitida (receber): o tomador reteve; federal vira crédito a compensar (1.1.4), ISS retido é
 * tributo sobre a receita (Deduções). Nota recebida (pagar): a empresa reteve e deve recolher. "outras": o contador escolhe.
 */
export function contaRetencao(tipo: TipoTitulo, r: TipoRetencao): AlvoConta | null {
  if (r === "outras") return null;
  if (tipo === "receber")
    return { iss: C.deducoes, irrf: C.irrfCompensar, pis: C.csrfCompensar, cofins: C.csrfCompensar, csll: C.csrfCompensar, csrf: C.csrfCompensar, inss: C.inssCompensar }[r];
  return { iss: C.iss, irrf: C.irrf, pis: C.csrf, cofins: C.csrf, csll: C.csrf, csrf: C.csrf, inss: C.inss }[r];
}
