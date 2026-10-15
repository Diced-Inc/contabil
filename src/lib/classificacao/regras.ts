import { fmtData, fmtValor, parseValorBR, somenteDigitos } from "@/lib/format";

export type TipoMatch = "memo_contem" | "documento" | "valor_exato";
export type Sinal = "entrada" | "saida" | "qualquer";
export type RegraLike = {
  id: string;
  tipoMatch: TipoMatch;
  padrao: string;
  sinal: Sinal;
  contaId: string;
  historicoTemplate: string;
  prioridade: number;
  ativa: boolean;
  createdAt: Date;
};
export type TransacaoLike = { memo: string; valor: string; data: string };

export const TIPOS_MATCH: Record<TipoMatch, string> = {
  memo_contem: "Memo contém",
  documento: "Documento (CPF/CNPJ)",
  valor_exato: "Valor exato",
};
export const SINAIS: Record<Sinal, string> = { entrada: "Entrada", saida: "Saída", qualquer: "Qualquer" };

/** Padrão de valor_exato ("1.500,00" ou "1500.00") em número; NaN se inválido. */
export const valorDoPadrao = (padrao: string) => Number(parseValorBR(padrao));

export function casaRegra(r: RegraLike, t: TransacaoLike): boolean {
  if (!r.ativa) return false;
  const v = Number(t.valor);
  if (r.sinal === "entrada" && v <= 0) return false;
  if (r.sinal === "saida" && v >= 0) return false;
  switch (r.tipoMatch) {
    case "memo_contem":
      return t.memo.toLowerCase().includes(r.padrao.toLowerCase());
    case "documento": {
      const doc = somenteDigitos(r.padrao);
      return doc !== "" && somenteDigitos(t.memo).includes(doc);
    }
    case "valor_exato":
      return Math.abs(v).toFixed(2) === valorDoPadrao(r.padrao).toFixed(2);
  }
}

/** Substitui {memo}, {valor} (absoluto, pt-BR) e {data} (dd/mm/aaaa). */
export function aplicarTemplate(tpl: string, t: TransacaoLike) {
  const vals = { memo: t.memo, valor: fmtValor(Math.abs(Number(t.valor))), data: fmtData(t.data) };
  return tpl.replace(/\{(memo|valor|data)\}/g, (_, k: keyof typeof vals) => vals[k]);
}

/** Primeira regra que casa, na ordem prioridade asc, createdAt asc. */
export function primeiraRegra<R extends RegraLike>(regras: R[], t: TransacaoLike): R | null {
  const ordenadas = [...regras].sort((a, b) => a.prioridade - b.prioridade || a.createdAt.getTime() - b.createdAt.getTime());
  return ordenadas.find((r) => casaRegra(r, t)) ?? null;
}
