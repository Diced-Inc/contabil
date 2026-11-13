/** Regras puras do ciclo mensal com o cliente (competência, transições de status, situação do DAS). */
export type StatusCiclo = "aguardando_extrato" | "extrato_recebido" | "em_processamento" | "das_enviado" | "das_pago";
export type EventoCiclo = "extrato_enviado" | "processar" | "concluir" | "pagar" | "reabrir";

export const ORDEM_STATUS: StatusCiclo[] = ["aguardando_extrato", "extrato_recebido", "em_processamento", "das_enviado", "das_pago"];

/** Texto para o cliente (portal) e rótulo curto para o contador. */
export const STATUS_CICLO: Record<StatusCiclo, { cliente: string; rotulo: string; badge: "warning" | "info" | "violet" | "brand" | "success" }> = {
  aguardando_extrato: { cliente: "Estamos esperando os extratos do mês.", rotulo: "Aguardando extrato", badge: "warning" },
  extrato_recebido: { cliente: "Recebemos seus arquivos. Em breve o contador começa o fechamento.", rotulo: "Extrato recebido", badge: "info" },
  em_processamento: { cliente: "O contador está fechando o mês.", rotulo: "Em processamento", badge: "violet" },
  das_enviado: { cliente: "O mês foi concluído e a guia do DAS está disponível.", rotulo: "DAS enviado", badge: "brand" },
  das_pago: { cliente: "Tudo certo: o DAS do mês está pago.", rotulo: "DAS pago", badge: "success" },
};

/** Para cada evento, de onde pode partir e para onde vai (ausente = transição inválida). */
const TRANSICOES: Record<EventoCiclo, Partial<Record<StatusCiclo, StatusCiclo>>> = {
  // Cliente pode mandar mais arquivos enquanto o mês não foi concluído.
  extrato_enviado: {
    aguardando_extrato: "extrato_recebido",
    extrato_recebido: "extrato_recebido",
    em_processamento: "em_processamento",
  },
  // Contador importa/marca um documento: inicia o processamento; depois do DAS não mexe no status.
  processar: {
    aguardando_extrato: "em_processamento",
    extrato_recebido: "em_processamento",
    em_processamento: "em_processamento",
    das_enviado: "das_enviado",
    das_pago: "das_pago",
  },
  concluir: {
    aguardando_extrato: "das_enviado",
    extrato_recebido: "das_enviado",
    em_processamento: "das_enviado",
  },
  pagar: { das_enviado: "das_pago" },
  reabrir: { das_enviado: "em_processamento", das_pago: "em_processamento" },
};

const MOTIVO: Record<EventoCiclo, string> = {
  extrato_enviado: "O mês já foi concluído. Fale com o contador para enviar mais arquivos.",
  processar: "Status do ciclo inválido.",
  concluir: "O mês já foi concluído. Reabra o ciclo para enviar outra guia.",
  pagar: "Não há DAS em aberto neste mês.",
  reabrir: "O ciclo ainda não foi concluído.",
};

export class TransicaoInvalida extends Error {}

/** Próximo status ou TransicaoInvalida com mensagem para o usuário. */
export function proximoStatus(atual: StatusCiclo, evento: EventoCiclo): StatusCiclo {
  const novo = TRANSICOES[evento][atual];
  if (!novo) throw new TransicaoInvalida(MOTIVO[evento]);
  return novo;
}

export const passou = (s: StatusCiclo, ref: StatusCiclo) => ORDEM_STATUS.indexOf(s) >= ORDEM_STATUS.indexOf(ref);

/** Competência que o cliente deve enviar: o mês anterior a hoje ("YYYY-MM-DD" em São Paulo) → "YYYY-MM-01". */
export function competenciaAtual(hoje: string) {
  const ano = Number(hoje.slice(0, 4));
  const mes = Number(hoje.slice(5, 7));
  return mes === 1 ? `${ano - 1}-12-01` : `${ano}-${String(mes - 1).padStart(2, "0")}-01`;
}

/** Desloca a competência "YYYY-MM-01" em n meses. */
export function somarMeses(competencia: string, n: number) {
  const t = Number(competencia.slice(0, 4)) * 12 + Number(competencia.slice(5, 7)) - 1 + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}-01`;
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
/** "2026-10-01" → "outubro de 2026". */
export const nomeCompetencia = (c: string) => `${MESES[Number(c.slice(5, 7)) - 1]} de ${c.slice(0, 4)}`;

export type SituacaoDas = { tipo: "pago" } | { tipo: "vencido"; dias: number } | { tipo: "aberto"; dias: number };

/** Situação do DAS em relação a hoje ("YYYY-MM-DD"); null quando não há DAS. Vence hoje = aberto com 0 dias. */
export function situacaoDas(c: { status: StatusCiclo; dasVencimento: string | null }, hoje: string): SituacaoDas | null {
  if (c.status === "das_pago") return { tipo: "pago" };
  if (c.status !== "das_enviado" || !c.dasVencimento) return null;
  const dias = Math.round((Date.parse(c.dasVencimento) - Date.parse(hoje)) / 86_400_000);
  return dias < 0 ? { tipo: "vencido", dias: -dias } : { tipo: "aberto", dias };
}

export function textoSituacaoDas(s: SituacaoDas) {
  if (s.tipo === "pago") return "DAS pago";
  if (s.tipo === "vencido") return s.dias === 1 ? "Vencido há 1 dia" : `Vencido há ${s.dias} dias`;
  return s.dias === 0 ? "Vence hoje" : s.dias === 1 ? "Vence amanhã" : `Vence em ${s.dias} dias`;
}

/** Extensões aceitas no envio do cliente e o tipo MIME gravado no Storage. */
export const TIPOS_DOCUMENTO: Record<string, string> = {
  ofx: "application/x-ofx",
  csv: "text/csv",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};
export const MAX_DOCUMENTO = 10 * 1024 * 1024;
export const extensao = (nome: string) => (nome.includes(".") ? nome.toLowerCase().split(".").pop()! : "");
export const mimeDocumento = (nome: string) => TIPOS_DOCUMENTO[extensao(nome)] ?? null;

/** Nome seguro para o path do Storage (sem acento, barra ou espaço), mantendo a extensão. */
export function nomeParaPath(nome: string) {
  const limpo = nome.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "_").replace(/_+/g, "_");
  return limpo.slice(-80) || "arquivo";
}

export const fmtTamanho = (b: number) =>
  b < 1_000_000 ? `${Math.max(1, Math.round(b / 1000))} KB` : `${(b / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
/** "2026-10-01" → "Outubro de 2026" (títulos). */
export const tituloCompetencia = (c: string) => nomeCompetencia(c).replace(/^./, (l) => l.toUpperCase());
