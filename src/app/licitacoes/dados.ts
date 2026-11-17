import { and, asc, count, desc, eq, gt, gte, ilike, inArray, isNotNull, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { buscasLicitacao, empresas, licitacoes, licitacoesSalvas } from "@/db/schema";
import { escapeLike, parseValorBR } from "@/lib/format";
import { limitePrazo, normalizar, separarTermos, SITUACAO_DIVULGADA, type CriteriosBusca } from "@/lib/licitacoes";

export const POR_PAGINA = 30;

export type Filtros = CriteriosBusca & { q: string; prazoDias: number | null; ordem: "encerramento" | "valor"; pagina: number };

type SP = Record<string, string | string[] | undefined>;
const lista = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []).map((s) => s.trim()).filter(Boolean);
const um = (v: string | string[] | undefined) => lista(v)[0] ?? "";
const valor = (s: string) => {
  const n = Number(parseValorBR(s));
  return s && Number.isFinite(n) && n >= 0 ? n : null;
};

/** searchParams → filtros. `alerta=<id>` aplica os critérios de uma busca salva. */
export async function lerFiltros(sp: SP): Promise<Filtros & { alerta: string | null }> {
  const alertaId = um(sp.alerta);
  if (alertaId && z.uuid().safeParse(alertaId).success) {
    const [b] = await db.select().from(buscasLicitacao).where(eq(buscasLicitacao.id, alertaId));
    if (b) {
      return {
        q: b.termos.join(", "), termos: b.termos, ufs: b.ufs, municipios: b.municipios, modalidades: b.modalidades,
        valorMin: b.valorMin, valorMax: b.valorMax, prazoDias: null, ordem: "encerramento", pagina: 1, alerta: b.id,
      };
    }
  }
  const q = um(sp.q).slice(0, 200);
  const prazo = Number(um(sp.prazo));
  return {
    q,
    termos: separarTermos(q),
    ufs: lista(sp.uf).map((u) => u.toUpperCase()),
    municipios: lista(sp.municipio),
    modalidades: lista(sp.modalidade).map(Number).filter((n) => Number.isInteger(n) && n > 0),
    valorMin: valor(um(sp.min)),
    valorMax: valor(um(sp.max)),
    prazoDias: Number.isInteger(prazo) && prazo >= 0 && prazo <= 365 && um(sp.prazo) !== "" ? prazo : null,
    ordem: um(sp.ordem) === "valor" ? "valor" : "encerramento",
    pagina: Math.max(1, Math.min(1000, Number(um(sp.pagina)) || 1)),
    alerta: null,
  };
}

/** Mesma regra de `casaBusca`, em SQL: algum termo (trecho sem acento) e todos os filtros. */
export function condicoes(c: CriteriosBusca): (SQL | undefined)[] {
  const termos = c.termos.map(normalizar).filter(Boolean);
  const temValor = c.valorMin !== null || c.valorMax !== null;
  return [
    termos.length ? or(...termos.map((t) => ilike(licitacoes.textoBusca, `%${escapeLike(t)}%`))) : undefined,
    c.ufs.length ? inArray(licitacoes.uf, c.ufs) : undefined,
    c.municipios.length
      ? inArray(sql`lower(${licitacoes.municipio})`, c.municipios.map((m) => m.toLowerCase()))
      : undefined,
    c.modalidades.length ? inArray(licitacoes.modalidadeId, c.modalidades) : undefined,
    temValor ? isNotNull(licitacoes.valorEstimado) : undefined,
    c.valorMin !== null ? gte(licitacoes.valorEstimado, String(c.valorMin)) : undefined,
    c.valorMax !== null ? lte(licitacoes.valorEstimado, String(c.valorMax)) : undefined,
  ];
}

const abertas = () => and(eq(licitacoes.situacaoId, SITUACAO_DIVULGADA), gt(licitacoes.encerramentoPropostas, sql`now()`));

export async function listarAbertas(f: Filtros) {
  const where = and(abertas(), ...condicoes(f), f.prazoDias !== null ? lt(licitacoes.encerramentoPropostas, limitePrazo(f.prazoDias)) : undefined);
  const ordem =
    f.ordem === "valor"
      ? [sql`${licitacoes.valorEstimado} desc nulls last`, asc(licitacoes.encerramentoPropostas)]
      : [asc(licitacoes.encerramentoPropostas), desc(licitacoes.valorEstimado)];
  const [itens, [{ n }]] = await Promise.all([
    db
      .select({ l: licitacoes, salvaId: licitacoesSalvas.id })
      .from(licitacoes)
      .leftJoin(licitacoesSalvas, eq(licitacoesSalvas.licitacaoId, licitacoes.id))
      .where(where)
      .orderBy(...ordem)
      .limit(POR_PAGINA)
      .offset((f.pagina - 1) * POR_PAGINA),
    db.select({ n: count() }).from(licitacoes).where(where),
  ]);
  return { itens, total: n };
}

/** Opções dos filtros: UFs e municípios com licitações abertas (municípios só das UFs escolhidas). */
export async function opcoesFiltros(ufs: string[]) {
  const [u, m] = await Promise.all([
    db.selectDistinct({ uf: licitacoes.uf }).from(licitacoes).where(abertas()).orderBy(asc(licitacoes.uf)),
    db
      .selectDistinct({ municipio: licitacoes.municipio })
      .from(licitacoes)
      .where(and(abertas(), ufs.length ? inArray(licitacoes.uf, ufs) : undefined))
      .orderBy(asc(licitacoes.municipio)),
  ]);
  return { ufs: u.map((x) => x.uf), municipios: m.map((x) => x.municipio) };
}

export async function listarSalvas() {
  return db
    .select({ s: licitacoesSalvas, l: licitacoes, empresa: empresas.razaoSocial })
    .from(licitacoesSalvas)
    .innerJoin(licitacoes, eq(licitacoes.id, licitacoesSalvas.licitacaoId))
    .leftJoin(empresas, eq(empresas.id, licitacoesSalvas.empresaId))
    .orderBy(asc(licitacoes.encerramentoPropostas));
}

/** Buscas salvas com quantas abertas batem hoje. */
export async function listarBuscas() {
  const buscas = await db
    .select({ b: buscasLicitacao, empresa: empresas.razaoSocial })
    .from(buscasLicitacao)
    .leftJoin(empresas, eq(empresas.id, buscasLicitacao.empresaId))
    .orderBy(desc(buscasLicitacao.ativa), asc(buscasLicitacao.nome));
  const contagens = await Promise.all(
    buscas.map(({ b }) => db.select({ n: count() }).from(licitacoes).where(and(abertas(), ...condicoes(b))).then(([r]) => r.n)),
  );
  return buscas.map((x, i) => ({ ...x, abertas: contagens[i] }));
}

export const listarEmpresas = () => db.select({ id: empresas.id, nome: empresas.razaoSocial }).from(empresas).orderBy(asc(empresas.razaoSocial));

export const contarSalvas = () => db.select({ n: count() }).from(licitacoesSalvas).then(([r]) => r.n);
