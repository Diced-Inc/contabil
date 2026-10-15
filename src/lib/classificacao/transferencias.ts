export type TxCand = { id: string; contaBancariaId: string; data: string; valor: string };

const utc = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const dias = (a: string, b: string) => Math.abs(utc(a) - utc(b)) / 86400000;
const centavos = (v: string) => Math.round(Number(v) * 100);

/** Pares [saída, entrada] entre contas diferentes, mesmo valor invertido, até 2 dias. Cada transação entra em no máximo um par. */
export function parearTransferencias(txs: TxCand[]): Array<[string, string]> {
  const usados = new Set<string>();
  const pares: Array<[string, string]> = [];
  const entradas = txs.filter((t) => centavos(t.valor) > 0);
  for (const s of txs) {
    const v = centavos(s.valor);
    if (v >= 0) continue;
    const e = entradas.find((x) => !usados.has(x.id) && x.contaBancariaId !== s.contaBancariaId
      && centavos(x.valor) === -v && dias(x.data, s.data) <= 2);
    if (e) { usados.add(e.id); pares.push([s.id, e.id]); }
  }
  return pares;
}
