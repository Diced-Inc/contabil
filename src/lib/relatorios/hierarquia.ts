import { cents, fromCents } from "@/lib/format";
import type { LinhaSaldo } from "./saldos";

export const nivel = (codigo: string) => codigo.split(".").length;

/** Ordem de código por segmento numérico: "1.1.2" < "1.1.10". */
export function compararCodigo(a: string, b: string) {
  const x = a.split("."), y = b.split(".");
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = Number(x[i]) - Number(y[i]);
    if (d) return d;
  }
  return x.length - y.length;
}

const CAMPOS = ["saldoAnterior", "debitos", "creditos", "saldoAtual"] as const;

/** Sintéticas = soma das analíticas descendentes (por prefixo de código). Retorna ordenado por código. */
export function agregar(linhas: LinhaSaldo[]): LinhaSaldo[] {
  const ordenadas = [...linhas].sort((a, b) => compararCodigo(a.codigo, b.codigo));
  const analiticas = ordenadas.filter((l) => l.tipo === "analitica");
  // ponytail: O(sintéticas × analíticas); plano tem poucas centenas de contas.
  return ordenadas.map((l) => {
    if (l.tipo === "analitica") return l;
    const filhas = analiticas.filter((a) => a.codigo.startsWith(l.codigo + "."));
    const soma = Object.fromEntries(
      CAMPOS.map((c) => [c, fromCents(filhas.reduce((s, f) => s + cents(f[c]), 0))]),
    ) as Pick<LinhaSaldo, (typeof CAMPOS)[number]>;
    return { ...l, ...soma };
  });
}

export const comMovimento = (linhas: LinhaSaldo[]) => linhas.filter((l) => CAMPOS.some((c) => cents(l[c]) !== 0));
