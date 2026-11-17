/** Regras puras dos avisos automáticos por e-mail (o cron diário pergunta "o que mandar hoje?"). */
import { competenciaAtual, nomeCompetencia, type StatusCiclo } from "./ciclo";
import type { TipoNotificacao } from "@/db/schema";

export type TipoAviso = "pedido_extrato" | "lembrete_extrato" | "lembrete_das";
export type ConfigAvisos = {
  avisosAtivos: boolean;
  diaPedidoExtrato: number;
  lembretesExtratoDias: number[];
  diasAntesVencimentoDas: number[];
};
export type CicloAviso = {
  competencia: string;
  status: StatusCiclo;
  dasVencimento: string | null;
  extratoSolicitadoEm: Date | string | null;
};
export type Aviso = { tipo: TipoAviso; competencia: string; dataRef: string };

export const DIA_PEDIDO = { min: 1, max: 28 };
export const LEMBRETE_EXTRATO = { min: 1, max: 27 };
export const ANTES_DAS = { min: 0, max: 15 };

const ultimoDiaDoMes = (d: string) => new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0)).getUTCDate();
export const diasEntre = (de: string, ate: string) => Math.round((Date.parse(ate) - Date.parse(de)) / 86_400_000);

/**
 * Avisos que saem hoje ("YYYY-MM-DD" em São Paulo). `ciclos` traz o ciclo da competência atual (se existir) e os ciclos com DAS em aberto.
 * Dia do cron perdido não é recuperado, exceto o pedido: se passou do dia e ninguém pediu ainda nesta competência, pede hoje.
 */
export function avisosDoDia({ hoje, config, ciclos, membrosAtivos }: {
  hoje: string; config: ConfigAvisos; ciclos: CicloAviso[]; membrosAtivos: number;
}): Aviso[] {
  if (!config.avisosAtivos || membrosAtivos === 0) return [];
  const avisos: Aviso[] = [];
  const dia = Number(hoje.slice(8, 10));
  const fim = ultimoDiaDoMes(hoje);
  const competencia = competenciaAtual(hoje);
  const atual = ciclos.find((c) => c.competencia === competencia);
  const aguardando = !atual || atual.status === "aguardando_extrato";

  if (aguardando) {
    if (dia >= Math.min(config.diaPedidoExtrato, fim) && !atual?.extratoSolicitadoEm) {
      avisos.push({ tipo: "pedido_extrato", competencia, dataRef: hoje });
    } else if (config.lembretesExtratoDias.some((d) => Math.min(config.diaPedidoExtrato + d, fim) === dia)) {
      avisos.push({ tipo: "lembrete_extrato", competencia, dataRef: hoje });
    }
  }

  for (const c of ciclos) {
    if (c.status !== "das_enviado" || !c.dasVencimento) continue;
    const faltam = diasEntre(hoje, c.dasVencimento);
    if (config.diasAntesVencimentoDas.includes(faltam) || faltam === -1) {
      avisos.push({ tipo: "lembrete_das", competencia: c.competencia, dataRef: hoje });
    }
  }
  return avisos;
}

/** "5", "5 e 10", "5, 10 e 15". */
export const listaPtBR = (itens: (string | number)[]) =>
  itens.length <= 1 ? itens.join("") : `${itens.slice(0, -1).join(", ")} e ${itens.at(-1)}`;

const ordenar = (xs: number[]) => [...new Set(xs)].sort((a, b) => a - b);

/** Padrão das colunas em empresas (schema): dia 1, lembretes +4 e +9, DAS 3 dias antes e no dia. */
export const PADRAO_AVISOS: Omit<ConfigAvisos, "avisosAtivos"> = { diaPedidoExtrato: 1, lembretesExtratoDias: [4, 9], diasAntesVencimentoDas: [3, 0] };

export type EtapaAviso = { quando: string; texto: string; tipo: TipoAviso };

/** Linha do tempo do mês em português, para o contador conferir antes de ligar. */
export function etapasAvisos(config: Omit<ConfigAvisos, "avisosAtivos">, hoje: string): EtapaAviso[] {
  const fim = ultimoDiaDoMes(hoje);
  const mes = nomeCompetencia(competenciaAtual(hoje)).split(" ")[0];
  const etapas: EtapaAviso[] = [{ quando: `Dia ${config.diaPedidoExtrato}`, texto: `pedimos os extratos de ${mes}`, tipo: "pedido_extrato" }];
  const lembretes = ordenar(config.lembretesExtratoDias.map((d) => Math.min(config.diaPedidoExtrato + d, fim)));
  if (lembretes.length) {
    etapas.push({ quando: `${lembretes.length === 1 ? "Dia" : "Dias"} ${listaPtBR(lembretes)}`, texto: "lembramos se ainda não enviou", tipo: "lembrete_extrato" });
  }
  const antes = ordenar(config.diasAntesVencimentoDas)
    .reverse()
    .map((d) => (d === 0 ? "no dia do vencimento" : d === 1 ? "1 dia antes" : `${d} dias antes`));
  etapas.push(
    antes.length
      ? { quando: listaPtBR(antes).replace(/^./, (l) => l.toUpperCase()), texto: "lembramos o DAS (e no dia seguinte, se não foi pago)", tipo: "lembrete_das" }
      : { quando: "Dia seguinte ao vencimento", texto: "avisamos se o DAS não foi pago", tipo: "lembrete_das" },
  );
  return etapas;
}

/** Próxima data ("YYYY-MM-DD") do pedido do extrato: este mês se o dia ainda não chegou, senão no seguinte. */
export function proximoPedido(hoje: string, dia: number) {
  const [ano, mes] = [Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7))];
  const [a, m] = Number(hoje.slice(8, 10)) < dia ? [ano, mes] : mes === 12 ? [ano + 1, 1] : [ano, mes + 1];
  return `${a}-${String(m).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** Tipo de e-mail (tabela notificacoes) em português, para o histórico e a simulação. */
export const ROTULO_NOTIFICACAO: Record<TipoNotificacao, string> = {
  convite: "Convite",
  pedido_extrato: "Pedido de extrato",
  lembrete_extrato: "Lembrete de extrato",
  extrato_recebido: "Extrato recebido",
  extrato_por_fora: "Extrato por outro canal",
  das_disponivel: "DAS disponível",
  lembrete_das: "Lembrete do DAS",
  das_pago: "DAS pago pelo cliente",
  recuperacao_senha: "Recuperação de senha",
};
