/** Regras puras das guias de imposto do mês (DAS, DARF previdenciário, DARF de impostos...). */
import { listaPtBR } from "./avisos";

export const TIPOS_GUIA = ["das", "das_mei", "darf_previdenciario", "darf_impostos", "outra"] as const;
export type TipoGuia = (typeof TIPOS_GUIA)[number];
export type Regime = "simples" | "mei" | "presumido" | "real";

/** Nome para o usuário e prefixo do arquivo baixado. */
const TIPO: Record<TipoGuia, { nome: string; arquivo: string }> = {
  das: { nome: "DAS", arquivo: "DAS" },
  das_mei: { nome: "DAS-MEI", arquivo: "DAS-MEI" },
  darf_previdenciario: { nome: "DARF previdenciário (INSS)", arquivo: "DARF-INSS" },
  darf_impostos: { nome: "DARF de impostos", arquivo: "DARF" },
  outra: { nome: "Outra guia", arquivo: "Guia" },
};

export const nomeTipoGuia = (t: TipoGuia) => TIPO[t].nome;
/** Rótulo de uma guia: a descrição do contador, se houver; senão o nome do tipo. */
export const rotuloGuia = (g: { tipo: TipoGuia; descricao: string | null }) => g.descricao || TIPO[g.tipo].nome;
/** "DARF-INSS-2026-10.pdf". */
export const arquivoGuia = (t: TipoGuia, competencia: string) => `${TIPO[t].arquivo}-${competencia.slice(0, 7)}.pdf`;

/** Guias que a empresa paga todo mês, pelo regime e pelo pró-labore. */
export function guiasEsperadas({ regime, temProLabore }: { regime: Regime; temProLabore: boolean }): TipoGuia[] {
  if (regime === "mei") return ["das_mei"];
  const impostos: TipoGuia = regime === "simples" ? "das" : "darf_impostos";
  return temProLabore ? [impostos, "darf_previdenciario"] : [impostos];
}

/** Esperadas que ainda não têm guia anexada. */
export const guiasFaltando = (esperadas: TipoGuia[], anexadas: { tipo: TipoGuia }[]) =>
  esperadas.filter((t) => !anexadas.some((g) => g.tipo === t));

/** "DAS e DARF previdenciário (INSS)". */
export const listaTipos = (tipos: TipoGuia[]) => listaPtBR(tipos.map(nomeTipoGuia));

/** Tipo lido do PDF (lerGuia) no vocabulário do sistema; null quando o leitor não reconheceu. */
export function tipoDetectado(lido: { tipo: "DAS" | "DARF" | null; previdenciario?: boolean }, regime: Regime): TipoGuia | null {
  if (lido.tipo === "DAS") return regime === "mei" ? "das_mei" : "das";
  if (lido.tipo === "DARF") return lido.previdenciario ? "darf_previdenciario" : "darf_impostos";
  return null;
}

export type SituacaoGuia = { tipo: "paga" } | { tipo: "vencida"; dias: number } | { tipo: "aberta"; dias: number };

const dias = (de: string, ate: string) => Math.round((Date.parse(ate) - Date.parse(de)) / 86_400_000);

/** Situação em relação a hoje ("YYYY-MM-DD"). Vence hoje = aberta com 0 dias. */
export function situacaoGuia(g: { vencimento: string; pagoEm: Date | string | null }, hoje: string): SituacaoGuia {
  if (g.pagoEm) return { tipo: "paga" };
  const d = dias(hoje, g.vencimento);
  return d < 0 ? { tipo: "vencida", dias: -d } : { tipo: "aberta", dias: d };
}

export function textoSituacao(s: SituacaoGuia) {
  if (s.tipo === "paga") return "Paga";
  if (s.tipo === "vencida") return s.dias === 1 ? "Vencida há 1 dia" : `Vencida há ${s.dias} dias`;
  return s.dias === 0 ? "Vence hoje" : s.dias === 1 ? "Vence amanhã" : `Vence em ${s.dias} dias`;
}

type GuiaResumo = { valor: string; vencimento: string; pagoEm: Date | string | null };

/** Contagem por guia e totais (em centavos para não acumular erro de ponto flutuante). */
export function resumoGuias(gs: GuiaResumo[], hoje: string) {
  const sit = gs.map((g) => situacaoGuia(g, hoje));
  const centavos = (f: (i: number) => boolean) => gs.reduce((s, g, i) => (f(i) ? s + Math.round(Number(g.valor) * 100) : s), 0) / 100;
  return {
    qtd: gs.length,
    abertas: sit.filter((s) => s.tipo === "aberta").length,
    vencidas: sit.filter((s) => s.tipo === "vencida").length,
    pagas: sit.filter((s) => s.tipo === "paga").length,
    total: centavos(() => true),
    emAberto: centavos((i) => sit[i].tipo !== "paga"),
  };
}

/** Guias em aberto, do vencimento mais próximo ao mais distante. */
export const emAberto = <T extends GuiaResumo>(gs: T[]) => gs.filter((g) => !g.pagoEm).sort((a, b) => a.vencimento.localeCompare(b.vencimento));
