/**
 * Cloudflare Email Routing (só servidor): endereços @EMAIL_DOMINIO são redirecionamentos para caixas reais.
 * Regras ficam na zona (Zone › Email Routing Rules), destinos na conta (Account › Email Routing Addresses).
 * Docs: https://developers.cloudflare.com/api/resources/email_routing/
 * As funções puras (validação, mapeamento) ficam exportadas para teste.
 */
import { z } from "zod";

const API = "https://api.cloudflare.com/client/v4";

export type CodigoErro =
  | "sem_token" | "permissao_regras" | "permissao_destinos" | "indisponivel"
  | "destino_nao_verificado" | "invalido" | "ja_existe" | "outro";
export type Falha = { erro: CodigoErro; mensagem: string };
export type Resultado<T> = { dados: T } | Falha;

export type Endereco = { id: string; endereco: string; local: string; destinos: string[]; ativo: boolean; nome: string };
export type Destino = { id: string; email: string; verificado: string | null };
/** O que acontece com e-mail para endereço que não está na lista. */
export type CatchAll = { ativo: boolean; acao: "descartar" | "encaminhar" | "worker"; destinos: string[] };

export const PERMISSAO_REGRAS = "Zone › Email Routing Rules › Edit";
export const PERMISSAO_DESTINOS = "Account › Email Routing Addresses › Edit";

const MENSAGENS: Record<Exclude<CodigoErro, "invalido" | "outro">, string> = {
  sem_token: "A integração com o Cloudflare não está configurada neste servidor.",
  permissao_regras: `O token do Cloudflare precisa da permissão ${PERMISSAO_REGRAS}.`,
  permissao_destinos: `O token do Cloudflare precisa da permissão ${PERMISSAO_DESTINOS}.`,
  indisponivel: "O Cloudflare não respondeu agora. Tente de novo em alguns minutos.",
  destino_nao_verificado: "Esse e-mail ainda não confirmou. Abra o e-mail do Cloudflare que chegou nele e clique no link de confirmação.",
  ja_existe: "Esse endereço já existe.",
};
const falha = (erro: CodigoErro, mensagem = MENSAGENS[erro as keyof typeof MENSAGENS]): Falha => ({ erro, mensagem });

/** `avisos` é o remetente dos e-mails do sistema (Resend); postmaster/abuse são exigidos pelos RFCs. */
export const RESERVADOS = ["avisos", "postmaster", "abuse"];

/** "Contato@dbcontador.com.br " → "contato". */
export const normalizarLocal = (s: string) => s.trim().toLowerCase().split("@")[0];

/** Mensagem do erro ou null se o início do endereço é válido. Espera o valor já normalizado. */
export function validarLocal(local: string): string | null {
  if (!local) return "Escreva o início do endereço, por exemplo: contato.";
  if (!/^[a-z0-9._-]{1,40}$/.test(local)) return "Use só letras sem acento, números, ponto, hífen ou sublinhado (até 40).";
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return "O endereço não pode começar ou terminar com ponto, nem ter dois pontos seguidos.";
  if (RESERVADOS.includes(local)) return `"${local}" é reservado pelo sistema. Escolha outro.`;
  return null;
}

type RegraCF = {
  id: string;
  name?: string;
  enabled?: boolean;
  priority?: number;
  matchers?: { type: string; field?: string; value?: string }[];
  actions?: { type: string; value?: string[] }[];
};
type ErroCF = { code: number; message: string };

/** Regras "to = X → encaminhar" viram endereços; as demais (worker, drop, catch-all) ficam de fora. */
export function mapearRegras(regras: RegraCF[]): Endereco[] {
  return regras
    .flatMap((r) => {
      const m = r.matchers ?? [];
      const fwd = (r.actions ?? []).filter((a) => a.type === "forward");
      if (m.length !== 1 || m[0].type !== "literal" || m[0].field !== "to" || !m[0].value || fwd.length === 0) return [];
      const endereco = m[0].value.toLowerCase();
      // nome automático do painel do Cloudflare não ajuda o contador
      const nome = r.name && !/^rule created at/i.test(r.name) ? r.name : "";
      return [{ id: r.id, endereco, local: endereco.split("@")[0], destinos: fwd.flatMap((a) => a.value ?? []), ativo: r.enabled !== false, nome }];
    })
    .sort((a, b) => a.endereco.localeCompare(b.endereco));
}

export function mapearCatchAll(r: RegraCF | null): CatchAll | null {
  const a = r?.actions?.[0];
  if (!r || !a) return null;
  const acao = a.type === "forward" ? "encaminhar" : a.type === "worker" ? "worker" : "descartar";
  return { ativo: r.enabled !== false, acao, destinos: a.type === "forward" ? (a.value ?? []) : [] };
}

/** 10000 = Authentication error; 9109 = token sem a permissão. */
export function traduzirErro(status: number, erros: ErroCF[], escopo: "regras" | "destinos"): Falha {
  if (status === 401 || status === 403 || erros.some((e) => e.code === 10000 || e.code === 9109)) {
    return falha(escopo === "regras" ? "permissao_regras" : "permissao_destinos");
  }
  if (status >= 500 || status === 429 || erros.length === 0) return falha("indisponivel");
  return falha("outro", `O Cloudflare recusou: ${erros.map((e) => e.message).join("; ")}`);
}

export function corpoRegra(endereco: string, destino: string, nome: string, ativo = true, prioridade = 0) {
  return {
    actions: [{ type: "forward", value: [destino] }],
    matchers: [{ type: "literal", field: "to", value: endereco }],
    enabled: ativo,
    name: nome || `${endereco} para ${destino}`,
    priority: prioridade,
  };
}

function config() {
  const { CLOUDFLARE_EMAIL_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: conta, CLOUDFLARE_ZONE_ID: zona, EMAIL_DOMINIO: dominio } = process.env;
  return token && conta && zona && dominio ? { token, conta, zona, dominio: dominio.toLowerCase() } : null;
}

export const dominioEmail = () => config()?.dominio ?? null;

type Pagina = { page: number; total_pages?: number };

async function cf<T>(escopo: "regras" | "destinos", path: (c: NonNullable<ReturnType<typeof config>>) => string, init?: RequestInit): Promise<Resultado<{ result: T; info?: Pagina }>> {
  const c = config();
  if (!c) return falha("sem_token");
  let r: Response;
  try {
    r = await fetch(API + path(c), {
      ...init,
      headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return falha("indisponivel");
  }
  const corpo = (await r.json().catch(() => null)) as { success?: boolean; result: T; errors?: ErroCF[]; result_info?: Pagina } | null;
  if (r.ok && corpo?.success) return { dados: { result: corpo.result, info: corpo.result_info } };
  return traduzirErro(r.status, corpo?.errors ?? [], escopo);
}

const regras = (sufixo = "") => (c: { zona: string }) => `/zones/${c.zona}/email/routing/rules${sufixo}`;
const destinos = (sufixo = "") => (c: { conta: string }) => `/accounts/${c.conta}/email/routing/addresses${sufixo}`;

async function todasAsRegras(): Promise<Resultado<RegraCF[]>> {
  const todas: RegraCF[] = [];
  for (let page = 1; ; page++) {
    const r = await cf<RegraCF[]>("regras", regras(`?per_page=50&page=${page}`));
    if ("erro" in r) return r;
    todas.push(...r.dados.result);
    if (r.dados.result.length < 50 || page >= (r.dados.info?.total_pages ?? page)) return { dados: todas };
  }
}

export async function listarEnderecos(): Promise<Resultado<{ enderecos: Endereco[]; catchAll: CatchAll | null }>> {
  const [r, ca] = await Promise.all([todasAsRegras(), cf<RegraCF>("regras", regras("/catch_all"))]);
  if ("erro" in r) return r;
  return { dados: { enderecos: mapearRegras(r.dados), catchAll: "erro" in ca ? null : mapearCatchAll(ca.dados.result) } };
}

export async function listarDestinos(): Promise<Resultado<Destino[]>> {
  const r = await cf<{ id: string; email: string; verified: string | null }[]>("destinos", destinos("?per_page=50"));
  if ("erro" in r) return r;
  return { dados: r.dados.result.map((d) => ({ id: d.id, email: d.email.toLowerCase(), verificado: d.verified ?? null })) };
}

/** Cadastra o e-mail que vai receber; o Cloudflare manda a ele um link de confirmação. */
export async function criarDestino(email: string): Promise<Resultado<Destino>> {
  const e = email.trim().toLowerCase();
  if (!z.email().safeParse(e).success) return falha("invalido", "Esse e-mail não parece válido.");
  const r = await cf<{ id: string; email: string; verified: string | null }>("destinos", destinos(), { method: "POST", body: JSON.stringify({ email: e }) });
  if ("erro" in r) return r;
  return { dados: { id: r.dados.result.id, email: e, verificado: r.dados.result.verified ?? null } };
}

type DadosEndereco = { local: string; destino: string; nome?: string };

/** Valida, confere o destino confirmado e o conflito de endereço. `ignorar` = id da própria regra ao editar. */
async function preparar({ local, destino, nome }: DadosEndereco, ignorar?: string) {
  const c = config();
  if (!c) return falha("sem_token");
  const l = normalizarLocal(local);
  const invalido = validarLocal(l);
  if (invalido) return falha("invalido", invalido);
  const d = destino.trim().toLowerCase();
  const [ds, es] = await Promise.all([listarDestinos(), listarEnderecos()]);
  if ("erro" in ds) return ds;
  if ("erro" in es) return es;
  if (!ds.dados.find((x) => x.email === d)?.verificado) return falha("destino_nao_verificado");
  const endereco = `${l}@${c.dominio}`;
  return { endereco, destino: d, nome: (nome ?? "").trim().slice(0, 80), existente: es.dados.enderecos.find((e) => e.endereco === endereco && e.id !== ignorar) };
}

/** Idempotente: se já existe a regra para o mesmo endereço e destino, devolve ela. */
export async function criarEndereco(dados: DadosEndereco): Promise<Resultado<{ id: string; endereco: string }>> {
  const p = await preparar(dados);
  if ("erro" in p) return p;
  if (p.existente) return p.existente.destinos.includes(p.destino) ? { dados: { id: p.existente.id, endereco: p.endereco } } : falha("ja_existe");
  const r = await cf<RegraCF>("regras", regras(), { method: "POST", body: JSON.stringify(corpoRegra(p.endereco, p.destino, p.nome)) });
  return "erro" in r ? r : { dados: { id: r.dados.result.id, endereco: p.endereco } };
}

async function regra(id: string) {
  return cf<RegraCF>("regras", regras(`/${encodeURIComponent(id)}`));
}

export async function atualizarEndereco(id: string, dados: DadosEndereco): Promise<Resultado<true>> {
  const [p, atual] = await Promise.all([preparar(dados, id), regra(id)]);
  if ("erro" in p) return p;
  if ("erro" in atual) return atual;
  if (p.existente) return falha("ja_existe");
  const corpo = corpoRegra(p.endereco, p.destino, p.nome, atual.dados.result.enabled !== false, atual.dados.result.priority ?? 0);
  const r = await cf("regras", regras(`/${encodeURIComponent(id)}`), { method: "PUT", body: JSON.stringify(corpo) });
  return "erro" in r ? r : { dados: true };
}

export async function alternarEndereco(id: string, ativo: boolean): Promise<Resultado<true>> {
  const atual = await regra(id);
  if ("erro" in atual) return atual;
  const { actions, matchers, name, priority } = atual.dados.result;
  const r = await cf("regras", regras(`/${encodeURIComponent(id)}`), { method: "PUT", body: JSON.stringify({ actions, matchers, name, priority, enabled: ativo }) });
  return "erro" in r ? r : { dados: true };
}

export async function removerEndereco(id: string): Promise<Resultado<true>> {
  const r = await cf("regras", regras(`/${encodeURIComponent(id)}`), { method: "DELETE" });
  return "erro" in r ? r : { dados: true };
}
