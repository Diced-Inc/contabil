/** Licitações do PNCP (Portal Nacional de Contratações Públicas): mapeamento da API, busca e prazos. Puro, sem banco. */

/** Item de GET /api/consulta/v1/contratacoes/proposta (só os campos usados; o JSON inteiro vai para `raw`). */
export type ContratacaoPncp = {
  numeroControlePNCP: string;
  anoCompra: number;
  sequencialCompra: number;
  numeroCompra: string | null;
  processo: string | null;
  objetoCompra: string | null;
  valorTotalEstimado: number | null;
  modalidadeId: number;
  modalidadeNome: string;
  situacaoCompraId: number;
  situacaoCompraNome: string;
  dataAberturaProposta: string | null;
  dataEncerramentoProposta: string | null;
  linkSistemaOrigem: string | null;
  orgaoEntidade: { cnpj: string; razaoSocial: string };
  unidadeOrgao: { ufSigla: string; municipioNome: string; nomeUnidade: string; codigoIbge: string | null };
};

export type PaginaPncp = { data: ContratacaoPncp[]; totalRegistros: number; totalPaginas: number; numeroPagina: number };

export type LicitacaoNova = {
  numeroControle: string;
  orgaoCnpj: string;
  orgaoNome: string;
  unidadeNome: string;
  municipio: string;
  uf: string;
  modalidadeId: number;
  modalidadeNome: string;
  objeto: string;
  valorEstimado: string | null;
  aberturaPropostas: Date | null;
  encerramentoPropostas: Date | null;
  situacaoId: number;
  situacaoNome: string;
  ano: number;
  sequencial: number;
  numeroCompra: string | null;
  processo: string | null;
  linkPncp: string;
  linkSistemaOrigem: string | null;
  textoBusca: string;
  raw: unknown;
};

/** Códigos de modalidade da Lei 14.133 (manual PNCP, tabela de domínio). */
export const MODALIDADES: Record<number, string> = {
  1: "Leilão eletrônico",
  2: "Diálogo competitivo",
  3: "Concurso",
  4: "Concorrência eletrônica",
  5: "Concorrência presencial",
  6: "Pregão eletrônico",
  7: "Pregão presencial",
  8: "Dispensa",
  9: "Inexigibilidade",
  10: "Manifestação de interesse",
  11: "Pré-qualificação",
  12: "Credenciamento",
  13: "Leilão presencial",
  14: "Inaplicabilidade",
  15: "Chamada pública",
};

/** Etapas do acompanhamento, na ordem das colunas. */
export const STATUS_SALVA = {
  interesse: { rotulo: "Interesse", badge: "brand" },
  analisando: { rotulo: "Analisando", badge: "info" },
  proposta_enviada: { rotulo: "Proposta enviada", badge: "violet" },
  ganha: { rotulo: "Ganha", badge: "success" },
  perdida: { rotulo: "Perdida", badge: "danger" },
  descartada: { rotulo: "Descartada", badge: "muted" },
} as const;
export type StatusSalva = keyof typeof STATUS_SALVA;

/** Situação 1 = "Divulgada no PNCP" (as outras: revogada, anulada, suspensa). */
export const SITUACAO_DIVULGADA = 1;

export const UFS = [
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB",
  "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
] as const;

/** Minúsculas, sem acento e com espaços simples: base da busca nos dois lados. */
export const normalizar = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** "limpeza, material de escritório" → ["limpeza", "material de escritorio"]; cada termo é um trecho, basta um bater. */
export const separarTermos = (s: string) => [...new Set(s.split(/[,;\n]/).map(normalizar).filter(Boolean))];

const limpar = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** O PNCP manda horário de Brasília sem fuso ("2026-12-11T09:00:00"). Brasil sem horário de verão desde 2019. */
export function dataPncp(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}-03:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const linkPncp = (cnpj: string, ano: number, sequencial: number) => `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${sequencial}`;

export function mapearContratacao(c: ContratacaoPncp): LicitacaoNova {
  const objeto = limpar(c.objetoCompra) || "(sem descrição)";
  const orgaoNome = limpar(c.orgaoEntidade.razaoSocial);
  const unidadeNome = limpar(c.unidadeOrgao.nomeUnidade);
  const municipio = limpar(c.unidadeOrgao.municipioNome);
  const valor = Number(c.valorTotalEstimado);
  return {
    numeroControle: c.numeroControlePNCP,
    orgaoCnpj: c.orgaoEntidade.cnpj,
    orgaoNome,
    unidadeNome,
    municipio,
    uf: c.unidadeOrgao.ufSigla,
    modalidadeId: c.modalidadeId,
    modalidadeNome: MODALIDADES[c.modalidadeId] ?? limpar(c.modalidadeNome),
    objeto,
    // 0 ou ausente = valor sigiloso/não informado
    valorEstimado: valor > 0 ? valor.toFixed(2) : null,
    aberturaPropostas: dataPncp(c.dataAberturaProposta),
    encerramentoPropostas: dataPncp(c.dataEncerramentoProposta),
    situacaoId: c.situacaoCompraId,
    situacaoNome: limpar(c.situacaoCompraNome),
    ano: c.anoCompra,
    sequencial: c.sequencialCompra,
    numeroCompra: limpar(c.numeroCompra) || null,
    processo: limpar(c.processo) || null,
    linkPncp: linkPncp(c.orgaoEntidade.cnpj, c.anoCompra, c.sequencialCompra),
    linkSistemaOrigem: /^https?:\/\//i.test(c.linkSistemaOrigem ?? "") ? c.linkSistemaOrigem!.trim() : null,
    textoBusca: normalizar([objeto, orgaoNome, unidadeNome, municipio, c.processo, c.numeroCompra].filter(Boolean).join(" ")),
    raw: c,
  };
}

/** Critérios de uma busca salva (listas vazias e valores null = sem filtro). */
export type CriteriosBusca = {
  termos: string[];
  ufs: string[];
  municipios: string[];
  modalidades: number[];
  valorMin: string | number | null;
  valorMax: string | number | null;
};

type LicitacaoComparavel = { textoBusca: string; uf: string; municipio: string; modalidadeId: number; valorEstimado: string | null };

/** Bate se algum termo aparece (sem acento) e todos os filtros conferem. Com faixa de valor, licitação sem valor fica de fora. */
export function casaBusca(l: LicitacaoComparavel, b: CriteriosBusca) {
  const termos = b.termos.map(normalizar).filter(Boolean);
  if (termos.length && !termos.some((t) => l.textoBusca.includes(t))) return false;
  if (b.ufs.length && !b.ufs.includes(l.uf)) return false;
  if (b.municipios.length && !b.municipios.map(normalizar).includes(normalizar(l.municipio))) return false;
  if (b.modalidades.length && !b.modalidades.includes(l.modalidadeId)) return false;
  const temMin = b.valorMin !== null && b.valorMin !== "";
  const temMax = b.valorMax !== null && b.valorMax !== "";
  if (temMin || temMax) {
    if (l.valorEstimado === null) return false;
    const v = Number(l.valorEstimado);
    if (temMin && v < Number(b.valorMin)) return false;
    if (temMax && v > Number(b.valorMax)) return false;
  }
  return true;
}

const diaSP = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
const horaSP = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
const dataSP = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" });

/** Dias de calendário (em São Paulo) entre hoje e o encerramento: 0 = hoje, 1 = amanhã, negativo = já passou o dia. */
export function diasParaEncerrar(encerramento: Date, agora = new Date()) {
  const dia = (d: Date) => Date.parse(diaSP.format(d) + "T00:00:00Z");
  return Math.round((dia(encerramento) - dia(agora)) / 86_400_000);
}

/** Texto e urgência do prazo das propostas (urgente = encerra hoje ou amanhã). */
export function prazoEncerramento(encerramento: Date | null, agora = new Date()) {
  if (!encerramento) return { texto: "Sem data de encerramento", urgente: false, encerrada: false };
  if (encerramento.getTime() <= agora.getTime()) return { texto: "Propostas encerradas", urgente: false, encerrada: true };
  const dias = diasParaEncerrar(encerramento, agora);
  const hora = horaSP.format(encerramento);
  const texto = dias === 0 ? `Encerra hoje às ${hora}` : dias === 1 ? `Encerra amanhã às ${hora}` : `Encerra em ${dias} dias`;
  return { texto, urgente: dias < 2, encerrada: false };
}

export const fmtDataHoraSP = (d: Date) => `${dataSP.format(d)} ${horaSP.format(d)}`;
export const fmtDataSP = (d: Date) => dataSP.format(d);

/** Início do dia (em SP) daqui a `dias + 1` dias: limite exclusivo de "encerra em até N dias". */
export function limitePrazo(dias: number, agora = new Date()) {
  const hoje = diaSP.format(agora);
  const d = new Date(`${hoje}T00:00:00-03:00`);
  d.setUTCDate(d.getUTCDate() + dias + 1);
  return d;
}
