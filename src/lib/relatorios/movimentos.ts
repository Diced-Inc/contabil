import { cents, fromCents } from "@/lib/format";

type Mov = { lancamentoId: string; estornoDeId: string | null; debito: string; credito: string };

/** Saldo corrente (D − C) a partir do saldo anterior, totais e saldo final. Sem acesso a banco (serve ao cliente). */
export function correr<M extends Mov>(movs: M[], saldoAnterior: string) {
  let s = cents(saldoAnterior), d = 0, c = 0;
  const movimentos = movs.map((m) => {
    d += cents(m.debito);
    c += cents(m.credito);
    s += cents(m.debito) - cents(m.credito);
    return { ...m, saldo: fromCents(s) };
  });
  return { movimentos, totais: { debitos: fromCents(d), creditos: fromCents(c) }, saldoFinal: fromCents(s) };
}

/** Tira os pares lançamento estornado + estorno quando os dois estão na lista (somam zero, o saldo final não muda). */
export function semEstornos<M extends Mov>(movs: M[]) {
  const ids = new Set(movs.map((m) => m.lancamentoId));
  const pares = new Set(movs.flatMap((m) => (m.estornoDeId && ids.has(m.estornoDeId) ? [m.estornoDeId] : [])));
  return movs.filter((m) => !pares.has(m.lancamentoId) && !(m.estornoDeId && pares.has(m.estornoDeId)));
}
