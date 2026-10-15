import { cents, fromCents } from "./format";
import type { LinhaSaldo } from "./relatorios/saldos";

export type SaldoConta = { id: string; codigo: string; saldo: string }; // saldo = D − C
export type PartidaApuracao = { contaId: string; debito?: string; credito?: string };

/** Saldo acumulado (não o movimento do ano) das analíticas de resultado: a apuração zera esse saldo. */
export const saldosDeResultado = (linhas: LinhaSaldo[]): SaldoConta[] =>
  linhas
    .filter((l) => l.tipo === "analitica" && /^3(\.|$)/.test(l.codigo))
    .map((l) => ({ id: l.id, codigo: l.codigo, saldo: l.saldoAtual }));

/** Zera contas de resultado (classe 3). Lucro (Σ saldo < 0) → crédito em lucros; prejuízo → débito em prejuízos. */
export function partidasApuracao(
  resultado: SaldoConta[], lucrosId: string, prejuizosId: string,
): { partidas: PartidaApuracao[]; resultado: string } {
  const partidas: PartidaApuracao[] = [];
  let total = 0;
  for (const c of resultado.filter((c) => c.codigo.startsWith("3"))) {
    const s = cents(c.saldo);
    if (s === 0) continue;
    total += s;
    partidas.push(s > 0 ? { contaId: c.id, credito: fromCents(s) } : { contaId: c.id, debito: fromCents(-s) });
  }
  if (partidas.length === 0) return { partidas: [], resultado: "0.00" };
  const lucro = -total; // saldo credor líquido = lucro
  if (lucro !== 0) {
    partidas.push(lucro > 0 ? { contaId: lucrosId, credito: fromCents(lucro) } : { contaId: prejuizosId, debito: fromCents(-lucro) });
  }
  return { partidas, resultado: fromCents(lucro) };
}
