import { eq } from "drizzle-orm";
import type { Tx } from "./index";
import { planoContas } from "./schema";
import { PLANO_ITG1000, parentCodigo } from "./seed-plano";

type Papel = NonNullable<typeof planoContas.$inferInsert["papel"]>;
type TipoConta = "sintetica" | "analitica";
type GrupoDre = typeof planoContas.$inferInsert["grupoDre"];

/** Analíticas que entraram no seed em 11/2026; o patch das empresas existentes só cuida delas (e dos grupos que faltarem). */
export const NOVAS_CONTAS = [
  "1.1.4.06", "1.1.5.01", "2.1.3.06", "2.1.3.07", "2.1.3.08", "2.1.3.09", "2.1.3.10", "2.2.2.02", "2.3.3.03", "3.2.2.12",
];

/** Nome normalizado de conta criada à mão que vale como a conta do seed (além do nome igual). */
const APELIDOS: Record<string, RegExp> = {
  "1.1.5.01": /^transferencias?\b/,
  "1.1.4.06": /^adiantamentos? (a|aos|de) socios?$/,
  "2.1.3.10": /^parcelamentos? de (tributos|impostos)$/,
  "2.2.2.02": /^parcelamentos? de (tributos|impostos)( de)? longo prazo$/,
  "2.3.3.03": /^(lucros distribuidos|dividendos)/,
};

export const normalizarNome = (s: string) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\(-\)/g, " ").replace(/[^a-z0-9]+/g, " ").trim();

/** "1.1.5.01" → "1.1": o nome só casa dentro do mesmo grupo (IRPJ despesa ≠ IRPJ a recolher). */
const grupo = (codigo: string) => codigo.split(".").slice(0, 2).join(".");

export type ContaExistente = { id: string; codigo: string; nome: string; tipo: TipoConta; papel: Papel | null };
export type AcaoPlano =
  | { acao: "criar"; id: string; codigo: string; nome: string; natureza: "D" | "C"; tipo: TipoConta; parentId: string; grupoDre: GrupoDre; papel: Papel | null }
  | { acao: "papel"; id: string; codigo: string; nome: string; papel: Papel }
  | { acao: "existe"; codigo: string; nome: string; seed: string }
  | { acao: "aviso"; codigo: string; nome: string; motivo: string };

const SEED = new Map(PLANO_ITG1000.map((r) => [r[0], r]));
const COM_FILHO = new Set(PLANO_ITG1000.map((r) => parentCodigo(r[0])));

/** Próximo código livre entre os filhos de `pai`, com a largura do último segmento de `modelo`. */
function codigoLivre(pai: string, modelo: string, contas: ContaExistente[]) {
  const largura = modelo.split(".").at(-1)!.length;
  const usados = contas.filter((c) => parentCodigo(c.codigo) === pai).map((c) => Number(c.codigo.split(".").at(-1)) || 0);
  return `${pai}.${String(Math.max(0, ...usados) + 1).padStart(largura, "0")}`;
}

/**
 * Plano idempotente para completar o plano de contas de uma empresa existente com NOVAS_CONTAS: não duplica conta
 * criada à mão (casa pelo nome normalizado ou apelido, no mesmo grupo e tipo), não renumera nada, só cria o que falta
 * (no código do seed ou no próximo livre do mesmo pai) e marca o papel da conta reaproveitada se ele estiver livre.
 */
export function planejarComplemento(existentes: ContaExistente[], novas = NOVAS_CONTAS, novoId = () => crypto.randomUUID()): AcaoPlano[] {
  const contas = [...existentes];
  const acoes: AcaoPlano[] = [];
  const papelLivre = (p: Papel) => !contas.some((c) => c.papel === p);

  /** Id da sintética `codigo`, criando-a (e os pais) a partir do seed se faltar; null se o código é de uma analítica. */
  const garantirGrupo = (codigo: string): string | null => {
    const e = contas.find((c) => c.codigo === codigo);
    if (e) return e.tipo === "sintetica" ? e.id : null;
    const s = SEED.get(codigo);
    const pai = parentCodigo(codigo);
    const parentId = s && pai ? garantirGrupo(pai) : null;
    if (!s || !parentId) return null;
    const nova = { id: novoId(), codigo, nome: s[1], tipo: "sintetica" as const, papel: null };
    contas.push(nova);
    acoes.push({ acao: "criar", ...nova, natureza: s[2], parentId, grupoDre: null });
    return nova.id;
  };

  for (const codigo of novas) {
    const s = SEED.get(codigo);
    if (!s) throw new Error(`${codigo} não está no seed`);
    const [, nome, natureza, grupoDre, papel] = s;
    const tipo: TipoConta = COM_FILHO.has(codigo) ? "sintetica" : "analitica";
    const alvo = normalizarNome(nome);
    const igual = contas.find((c) => c.tipo === tipo && grupo(c.codigo) === grupo(codigo)
      && (normalizarNome(c.nome) === alvo || !!APELIDOS[codigo]?.test(normalizarNome(c.nome))));
    if (igual) {
      if (papel && igual.papel !== papel) {
        if (!igual.papel && papelLivre(papel)) {
          igual.papel = papel;
          acoes.push({ acao: "papel", id: igual.id, codigo: igual.codigo, nome: igual.nome, papel });
        } else {
          acoes.push({ acao: "aviso", codigo: igual.codigo, nome: igual.nome, motivo: `papel ${papel} não aplicado (conta já tem papel ou o papel está em outra conta)` });
        }
      } else {
        acoes.push({ acao: "existe", codigo: igual.codigo, nome: igual.nome, seed: codigo });
      }
      continue;
    }
    const pai = parentCodigo(codigo)!;
    const parentId = garantirGrupo(pai);
    if (!parentId) {
      acoes.push({ acao: "aviso", codigo, nome, motivo: `grupo ${pai} ausente ou analítico; crie a conta à mão` });
      continue;
    }
    const cod = contas.some((c) => c.codigo === codigo) ? codigoLivre(pai, codigo, contas) : codigo;
    const p = papel && papelLivre(papel) ? papel : null;
    const nova = { id: novoId(), codigo: cod, nome, tipo, papel: p };
    contas.push(nova);
    acoes.push({ acao: "criar", ...nova, natureza, parentId, grupoDre: grupoDre ?? null });
    if (papel && !p) acoes.push({ acao: "aviso", codigo: cod, nome, motivo: `papel ${papel} já está em outra conta` });
  }
  return acoes;
}

/** Aplica `planejarComplemento` na empresa (dentro da transação do chamador) e devolve as ações. */
export async function completarPlano(tx: Tx, empresaId: string, { aplicar = true } = {}) {
  const existentes = await tx
    .select({ id: planoContas.id, codigo: planoContas.codigo, nome: planoContas.nome, tipo: planoContas.tipo, papel: planoContas.papel })
    .from(planoContas)
    .where(eq(planoContas.empresaId, empresaId));
  const acoes = planejarComplemento(existentes);
  if (!aplicar) return acoes;
  const criar = acoes.flatMap((a) => (a.acao === "criar" ? [a] : []));
  // um INSERT só: a FK de parent_id é checada no fim do statement (pai criado junto com o filho)
  if (criar.length)
    await tx.insert(planoContas).values(criar.map((c) => ({ id: c.id, codigo: c.codigo, nome: c.nome, natureza: c.natureza, tipo: c.tipo, parentId: c.parentId, grupoDre: c.grupoDre, papel: c.papel, empresaId })));
  for (const a of acoes) if (a.acao === "papel") await tx.update(planoContas).set({ papel: a.papel }).where(eq(planoContas.id, a.id));
  return acoes;
}
