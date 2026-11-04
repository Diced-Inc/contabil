// Puro e isomórfico (roda no navegador para a prévia do mapeamento): Uint8Array + TextDecoder, sem node:*.

export type Separador = ";" | "," | "\t";
export type Encoding = "utf8" | "latin1";
export type FormatoData = "DMY" | "YMD" | "MDY";

export type DeteccaoCsv = {
  encoding: Encoding;
  separador: Separador;
  /** Índice (0-based) da linha de cabeçalho; -1 quando o arquivo não tem cabeçalho. */
  linhaCabecalho: number;
  colunas: string[];
  amostra: string[][];
};

export type MapeamentoCsv = {
  linhaCabecalho: number;
  separador: Separador;
  encoding: Encoding;
  data: number;
  historico: number[];
  valor?: number;
  debito?: number;
  credito?: number;
  saldo?: number;
  formatoData: FormatoData;
  sinalInvertido?: boolean;
};

export type LinhaExtrato = { data: string; valor: string; memo: string; saldoApos?: string };
export type ExtratoCsv = {
  transacoes: LinhaExtrato[];
  saldoFinal?: string;
  dataSaldo?: string;
  dtStart: string | null;
  dtEnd: string | null;
};

const SEPARADORES: Separador[] = [";", ",", "\t"];
const PALAVRAS_CABECALHO = /data|valor|hist|descri/i;
const temBom = (b: Uint8Array) => b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf;

function decodificar(buf: Uint8Array): { texto: string; encoding: Encoding } {
  try {
    return { texto: new TextDecoder("utf-8", { fatal: true }).decode(temBom(buf) ? buf.subarray(3) : buf), encoding: "utf8" };
  } catch {
    // Byte inválido em UTF-8: é Windows-1252/latin1 (o padrão dos bancos brasileiros).
    return { texto: new TextDecoder("windows-1252").decode(buf), encoding: "latin1" };
  }
}

const texto = (buf: Uint8Array, encoding: Encoding) =>
  encoding === "utf8" ? new TextDecoder("utf-8").decode(temBom(buf) ? buf.subarray(3) : buf) : new TextDecoder("windows-1252").decode(buf);

/** Divide uma linha respeitando aspas ("a;b" e "" como aspas literais). */
export function dividir(linha: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "", aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (aspas) {
      if (c === '"' && linha[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') aspas = false;
      else cur += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const linhasDe = (t: string) => t.split(/\r?\n/);
const vazia = (l: string) => l.trim() === "";

function moda(ns: number[]): number {
  const cont = new Map<number, number>();
  let melhor = 0, freq = 0;
  for (const n of ns) {
    const f = (cont.get(n) ?? 0) + 1;
    cont.set(n, f);
    if (f > freq) { melhor = n; freq = f; }
  }
  return melhor;
}

export function detectarCsv(buf: Uint8Array): DeteccaoCsv {
  const { texto: t, encoding } = decodificar(buf);
  const linhas = linhasDe(t);
  const naoVazias = linhas.filter((l) => !vazia(l));
  // Separador: o que deixa mais linhas com a mesma quantidade (>1) de células.
  let separador: Separador = ";", melhor = -1;
  for (const sep of SEPARADORES) {
    const contagens = naoVazias.map((l) => dividir(l, sep).length);
    const m = moda(contagens);
    const score = m > 1 ? contagens.filter((c) => c === m).length : 0;
    if (score > melhor) { melhor = score; separador = sep; }
  }
  const cel = linhas.map((l) => (vazia(l) ? 0 : dividir(l, separador).length));
  let linhaCabecalho = -1;
  for (let i = 0; i < linhas.length; i++) {
    if (cel[i] < 2 || !PALAVRAS_CABECALHO.test(linhas[i])) continue;
    const seguintes = cel.slice(i + 1).filter((c) => c > 0);
    if (seguintes.length && moda(seguintes) === cel[i]) { linhaCabecalho = i; break; }
  }
  let colunas: string[];
  let inicio: number;
  if (linhaCabecalho >= 0) {
    colunas = dividir(linhas[linhaCabecalho], separador).map((c) => c.trim());
    inicio = linhaCabecalho + 1;
  } else {
    // Sem cabeçalho reconhecível: dados começam na primeira linha com a contagem modal.
    const m = moda(cel.filter((c) => c > 0));
    inicio = Math.max(0, cel.indexOf(m));
    linhaCabecalho = inicio - 1;
    colunas = Array.from({ length: m }, (_, i) => `Coluna ${i + 1}`);
  }
  const amostra = linhas
    .slice(inicio)
    .filter((l) => !vazia(l))
    .map((l) => dividir(l, separador).map((c) => c.trim()))
    .filter((r) => r.length === colunas.length)
    .slice(0, 10);
  return { encoding, separador, linhaCabecalho, colunas, amostra };
}

/** Palpite inicial de papéis pelas palavras do cabeçalho e formato de data pela amostra. */
export function sugerirMapeamento(d: DeteccaoCsv): MapeamentoCsv {
  const m: MapeamentoCsv = {
    linhaCabecalho: d.linhaCabecalho, separador: d.separador, encoding: d.encoding,
    data: -1, historico: [], formatoData: "DMY",
  };
  d.colunas.forEach((nome, i) => {
    const n = nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    if (/data/.test(n)) { if (m.data < 0) m.data = i; }
    else if (/saldo/.test(n)) m.saldo ??= i;
    else if (/debito|saida/.test(n)) m.debito ??= i;
    else if (/credito|entrada/.test(n)) m.credito ??= i;
    else if (/valor|montante|quantia/.test(n)) m.valor ??= i;
    else if (/hist|descri|lancamento|memo|detalhe|favorecido/.test(n)) m.historico.push(i);
  });
  if (m.data < 0) m.data = 0;
  const datas = d.amostra.map((r) => r[m.data] ?? "");
  if (datas.some((s) => /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(s))) m.formatoData = "YMD";
  else if (datas.some((s) => Number(s.split(/[-/.]/)[1]) > 12)) m.formatoData = "MDY";
  return m;
}

/** Valor BR ou não: "1.000,00", "-200,00", "(200,00)", "R$ 1.000,00", "1000.00", "200,00 D", "200,00-". */
export function parseValor(s: string): string | null {
  let t = s.replace(/\s|R\$/gi, "");
  if (!t) return null;
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  if (/D$/i.test(t)) { neg = true; t = t.slice(0, -1); }
  else if (/C$/i.test(t)) t = t.slice(0, -1);
  if (t.endsWith("-")) { neg = true; t = t.slice(0, -1); }
  if (t.startsWith("-")) { neg = !neg; t = t.slice(1); }
  else if (t.startsWith("+")) t = t.slice(1);
  // Vírgula = decimal BR; só pontos em grupos de 3 ("1.000") = milhar; senão o ponto é decimal.
  const norm = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, "") : t;
  if (!/^\d+(\.\d+)?$/.test(norm)) return null;
  const n = Number(norm);
  return (neg && n !== 0 ? -n : n).toFixed(2);
}

export function parseData(s: string, f: FormatoData): string | null {
  const p = s.trim().split(/[\sT]/)[0].split(/[-/.]/);
  if (p.length !== 3) return null;
  const [a0, m, d] = f === "YMD" ? p : f === "DMY" ? [p[2], p[1], p[0]] : [p[2], p[0], p[1]];
  const a = a0.length === 2 ? "20" + a0 : a0;
  if (!/^\d{4}$/.test(a) || !/^\d{1,2}$/.test(m) || !/^\d{1,2}$/.test(d)) return null;
  const iso = `${a}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  const dt = new Date(iso + "T00:00:00Z");
  return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === iso ? iso : null;
}

const limpar = (s: string) => s.replace(/\s+/g, " ").trim();

/** Linhas sem data válida ou sem valor (saldo anterior, totais, rodapé) são puladas. */
export function parseCsv(buf: Uint8Array, mp: MapeamentoCsv): ExtratoCsv {
  if (mp.valor === undefined && mp.debito === undefined && mp.credito === undefined) {
    throw new Error("Escolha a coluna de valor (ou débito/crédito)");
  }
  const linhas = linhasDe(texto(buf, mp.encoding)).slice(mp.linhaCabecalho + 1);
  const transacoes: LinhaExtrato[] = [];
  for (const l of linhas) {
    if (vazia(l)) continue;
    const c = dividir(l, mp.separador);
    const data = parseData(c[mp.data] ?? "", mp.formatoData);
    if (!data) continue;
    let valor: string | null;
    if (mp.valor !== undefined) valor = parseValor(c[mp.valor] ?? "");
    else {
      const d = mp.debito !== undefined ? parseValor(c[mp.debito] ?? "") : null;
      const cr = mp.credito !== undefined ? parseValor(c[mp.credito] ?? "") : null;
      valor = d === null && cr === null ? null : (Math.abs(Number(cr ?? 0)) - Math.abs(Number(d ?? 0))).toFixed(2);
    }
    if (valor === null) continue;
    if (mp.sinalInvertido && Number(valor) !== 0) valor = (-Number(valor)).toFixed(2);
    const memo = mp.historico.map((i) => limpar(c[i] ?? "")).filter(Boolean).join(" - ");
    const saldo = mp.saldo !== undefined ? parseValor(c[mp.saldo] ?? "") : null;
    transacoes.push({ data, valor, memo, ...(saldo !== null && { saldoApos: saldo }) });
  }
  const datas = transacoes.map((t) => t.data);
  const dtStart = datas.length ? datas.reduce((a, b) => (b < a ? b : a)) : null;
  const dtEnd = datas.length ? datas.reduce((a, b) => (b > a ? b : a)) : null;
  // Saldo final: o da linha mais recente. Empate na data: arquivo decrescente vale a primeira; crescente, a última.
  const comSaldo = transacoes.filter((t) => t.saldoApos !== undefined && t.data === dtEnd);
  const decrescente = transacoes.length > 1 && transacoes[0].data > transacoes[transacoes.length - 1].data;
  const ult = decrescente ? comSaldo[0] : comSaldo[comSaldo.length - 1];
  return { transacoes, dtStart, dtEnd, ...(ult && { saldoFinal: ult.saldoApos, dataSaldo: ult.data }) };
}
