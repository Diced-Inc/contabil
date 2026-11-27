import type { ExemploIA } from "./ia";

/** Memo para comparação: sem acento, minúsculo, sem dígitos (datas, CNPJ, ids), só palavras de 2+ letras. */
export function normalizarMemo(memo: string): string[] {
  return memo
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\d+/g, " ")
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 2);
}

const positivo = (valor: string) => Number(valor) > 0;

function jaccard(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Few-shot por semelhança: para cada transação do lote, os `porAlvo` exemplos mais parecidos (Jaccard das palavras;
 * sinal diferente vale metade), em rodízio entre as transações, mais `recentes` dos mais novos, até `max`.
 * `pool` vem do mais recente para o mais antigo; exemplos repetidos (mesmo memo normalizado, sinal e conta) contam uma vez.
 */
export function selecionarExemplos(
  pool: ExemploIA[], alvos: { memo: string; valor: string }[],
  { porAlvo = 4, recentes = 5, max = 40 }: { porAlvo?: number; recentes?: number; max?: number } = {},
): ExemploIA[] {
  const vistos = new Set<string>();
  const unicos = pool.flatMap((e) => {
    const palavras = normalizarMemo(e.memo);
    const chave = `${palavras.join(" ")}|${positivo(e.valor)}|${e.contaCodigo}`;
    if (vistos.has(chave)) return [];
    vistos.add(chave);
    return [{ e, palavras: new Set(palavras), positivo: positivo(e.valor) }];
  });

  const rankings = alvos.map((t) => {
    const p = new Set(normalizarMemo(t.memo)), pos = positivo(t.valor);
    return unicos
      .map((u, i) => ({ i, s: jaccard(p, u.palavras) * (u.positivo === pos ? 1 : 0.5) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .slice(0, porAlvo);
  });

  const escolhidos = new Set<number>();
  const limiteSemelhantes = Math.max(0, max - recentes);
  for (let r = 0; r < porAlvo && escolhidos.size < limiteSemelhantes; r++)
    for (const rk of rankings) {
      if (escolhidos.size >= limiteSemelhantes) break;
      if (rk[r]) escolhidos.add(rk[r].i);
    }
  for (let i = 0, n = 0; i < unicos.length && n < recentes && escolhidos.size < max; i++)
    if (!escolhidos.has(i)) { escolhidos.add(i); n++; }

  return [...escolhidos].sort((a, b) => a - b).map((i) => unicos[i].e);
}
