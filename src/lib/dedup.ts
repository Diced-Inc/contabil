import { createHash } from "node:crypto";

/**
 * Chave de deduplicação para extratos sem FITID (CSV/PDF): prefixo + sha1(data|valor|memo normalizado).
 * Chave repetida no mesmo arquivo ganha #2, #3... na ordem do arquivo (igual ao FITID repetido do OFX).
 */
export function atribuirFitids<T extends { data: string; valor: string; memo: string }>(prefixo: "csv" | "pdf", linhas: T[]) {
  const vistos = new Map<string, number>();
  return linhas.map((t) => {
    const memo = t.memo.replace(/\s+/g, " ").trim().toLowerCase();
    const base = `${prefixo}:${createHash("sha1").update(`${t.data}|${Number(t.valor).toFixed(2)}|${memo}`).digest("hex")}`;
    const n = (vistos.get(base) ?? 0) + 1;
    vistos.set(base, n);
    return { ...t, fitid: n === 1 ? base : `${base}#${n}` };
  });
}
