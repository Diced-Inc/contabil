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

/** Resumo em português do que a configuração faz, para o contador conferir antes de ligar. */
export function textoAvisos(config: Omit<ConfigAvisos, "avisosAtivos">, hoje: string) {
  const fim = ultimoDiaDoMes(hoje);
  const mes = nomeCompetencia(competenciaAtual(hoje)).split(" ")[0];
  const partes = [`Dia ${config.diaPedidoExtrato} pedimos os extratos de ${mes}`];
  const lembretes = ordenar(config.lembretesExtratoDias.map((d) => Math.min(config.diaPedidoExtrato + d, fim)));
  if (lembretes.length) partes.push(`lembramos ${lembretes.length === 1 ? "no dia" : "nos dias"} ${listaPtBR(lembretes)}`);
  const antes = ordenar(config.diasAntesVencimentoDas)
    .reverse()
    .map((d) => (d === 0 ? "no dia do vencimento" : d === 1 ? "1 dia antes" : `${d} dias antes`));
  partes.push(`avisamos do DAS ${listaPtBR([...antes, "no dia seguinte se não for pago"])}`);
  return partes.join("; ");
}

/** Tipo de e-mail (tabela notificacoes) em português, para o histórico e a simulação. */
export const ROTULO_NOTIFICACAO: Record<TipoNotificacao, string> = {
  convite: "Convite",
  pedido_extrato: "Pedido de extrato",
  lembrete_extrato: "Lembrete de extrato",
  extrato_recebido: "Extrato recebido",
  das_disponivel: "DAS disponível",
  lembrete_das: "Lembrete do DAS",
  recuperacao_senha: "Recuperação de senha",
};
