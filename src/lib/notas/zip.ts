/**
 * Lê um .zip sem dependência: diretório central + DecompressionStream("deflate-raw") (nativo no navegador e no Node 18+).
 * Só "stored" (0) e "deflate" (8); pastas e outros métodos são ignorados.
 */
export type ArquivoZip = { nome: string; dados: Uint8Array };

async function inflar(dados: Uint8Array) {
  const s = new Blob([dados as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

export async function lerZip(buf: Uint8Array): Promise<ArquivoZip[]> {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let k = buf.length - 22; k >= Math.max(0, buf.length - 22 - 65_535); k--)
    if (v.getUint32(k, true) === 0x06054b50) { eocd = k; break; }
  if (eocd < 0) throw new Error("Arquivo .zip inválido");
  const total = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const nomes = new TextDecoder("utf-8");
  const out: ArquivoZip[] = [];
  for (let n = 0; n < total; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error("Arquivo .zip inválido");
    const metodo = v.getUint16(p + 10, true);
    const comprimido = v.getUint32(p + 20, true);
    const lenNome = v.getUint16(p + 28, true), lenExtra = v.getUint16(p + 30, true), lenComent = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const nome = nomes.decode(buf.subarray(p + 46, p + 46 + lenNome));
    p += 46 + lenNome + lenExtra + lenComent;
    if (nome.endsWith("/") || (metodo !== 0 && metodo !== 8)) continue;
    const ini = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const bruto = buf.subarray(ini, ini + comprimido);
    out.push({ nome, dados: metodo === 0 ? bruto.slice() : await inflar(bruto) });
  }
  return out;
}
