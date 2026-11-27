/**
 * Leitor de XML mínimo e puro (roda no navegador e no vitest, sem DOMParser): elementos, atributos, texto, CDATA e
 * entidades; o prefixo de namespace (ns2:, nfse:) sai do nome. Basta para NF-e/NFS-e, que são XML gerado por máquina.
 */
export type No = { nome: string; attrs: Record<string, string>; filhos: No[]; texto: string };

const ENT: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
export const desescapar = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENT[e] ?? m));
const local = (n: string) => n.slice(n.indexOf(":") + 1);

export function lerXml(xml: string): No {
  const raiz: No = { nome: "#doc", attrs: {}, filhos: [], texto: "" };
  const pilha = [raiz];
  let i = 0;
  const topo = () => pilha[pilha.length - 1];
  while (i < xml.length) {
    const lt = xml.indexOf("<", i);
    if (lt === -1) break;
    if (lt > i) topo().texto += desescapar(xml.slice(i, lt));
    if (xml.startsWith("<!--", lt)) { i = fim(xml, "-->", lt) ; continue; }
    if (xml.startsWith("<![CDATA[", lt)) {
      const f = fim(xml, "]]>", lt);
      topo().texto += xml.slice(lt + 9, f - 3);
      i = f;
      continue;
    }
    if (xml.startsWith("<?", lt) || xml.startsWith("<!", lt)) { i = fim(xml, ">", lt); continue; }
    const gt = fimTag(xml, lt);
    const corpo = xml.slice(lt + 1, gt);
    i = gt + 1;
    if (corpo[0] === "/") {
      const nome = local(corpo.slice(1).trim());
      while (pilha.length > 1 && topo().nome !== nome) pilha.pop(); // tolera fechamento faltando
      if (pilha.length > 1) pilha.pop();
      continue;
    }
    const auto = corpo.endsWith("/");
    const m = /^([^\s/>]+)([\s\S]*?)\/?$/.exec(corpo);
    if (!m) throw new Error("XML inválido");
    const attrs: Record<string, string> = {};
    for (const a of m[2].matchAll(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) attrs[local(a[1])] = desescapar(a[3] ?? a[4] ?? "");
    const no: No = { nome: local(m[1]), attrs, filhos: [], texto: "" };
    topo().filhos.push(no);
    if (!auto) pilha.push(no);
  }
  if (!raiz.filhos.length) throw new Error("XML vazio ou inválido");
  return raiz;
}

const fim = (s: string, marca: string, de: number) => {
  const k = s.indexOf(marca, de);
  if (k === -1) throw new Error("XML inválido");
  return k + marca.length;
};
/** ">" que fecha a tag, fora de aspas de atributo. */
function fimTag(s: string, de: number) {
  let aspas = "";
  for (let k = de + 1; k < s.length; k++) {
    const c = s[k];
    if (aspas) { if (c === aspas) aspas = ""; } else if (c === '"' || c === "'") aspas = c;
    else if (c === ">") return k;
  }
  throw new Error("XML inválido");
}

/** Filho direto pelo caminho ("a", "b", "c"), ou undefined. */
export function no(n: No | undefined, ...caminho: string[]): No | undefined {
  let atual = n;
  for (const p of caminho) atual = atual?.filhos.find((f) => f.nome === p);
  return atual;
}
/** Texto (aparado) do filho no caminho, ou "". */
export const txt = (n: No | undefined, ...caminho: string[]) => (no(n, ...caminho)?.texto ?? "").trim();
/** Filhos diretos com o nome. */
export const todos = (n: No | undefined, nome: string) => n?.filhos.filter((f) => f.nome === nome) ?? [];
/** Primeiro descendente (em profundidade) com o nome, incluindo o próprio nó. */
export function buscar(n: No | undefined, nome: string): No | undefined {
  if (!n) return undefined;
  if (n.nome === nome) return n;
  for (const f of n.filhos) {
    const r = buscar(f, nome);
    if (r) return r;
  }
  return undefined;
}

/** Bytes → texto pelo encoding da declaração XML (prefeituras ainda mandam ISO-8859-1); BOM UTF-8 vence. */
export function decodificarXml(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder("utf-8").decode(bytes.subarray(3));
  const cabeca = new TextDecoder("latin1").decode(bytes.subarray(0, 200));
  const enc = /encoding\s*=\s*["']([\w-]+)["']/i.exec(cabeca)?.[1]?.toLowerCase();
  const latin = enc && /^(iso-?8859-1|latin-?1|windows-1252|cp1252)$/.test(enc);
  return new TextDecoder(latin ? "windows-1252" : "utf-8").decode(bytes);
}
