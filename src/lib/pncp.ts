import type { PaginaPncp } from "./licitacoes";

/**
 * Cliente da API pública do PNCP (sem chave). Quirks medidos em 16/11/2026:
 * - /contratacoes/proposta exige dataFinal (teto do encerramento; o piso é "agora") e aceita no máximo 50 por página;
 * - sem resultados responde 204 sem corpo;
 * - limita por IP (429 sem Retry-After depois de ~20 páginas seguidas) e às vezes derruba a conexão (ECONNRESET) ou dá 5xx.
 */
const BASE = "https://pncp.gov.br/api";
const TIMEOUT_MS = 15_000;
const ESPERAS_MS = [3_000, 10_000, 30_000];

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson<T>(url: string, vazio: T): Promise<T> {
  let ultimoErro: unknown;
  for (let tentativa = 0; tentativa <= ESPERAS_MS.length; tentativa++) {
    if (tentativa) await dormir(ESPERAS_MS[tentativa - 1]);
    try {
      const r = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
      if (r.status === 204) return vazio;
      if (r.ok) return (await r.json()) as T;
      ultimoErro = new Error(`PNCP HTTP ${r.status}`);
      if (r.status !== 429 && r.status < 500) break; // 4xx não melhora tentando de novo
    } catch (e) {
      ultimoErro = e;
    }
  }
  throw ultimoErro instanceof Error ? ultimoErro : new Error(String(ultimoErro));
}

const aaaammdd = (d: Date) => d.toISOString().slice(0, 10).replaceAll("-", "");

/** Contratações de uma UF com propostas abertas e encerramento em até um ano. */
export function paginaPropostas(uf: string, pagina: number, agora = new Date()) {
  const ate = new Date(agora);
  ate.setUTCFullYear(ate.getUTCFullYear() + 1);
  const qs = new URLSearchParams({ dataFinal: aaaammdd(ate), uf, pagina: String(pagina), tamanhoPagina: "50" });
  return getJson<PaginaPncp>(`${BASE}/consulta/v1/contratacoes/proposta?${qs}`, { data: [], totalRegistros: 0, totalPaginas: 0, numeroPagina: pagina });
}

export type ArquivoPncp = { url: string; titulo: string; tipoDocumentoNome: string; dataPublicacaoPncp: string; statusAtivo: boolean };

/** Edital e demais documentos publicados da compra. */
export async function arquivosDaCompra(cnpj: string, ano: number, sequencial: number) {
  const lista = await getJson<ArquivoPncp[]>(`${BASE}/pncp/v1/orgaos/${cnpj}/compras/${ano}/${sequencial}/arquivos`, []);
  return lista.filter((a) => a.statusAtivo !== false);
}
