/** Regras puras do ciclo mensal com o cliente (competência, transições de status, guias). */
// das_enviado = guias enviadas ao cliente; das_pago = todas as guias enviadas pagas (nomes antigos do enum, de quando era um DAS só).
export type StatusCiclo = "aguardando_extrato" | "extrato_recebido" | "em_processamento" | "das_enviado" | "das_pago" | "encerrado";
export type EventoCiclo =
  | "extrato_enviado" | "extrato_por_fora" | "processar" | "editar_guia" | "concluir" | "pagar" | "encerrar" | "reabrir";

/** encerrado fica no fim: conta como "passou de tudo" (progresso completo, sem envio nem guia em aberto). */
export const ORDEM_STATUS: StatusCiclo[] = ["aguardando_extrato", "extrato_recebido", "em_processamento", "das_enviado", "das_pago", "encerrado"];

/** Texto para o cliente (portal) e rótulo curto para o contador. */
export const STATUS_CICLO: Record<
  StatusCiclo,
  { cliente: string; rotulo: string; badge: "warning" | "info" | "violet" | "brand" | "success" | "muted" }
> = {
  aguardando_extrato: { cliente: "Estamos esperando os extratos do mês.", rotulo: "Aguardando extrato", badge: "warning" },
  extrato_recebido: { cliente: "Recebemos seus arquivos. Em breve o contador começa o fechamento.", rotulo: "Extrato recebido", badge: "info" },
  em_processamento: { cliente: "O contador está fechando o mês.", rotulo: "Em processamento", badge: "violet" },
  das_enviado: { cliente: "O mês foi concluído e as guias estão disponíveis.", rotulo: "Guias enviadas", badge: "brand" },
  das_pago: { cliente: "Tudo certo: as guias do mês estão pagas.", rotulo: "Guias pagas", badge: "success" },
  encerrado: { cliente: "Mês encerrado pelo contador. Não há nada pendente.", rotulo: "Encerrado", badge: "muted" },
};

export type MotivoEncerramento = "resolvido_fora" | "sem_movimento" | "sem_imposto" | "outro";
/** Rótulo no formulário do contador e frase para o cliente no portal. */
export const MOTIVOS_ENCERRAMENTO: Record<MotivoEncerramento, { rotulo: string; cliente: string }> = {
  resolvido_fora: { rotulo: "Resolvido por fora (WhatsApp, e-mail…)", cliente: "Já foi resolvido com o contador por outro canal." },
  sem_movimento: { rotulo: "Sem movimento no mês", cliente: "A empresa não teve movimento neste mês." },
  sem_imposto: { rotulo: "Sem imposto a pagar", cliente: "Não há imposto a pagar neste mês." },
  outro: { rotulo: "Outro", cliente: "O contador encerrou o mês sem guias." },
};

/** Para cada evento, de onde pode partir e para onde vai (ausente = transição inválida). */
const TRANSICOES: Record<EventoCiclo, Partial<Record<StatusCiclo, StatusCiclo>>> = {
  // Cliente pode mandar mais arquivos enquanto o mês não foi concluído.
  extrato_enviado: {
    aguardando_extrato: "extrato_recebido",
    extrato_recebido: "extrato_recebido",
    em_processamento: "em_processamento",
  },
  // Cliente avisa que mandou os extratos por WhatsApp/e-mail: só enquanto o mês espera os extratos.
  extrato_por_fora: { aguardando_extrato: "extrato_recebido" },
  // Contador importa/marca um documento: inicia o processamento; depois das guias não mexe no status.
  processar: {
    aguardando_extrato: "em_processamento",
    extrato_recebido: "em_processamento",
    em_processamento: "em_processamento",
    das_enviado: "das_enviado",
    das_pago: "das_pago",
    encerrado: "encerrado",
  },
  // Anexar/editar/remover guia não mexe no status (rascunho é invisível ao cliente: o pedido do extrato continua); encerrado trava.
  editar_guia: {
    aguardando_extrato: "aguardando_extrato",
    extrato_recebido: "extrato_recebido",
    em_processamento: "em_processamento",
    das_enviado: "das_enviado",
    das_pago: "das_pago",
  },
  // Enviar guias ao cliente. Depois do envio, uma guia nova também sai por aqui (e o mês volta a ter guia em aberto).
  concluir: {
    aguardando_extrato: "das_enviado",
    extrato_recebido: "das_enviado",
    em_processamento: "das_enviado",
    das_enviado: "das_enviado",
    das_pago: "das_enviado",
  },
  // Pagar uma guia; statusPelasGuias decide se o mês fica pago.
  pagar: { das_enviado: "das_enviado" },
  // Encerrar sem guias: de qualquer ponto antes do pagamento.
  encerrar: {
    aguardando_extrato: "encerrado",
    extrato_recebido: "encerrado",
    em_processamento: "encerrado",
    das_enviado: "encerrado",
  },
  reabrir: { das_enviado: "em_processamento", das_pago: "em_processamento", encerrado: "em_processamento" },
};

const MOTIVO: Record<EventoCiclo, string> = {
  extrato_enviado: "O mês já foi concluído. Fale com o contador para enviar mais arquivos.",
  extrato_por_fora: "O contador já está com os extratos deste mês.",
  processar: "Status do ciclo inválido.",
  editar_guia: "O mês foi encerrado. Reabra para mexer nas guias.",
  concluir: "O mês foi encerrado. Reabra o ciclo para enviar guias.",
  pagar: "Não há guia em aberto neste mês.",
  encerrar: "Este mês já foi pago ou encerrado.",
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

/**
 * Status depois de mexer nas guias de um mês já enviado: das_pago quando todas as guias enviadas estão pagas, senão das_enviado.
 * Rascunhos (sem enviado_em) não contam: o cliente ainda não os vê. Outros status não mudam por aqui.
 */
export function statusPelasGuias(status: StatusCiclo, guias: { enviadoEm: Date | string | null; pagoEm: Date | string | null }[]): StatusCiclo {
  if (status !== "das_enviado" && status !== "das_pago") return status;
  const enviadas = guias.filter((g) => g.enviadoEm);
  return enviadas.length > 0 && enviadas.every((g) => g.pagoEm) ? "das_pago" : "das_enviado";
}

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
