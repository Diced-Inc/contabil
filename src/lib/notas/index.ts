/**
 * Notas fiscais (puro): leitura do XML (NF-e modelo 55, NFS-e Padrão Nacional, NFS-e municipal ABRASF 1.0/2.0x),
 * direção pelo CNPJ da empresa e o plano dos títulos (um por duplicata) com as retenções. Roda no navegador (prévia) e
 * no servidor. Caminhos conferidos nos XSDs oficiais (gov.br/nfse v1.00/1.01 com a NT 007/2026; ABRASF 1.00–2.04;
 * NF-e PL_009/PL_010).
 */
import { cents, fimDoMes, fromCents, primeiroDiaDoMes } from "../format";
import type { TipoRetencao } from "../tributos";
import { buscar, lerXml, no, todos, txt, type No } from "./xml";

export type Parte = { documento: string; nome: string };
export type Duplicata = { numero: string; vencimento: string | null; valor: string };
export type RetencaoNota = { tipo: TipoRetencao; valor: string };
export type OrigemNota = "nfe" | "nfse";
export type NotaLida = {
  origem: OrigemNota;
  layout: "NF-e" | "NFS-e Nacional" | "NFS-e ABRASF";
  /**
   * Chave contra duplicidade, a mesma para XML e cadastro manual: emitente|série|número (sem zeros à esquerda).
   * NFS-e não tem série (fica vazia).
   */
  chave: string;
  /** Chave de acesso do XML (NF-e 44 posições, NFS-e nacional 50), quando houver. */
  chaveAcesso: string | null;
  numero: string; serie: string | null;
  /** "YYYY-MM-DD" */
  emissao: string;
  /** "YYYY-MM-01" */
  competencia: string;
  emitente: Parte; destinatario: Parte | null;
  /** Valor do serviço/nota menos descontos (a receita ou o custo reconhecido). */
  bruto: string;
  /** Bruto − retenções: o que o banco movimenta. */
  liquido: string;
  retencoes: RetencaoNota[]; duplicatas: Duplicata[];
  /** Pontos para o contador conferir na revisão. */
  avisos: string[];
};

/** CNPJ/CPF só com letras e dígitos (o CNPJ alfanumérico entra em 2026). */
export const documento = (s: string) => s.toUpperCase().replace(/[^0-9A-Z]/g, "");
const data = (s: string) => (/^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "");
const dinheiro = (s: string) => (s && Number.isFinite(Number(s)) ? fromCents(cents(s)) : "0.00");
const c = (s: string) => cents(dinheiro(s));
const docDe = (n: No | undefined) =>
  documento(txt(n, "CNPJ") || txt(n, "CPF") || txt(n, "CpfCnpj", "Cnpj") || txt(n, "CpfCnpj", "Cpf") || txt(n, "Cnpj") || txt(n, "Cpf"));
const somaRet = (rs: RetencaoNota[]) => rs.reduce((s, r) => s + cents(r.valor), 0);
const ret = (pares: [TipoRetencao, number][]): RetencaoNota[] =>
  pares.filter(([, v]) => v > 0).map(([tipo, v]) => ({ tipo, valor: fromCents(v) }));
/** Chave para nota sem chave de acesso (ABRASF, manual): emitente|série|número, sem zeros à esquerda. */
export const chaveDocumento = (emitente: string, serie: string | null, numero: string) =>
  `${documento(emitente)}|${(serie ?? "").trim().replace(/^0+(?=.)/, "")}|${numero.trim().replace(/^0+(?=.)/, "")}`;

/**
 * Bate retenções com o líquido do XML. Diferença positiva sem retenção identificada vira "outras" (o contador escolhe a
 * conta); retenções federais que não saíram do líquido (prefeitura que preenche como informativo) são descartadas.
 */
function conciliarLiquido(bruto: number, rs: RetencaoNota[], liquidoXml: number | null, avisos: string[]) {
  if (liquidoXml === null || bruto - somaRet(rs) === liquidoXml) return rs;
  const diff = bruto - liquidoXml - somaRet(rs);
  if (diff > 0) {
    avisos.push(`Bruto − líquido do XML tem ${fromCents(diff)} a mais que as retenções lidas: confirme em “Outras retenções”.`);
    return [...rs, { tipo: "outras" as const, valor: fromCents(diff) }];
  }
  const soIss = rs.filter((r) => r.tipo === "iss");
  if (bruto - somaRet(soIss) === liquidoXml) {
    avisos.push("PIS/COFINS/CSLL/IR/INSS informados não foram descontados do líquido: tratados como informativos (sem retenção).");
    return soIss;
  }
  avisos.push(`Líquido do XML (${fromCents(liquidoXml)}) difere de bruto − retenções (${fromCents(bruto - somaRet(rs))}): confira os valores.`);
  return rs;
}

function descontos(bruto: number, incond: number, cond: number, avisos: string[]) {
  if (incond || cond) avisos.push(`Desconto de ${fromCents(incond + cond)} abatido do valor do serviço.`);
  return bruto - incond - cond;
}

// ---------- NF-e modelo 55 ----------

function lerNfe(raiz: No): NotaLida {
  const inf = buscar(raiz, "infNFe")!;
  const ide = no(inf, "ide");
  const chaveAcesso = documento((inf.attrs.Id ?? "").replace(/^NFe/, "")) || documento(txt(buscar(raiz, "infProt"), "chNFe")) || null;
  const tot = no(inf, "total", "ICMSTot");
  const rt = no(inf, "total", "retTrib");
  const retencoes = ret([["pis", c(txt(rt, "vRetPIS"))], ["cofins", c(txt(rt, "vRetCOFINS"))], ["csll", c(txt(rt, "vRetCSLL"))], ["irrf", c(txt(rt, "vIRRF"))], ["inss", c(txt(rt, "vRetPrev"))]]);
  const bruto = c(txt(tot, "vNF"));
  const emissao = data(txt(ide, "dhEmi") || txt(ide, "dEmi"));
  const avisos: string[] = [];
  if (txt(ide, "mod") && txt(ide, "mod") !== "55") avisos.push(`Modelo ${txt(ide, "mod")} (esperado 55).`);
  if (!buscar(raiz, "protNFe")) avisos.push("XML sem o protocolo de autorização (protNFe): confira se a nota foi autorizada.");
  const fin = txt(ide, "finNFe");
  if (fin && fin !== "1") avisos.push(({ 2: "NF-e complementar.", 3: "NF-e de ajuste.", 4: "NF-e de devolução: confira a direção e a conta." } as Record<string, string>)[fin] ?? `Finalidade ${fin}.`);
  if (txt(ide, "tpNF") === "0") avisos.push("NF-e de entrada (tpNF 0): o emitente registrou uma entrada; confira a direção.");
  const dest = no(inf, "dest");
  return {
    origem: "nfe", layout: "NF-e", chave: chaveDocumento(docDe(no(inf, "emit")), txt(ide, "serie") || null, txt(ide, "nNF")), chaveAcesso,
    numero: txt(ide, "nNF"), serie: txt(ide, "serie") || null, emissao,
    competencia: emissao ? primeiroDiaDoMes(emissao) : "",
    emitente: { documento: docDe(no(inf, "emit")), nome: txt(no(inf, "emit"), "xNome") },
    destinatario: dest ? { documento: docDe(dest) || documento(txt(dest, "idEstrangeiro")), nome: txt(dest, "xNome") } : null,
    bruto: fromCents(bruto), liquido: fromCents(bruto - somaRet(retencoes)), retencoes,
    duplicatas: todos(no(inf, "cobr"), "dup").map((d) => ({ numero: txt(d, "nDup"), vencimento: data(txt(d, "dVenc")) || null, valor: dinheiro(txt(d, "vDup")) })),
    avisos,
  };
}

// ---------- NFS-e Padrão Nacional (gov.br/nfse) ----------

/**
 * PIS/COFINS/CSLL retidos. Desde a NT 007/2026, vRetCSLL soma os retidos e tpRetPisCofins diz quais (vPis/vCofins
 * viram apuração própria); antes, vPis/vCofins eram os retidos quando tpRetPisCofins = 1. O código 1 vale nos dois
 * regimes: decide pelo vTotalRet.
 */
function retidosFederais(tf: No | undefined, outros: number, totalRet: number | null, avisos: string[]): RetencaoNota[] {
  const pc = no(tf, "piscofins");
  const tp = txt(pc, "tpRetPisCofins");
  const vRetCsll = c(txt(tf, "vRetCSLL")), vPis = c(txt(pc, "vPis")), vCofins = c(txt(pc, "vCofins"));
  const novo = (): RetencaoNota[] => ret([[({ "5": "pis", "6": "cofins", "8": "csll" } as Record<string, TipoRetencao>)[tp] ?? "csrf", vRetCsll]]);
  if (!tp || tp === "2") return ret([["csll", vRetCsll]]);
  if (tp !== "1") return tp === "0" ? ret([["csll", vRetCsll]]) : novo();
  if (totalRet !== null && totalRet === outros + vRetCsll) return novo();
  if (totalRet !== null && totalRet === outros + vRetCsll + vPis + vCofins) return ret([["pis", vPis], ["cofins", vCofins], ["csll", vRetCsll]]);
  avisos.push("tpRetPisCofins = 1 sem vTotalRet que confirme o regime: PIS/COFINS/CSLL lidos como retidos em vRetCSLL (NT 007).");
  return novo();
}

function lerNfseNacional(raiz: No): NotaLida {
  const inf = buscar(raiz, "infNFSe")!;
  const dps = no(inf, "DPS", "infDPS");
  if (!dps) throw new Error("NFS-e nacional sem a DPS");
  const avisos: string[] = [];
  const cStat = txt(inf, "cStat");
  if (cStat && !["100", "101", "102", "103", "107"].includes(cStat)) avisos.push(`Situação ${cStat}: confira se a NFS-e é válida.`);
  const vals = no(dps, "valores");
  const trib = no(vals, "trib");
  const tf = no(trib, "tribFed") ?? no(trib, "tribNac"); // tribNac: rascunho de 2022
  const totalRetTxt = txt(inf, "valores", "vTotalRet");
  const totalRet = totalRetTxt ? c(totalRetTxt) : null;
  const issRetido = ["2", "3"].includes(txt(trib, "tribMun", "tpRetISSQN"));
  const base = ret([["iss", issRetido ? c(txt(inf, "valores", "vISSQN")) : 0], ["irrf", c(txt(tf, "vRetIRRF"))], ["inss", c(txt(tf, "vRetCP"))]]);
  const retencoes0 = [...base, ...retidosFederais(tf, somaRet(base), totalRet, avisos)];
  const desc = no(vals, "vDescCondIncond");
  const bruto = descontos(c(txt(vals, "vServPrest", "vServ")), c(txt(desc, "vDescIncond")), c(txt(desc, "vDescCond")), avisos);
  const liqTxt = txt(inf, "valores", "vLiq");
  const retencoes = conciliarLiquido(bruto, retencoes0, liqTxt ? c(liqTxt) : null, avisos);
  const emit = no(inf, "emit"), prest = no(dps, "prest"), toma = no(dps, "toma");
  const prestDoc = docDe(prest) || docDe(emit);
  const emissao = data(txt(dps, "dhEmi"));
  const compet = data(txt(dps, "dCompet"));
  return {
    origem: "nfse", layout: "NFS-e Nacional",
    chave: chaveDocumento(prestDoc, null, txt(inf, "nNFSe")), chaveAcesso: documento((inf.attrs.Id ?? "").replace(/^NFS/, "")) || null,
    numero: txt(inf, "nNFSe"), serie: null, emissao, competencia: primeiroDiaDoMes(compet || emissao),
    emitente: { documento: prestDoc, nome: (txt(dps, "tpEmit") === "1" || !txt(dps, "tpEmit") ? txt(emit, "xNome") : "") || txt(prest, "xNome") },
    destinatario: toma ? { documento: docDe(toma), nome: txt(toma, "xNome") } : null,
    bruto: fromCents(bruto), liquido: fromCents(bruto - somaRet(retencoes)), retencoes, duplicatas: [], avisos,
  };
}

// ---------- NFS-e municipal ABRASF (1.0 e 2.0x) ----------

function lerAbrasf(inf: No): NotaLida {
  const avisos: string[] = [];
  const decl = no(inf, "DeclaracaoPrestacaoServico", "InfDeclaracaoPrestacaoServico"); // 2.0x
  const servico = no(decl ?? inf, "Servico");
  const v = no(servico, "Valores");
  const issRetido = (txt(servico, "IssRetido") || txt(v, "IssRetido")) === "1";
  const vIss = c(txt(v, "ValorIssRetido")) || c(txt(v, "ValorIss")) || c(txt(inf, "ValoresNfse", "ValorIss"));
  const retencoes0 = ret([
    ["iss", issRetido ? vIss : 0], ["irrf", c(txt(v, "ValorIr"))], ["inss", c(txt(v, "ValorInss"))], ["pis", c(txt(v, "ValorPis"))],
    ["cofins", c(txt(v, "ValorCofins"))], ["csll", c(txt(v, "ValorCsll"))], ["outras", c(txt(v, "OutrasRetencoes"))],
  ]);
  if (retencoes0.some((r) => r.tipo === "outras")) avisos.push("Outras retenções no XML: escolha a conta.");
  const bruto = descontos(c(txt(v, "ValorServicos")), c(txt(v, "DescontoIncondicionado")), c(txt(v, "DescontoCondicionado")), avisos);
  const liqTxt = txt(inf, "ValoresNfse", "ValorLiquidoNfse") || txt(v, "ValorLiquidoNfse");
  const retencoes = conciliarLiquido(bruto, retencoes0, liqTxt ? c(liqTxt) : null, avisos);
  const prestador = no(inf, "PrestadorServico");
  const prestDoc = docDe(no(decl, "Prestador")) || docDe(no(prestador, "IdentificacaoPrestador"));
  const tom = no(decl, "TomadorServico") ?? no(decl, "Tomador") ?? no(inf, "TomadorServico");
  const emissao = data(txt(inf, "DataEmissao"));
  const compet = data(txt(decl, "Competencia") || txt(inf, "Competencia"));
  const numero = txt(inf, "Numero");
  return {
    origem: "nfse", layout: "NFS-e ABRASF", chave: chaveDocumento(prestDoc, null, numero), chaveAcesso: null, numero, serie: null, emissao,
    competencia: primeiroDiaDoMes(compet || emissao),
    emitente: { documento: prestDoc, nome: txt(prestador, "RazaoSocial") },
    destinatario: tom ? { documento: docDe(no(tom, "IdentificacaoTomador")), nome: txt(tom, "RazaoSocial") } : null,
    bruto: fromCents(bruto), liquido: fromCents(bruto - somaRet(retencoes)), retencoes, duplicatas: [], avisos,
  };
}

// ---------- detecção ----------

const EVENTOS = ["procEventoNFe", "evento", "retEvento", "procEventoNFSe", "pedRegEvento", "eventoCancelamento", "Cancelamento", "CancelarNfseEnvio"];

/** Lê uma nota do XML; evento (cancelamento, carta de correção), nota cancelada ou layout desconhecido lança erro com o motivo. */
export function lerNota(xml: string): NotaLida {
  const raiz = lerXml(xml);
  const topo = raiz.filhos[0]?.nome ?? "";
  if (EVENTOS.includes(topo)) throw new Error("É um evento (cancelamento, carta de correção...), não uma nota: ignorado");
  if (buscar(raiz, "infNFe")) return lerNfe(raiz);
  if (buscar(raiz, "infNFSe")) return lerNfseNacional(raiz);
  const inf = buscar(raiz, "InfNfse");
  if (inf) {
    if (buscar(raiz, "NfseCancelamento")) throw new Error("NFS-e cancelada: ignorada");
    return lerAbrasf(inf);
  }
  // resposta de webservice com o XML da nota escapado dentro de um texto
  const dentro = /<\s*(?:\w+:)?(CompNfse|NFSe|nfeProc)\b/.exec(textoTodo(raiz));
  if (dentro) return lerNota(textoTodo(raiz).slice(dentro.index));
  throw new Error("Layout não reconhecido (esperado NF-e modelo 55, NFS-e nacional ou ABRASF)");
}
const textoTodo = (n: No): string => n.texto + n.filhos.map(textoTodo).join("");

// ---------- direção e títulos ----------

export type Direcao = "receber" | "pagar";

/** Empresa emitente/prestadora → a receber; destinatária/tomadora → a pagar; nenhum dos dois → null. */
export function direcaoDaNota(n: Pick<NotaLida, "emitente" | "destinatario">, cnpjEmpresa: string): Direcao | null {
  const cnpj = documento(cnpjEmpresa);
  if (n.emitente.documento === cnpj) return "receber";
  if (n.destinatario?.documento === cnpj) return "pagar";
  return null;
}

/** A outra parte da nota, pela direção. */
export const contraparteDaNota = (n: Pick<NotaLida, "emitente" | "destinatario">, d: Direcao): Parte =>
  d === "receber" ? n.destinatario ?? { documento: "", nome: "Consumidor" } : n.emitente;

export type ParcelaNota = { valor: string; vencimento: string | null };

/**
 * Um título por duplicata; sem duplicata, ou com duplicatas que não somam o líquido, um título só com o líquido (e o
 * aviso). `vencimento`: o informado quando não há duplicata.
 */
export function parcelasDaNota(n: Pick<NotaLida, "liquido" | "duplicatas">, vencimento?: string | null): { parcelas: ParcelaNota[]; aviso?: string } {
  const liquido = cents(n.liquido);
  if (!(liquido > 0)) throw new Error("Valor líquido da nota precisa ser maior que zero");
  const soma = n.duplicatas.reduce((s, d) => s + cents(d.valor), 0);
  const unico = { parcelas: [{ valor: fromCents(liquido), vencimento: vencimento || n.duplicatas[0]?.vencimento || null }] };
  if (!n.duplicatas.length) return unico;
  if (soma !== liquido || n.duplicatas.some((d) => !(cents(d.valor) > 0)))
    return { ...unico, aviso: `Duplicatas somam ${fromCents(soma)}, o líquido é ${fromCents(liquido)}: um título só pelo líquido.` };
  return { parcelas: n.duplicatas.map((d) => ({ valor: fromCents(cents(d.valor)), vencimento: d.vencimento })) };
}

/** Parcelas mensais iguais (cadastro manual): a última leva o resto dos centavos. */
export function parcelasIguais(liquido: string, n: number, primeiroVencimento: string | null, somarMes: (d: string, k: number) => string): ParcelaNota[] {
  const total = cents(liquido);
  if (!Number.isInteger(n) || n < 1 || n > 120) throw new Error("Parcelas entre 1 e 120");
  if (!(total > 0)) throw new Error("Valor líquido da nota precisa ser maior que zero");
  const cada = Math.floor(total / n);
  return Array.from({ length: n }, (_, i) => ({
    valor: fromCents(i === n - 1 ? total - cada * (n - 1) : cada),
    vencimento: primeiroVencimento ? somarMes(primeiroVencimento, i) : null,
  }));
}

/** Data do reconhecimento: a emissão se cair no mês da competência; senão o 1º dia (competência depois) ou o último (antes). */
export function dataDaNota(emissao: string, competencia: string) {
  const c = primeiroDiaDoMes(competencia), e = primeiroDiaDoMes(emissao);
  return c === e ? emissao : c > e ? c : fimDoMes(c);
}

export const rotuloNota = (origem: OrigemNota | "manual", numero: string, serie: string | null) =>
  `${origem === "nfse" ? "NFS-e" : origem === "nfe" ? "NF-e" : "NF"} ${numero}${serie ? `/${serie}` : ""}`;

/** Duplicada: chave já registrada na empresa ou repetida no próprio lote (a primeira ocorrência vale). */
export function marcarDuplicadas(chaves: string[], registradas: ReadonlySet<string>) {
  const vistas = new Set<string>();
  return chaves.map((c) => {
    const dup = registradas.has(c) || vistas.has(c);
    vistas.add(c);
    return dup;
  });
}
