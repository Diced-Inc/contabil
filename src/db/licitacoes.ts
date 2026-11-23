import { and, asc, desc, eq, getTableColumns, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { enviarEmail, emailLicitacoesNovas } from "@/lib/email";
import {
  candidataTI, CHAVES_CATEGORIAS, fmtDataHoraSP, mapearContratacao, NENHUMA, novaParaBusca, SITUACAO_DIVULGADA, UFS, type LicitacaoNova,
} from "@/lib/licitacoes";
import { classificarObjetos, type ClassificacaoIA } from "@/lib/licitacoes-ia";
import { paginaPropostas } from "@/lib/pncp";
import { db } from ".";
import { buscasLicitacao, contadores, empresas, licitacoes, licitacoesSync } from "./schema";

/** Uma execução por UF a cada 10 min: trava concorrência e serve de debounce do "Atualizar agora". */
export const INTERVALO_MIN_MS = 10 * 60_000;
/** Pausa entre páginas: o PNCP devolve 429 com ~20 páginas seguidas sem folga. */
const PAUSA_MS = 1_200;

/** UFs sincronizadas: LICITACOES_UFS (padrão CE) + as UFs das buscas ativas. */
export async function ufsParaSincronizar() {
  const base = (process.env.LICITACOES_UFS || "CE").split(",").map((u) => u.trim().toUpperCase());
  const dasBuscas = await db
    .selectDistinct({ uf: sql<string>`unnest(${buscasLicitacao.ufs})` })
    .from(buscasLicitacao)
    .where(eq(buscasLicitacao.ativa, true));
  const validas = new Set<string>(UFS);
  return [...new Set([...base, ...dasBuscas.map((b) => b.uf)])].filter((u) => validas.has(u)).sort();
}

const colunas = getTableColumns(licitacoes);
const atualizaveis = Object.fromEntries(
  (Object.keys(colunas) as (keyof typeof colunas)[])
    .filter((k) => !["id", "numeroControle", "createdAt", "updatedAt", "categoria", "classificadoEm"].includes(k))
    .map((k) => [k, sql.raw(`excluded."${colunas[k].name}"`)]),
);
// a classificação sobrevive à re-sincronização; só volta a pendente se o órgão mudar o objeto
const objetoMudou = sql`${licitacoes.objeto} is distinct from excluded."objeto"`;
const classificacaoPreservada = {
  categoria: sql`case when ${objetoMudou} then null else ${licitacoes.categoria} end`,
  classificadoEm: sql`case when ${objetoMudou} then null else ${licitacoes.classificadoEm} end`,
};

async function gravar(itens: LicitacaoNova[]) {
  // o PNCP pode repetir um item na mesma página; o upsert não aceita a mesma chave duas vezes
  const unicos = [...new Map(itens.map((i) => [i.numeroControle, i])).values()];
  if (!unicos.length) return 0;
  await db
    .insert(licitacoes)
    .values(unicos)
    .onConflictDoUpdate({ target: licitacoes.numeroControle, set: { ...atualizaveis, ...classificacaoPreservada, updatedAt: sql`now()` } });
  return unicos.length;
}

export type ResultadoSync = { uf: string; status: "concluido" | "parcial" | "ocupado" | "erro"; paginas: number; itens: number; total?: number; erro?: string };

/**
 * Baixa as contratações com propostas abertas de cada UF e grava (upsert por número de controle).
 * Para quando passa de `prazoMs` e guarda a próxima página: a execução seguinte continua dali.
 */
export async function sincronizarLicitacoes({ ufs, prazoMs }: { ufs: string[]; prazoMs: number }) {
  const inicio = Date.now();
  const resultados: ResultadoSync[] = [];
  for (const uf of ufs) {
    await db.insert(licitacoesSync).values({ uf }).onConflictDoNothing();
    const [estado] = await db
      .update(licitacoesSync)
      .set({ iniciadoEm: new Date(), erro: null })
      .where(
        and(
          eq(licitacoesSync.uf, uf),
          or(isNull(licitacoesSync.iniciadoEm), lt(licitacoesSync.iniciadoEm, new Date(Date.now() - INTERVALO_MIN_MS))),
        ),
      )
      .returning();
    if (!estado) {
      resultados.push({ uf, status: "ocupado", paginas: 0, itens: 0 });
      continue;
    }
    let pagina = estado.proximaPagina;
    let total = estado.totalPaginas ?? 0;
    const r: ResultadoSync = { uf, status: "parcial", paginas: 0, itens: 0 };
    try {
      while (Date.now() - inicio < prazoMs) {
        if (r.paginas) await new Promise((ok) => setTimeout(ok, PAUSA_MS));
        const p = await paginaPropostas(uf, pagina);
        total = p.totalPaginas;
        r.itens += await gravar(p.data.map(mapearContratacao));
        r.paginas++;
        pagina++;
        if (pagina > total) break;
      }
      const terminou = pagina > total;
      r.status = terminou ? "concluido" : "parcial";
      r.total = total;
      await db
        .update(licitacoesSync)
        .set({ proximaPagina: terminou ? 1 : pagina, totalPaginas: total, finalizadoEm: new Date(), ...(terminou ? { concluidoEm: new Date() } : {}) })
        .where(eq(licitacoesSync.uf, uf));
    } catch (e) {
      r.status = "erro";
      r.erro = e instanceof Error ? e.message : String(e);
      console.error(`[licitacoes] sync ${uf} página ${pagina}:`, e);
      await db.update(licitacoesSync).set({ proximaPagina: pagina, erro: r.erro, finalizadoEm: new Date() }).where(eq(licitacoesSync.uf, uf));
    }
    resultados.push(r);
  }
  return resultados;
}

const LOTE_IA = 35;

export type ResultadoClassificacao = { semIA: number; classificadas: number; relevantes: number; pendentes: number; erros: string[] };

/**
 * Classifica as licitações ainda sem categoria (abertas primeiro). Pré-filtro descarta o que não tem cara de TI sem chamar a IA;
 * o resto vai em lotes para a IA. Erro num lote deixa o lote pendente (próxima rodada tenta de novo); nunca lança.
 * `aoClassificar` recebe cada decisão da IA (usado no backfill para conferir os motivos).
 */
export async function classificarPendentes({
  prazoMs,
  aoClassificar,
}: {
  prazoMs: number;
  aoClassificar?: (l: { id: string; objeto: string } & ClassificacaoIA) => void;
}): Promise<ResultadoClassificacao> {
  const inicio = Date.now();
  const r: ResultadoClassificacao = { semIA: 0, classificadas: 0, relevantes: 0, pendentes: 0, erros: [] };
  try {
    const pendentes = await db
      .select({ id: licitacoes.id, objeto: licitacoes.objeto })
      .from(licitacoes)
      .where(isNull(licitacoes.classificadoEm))
      .orderBy(
        desc(sql`${licitacoes.situacaoId} = ${SITUACAO_DIVULGADA} and ${licitacoes.encerramentoPropostas} > now()`),
        asc(licitacoes.encerramentoPropostas),
      );
    const descartadas = pendentes.filter((l) => !candidataTI(l.objeto)).map((l) => l.id);
    for (let i = 0; i < descartadas.length; i += 500) {
      await db
        .update(licitacoes)
        .set({ categoria: NENHUMA, classificadoEm: sql`now()` })
        .where(inArray(licitacoes.id, descartadas.slice(i, i + 500)));
    }
    r.semIA = descartadas.length;
    const candidatas = pendentes.filter((l) => candidataTI(l.objeto));
    for (let i = 0; i < candidatas.length; i += LOTE_IA) {
      if (Date.now() - inicio >= prazoMs) {
        r.pendentes = candidatas.length - i;
        break;
      }
      const lote = candidatas.slice(i, i + LOTE_IA);
      try {
        const res = await classificarObjetos(lote.map((l) => l.objeto));
        const porCategoria = new Map<string, string[]>();
        for (const [j, c] of res) {
          porCategoria.set(c.categoria, [...(porCategoria.get(c.categoria) ?? []), lote[j].id]);
          aoClassificar?.({ ...lote[j], ...c });
        }
        for (const [categoria, ids] of porCategoria) {
          await db.update(licitacoes).set({ categoria, classificadoEm: sql`now()` }).where(inArray(licitacoes.id, ids));
        }
        r.classificadas += res.size;
        r.relevantes += [...res.values()].filter((c) => c.categoria !== NENHUMA).length;
        r.pendentes += lote.length - res.size;
      } catch (e) {
        r.pendentes += lote.length;
        r.erros.push(e instanceof Error ? e.message : String(e));
        console.error("[licitacoes] classificação (lote fica pendente):", e);
      }
    }
  } catch (e) {
    r.erros.push(e instanceof Error ? e.message : String(e));
    console.error("[licitacoes] classificação:", e);
  }
  return r;
}

/**
 * E-mail diário por busca ativa com as licitações vistas pela primeira vez depois do último envio
 * (ou da criação da busca). Sem novas, nada sai. Não grava em `notificacoes`: lá empresa_id é obrigatório.
 */
export async function enviarAlertasLicitacoes(site: string) {
  const buscas = await db
    .select({ busca: buscasLicitacao, empresa: empresas.razaoSocial })
    .from(buscasLicitacao)
    .leftJoin(empresas, eq(empresas.id, buscasLicitacao.empresaId))
    .where(eq(buscasLicitacao.ativa, true));
  if (!buscas.length) return [];
  const para = (await db.select({ email: contadores.email }).from(contadores)).map((c) => c.email);
  const desde = (b: (typeof buscas)[number]["busca"]) => b.ultimoEnvio ?? b.createdAt;
  const corte = new Date(Math.min(...buscas.map(({ busca }) => desde(busca).getTime())));
  const agora = new Date();
  const candidatas = await db
    .select()
    .from(licitacoes)
    .where(
      and(
        // "nova" = classificada depois do corte: a que entrou antes do último envio mas só foi classificada agora ainda sai
        gt(licitacoes.classificadoEm, corte),
        inArray(licitacoes.categoria, CHAVES_CATEGORIAS),
        eq(licitacoes.situacaoId, SITUACAO_DIVULGADA),
        gt(licitacoes.encerramentoPropostas, agora),
      ),
    )
    .orderBy(asc(licitacoes.encerramentoPropostas));

  const resumo: { busca: string; novas: number; enviados: number; erros: number }[] = [];
  for (const { busca, empresa } of buscas) {
    const novas = candidatas.filter((l) => novaParaBusca(l, busca, desde(busca)));
    if (!novas.length || !para.length) {
      resumo.push({ busca: busca.nome, novas: novas.length, enviados: 0, erros: 0 });
      continue;
    }
    const email = emailLicitacoesNovas({
      busca: busca.nome,
      empresa,
      link: `${site}/licitacoes?alerta=${busca.id}`,
      itens: novas.map((l) => ({
        objeto: l.objeto,
        orgao: l.orgaoNome,
        local: `${l.municipio}/${l.uf}`,
        modalidade: l.modalidadeNome,
        valor: l.valorEstimado,
        encerramento: fmtDataHoraSP(l.encerramentoPropostas!),
      })),
    });
    const envios = await Promise.all(para.map((p) => enviarEmail({ para: p, ...email })));
    for (const e of envios) if (e.status === "erro") console.error(`[licitacoes] alerta "${busca.nome}":`, e.erro);
    const enviados = envios.filter((e) => e.status === "enviado").length;
    // só avança com envio real: com erro (ou Resend não configurado) as mesmas novas saem na próxima
    if (enviados) await db.update(buscasLicitacao).set({ ultimoEnvio: agora }).where(eq(buscasLicitacao.id, busca.id));
    resumo.push({ busca: busca.nome, novas: novas.length, enviados, erros: envios.filter((e) => e.status === "erro").length });
  }
  return resumo;
}

/** Para a tela: última passada completa, se está rodando agora, se ficou pela metade e o último erro. */
export async function estadoSync() {
  const linhas = await db.select().from(licitacoesSync);
  const agora = Date.now();
  const maisRecente = (f: (l: (typeof linhas)[number]) => Date | null) =>
    linhas.map(f).reduce<Date | null>((m, d) => (d && (!m || d > m) ? d : m), null);
  return {
    concluido: maisRecente((l) => l.concluidoEm),
    // execução sem fim registrado há menos de 6 min (o limite da função é 5)
    rodando: linhas.some((l) => l.iniciadoEm && l.iniciadoEm.getTime() > agora - 6 * 60_000 && (!l.finalizadoEm || l.finalizadoEm < l.iniciadoEm)),
    liberaEm: linhas.reduce((m, l) => Math.max(m, (l.iniciadoEm?.getTime() ?? 0) + INTERVALO_MIN_MS), 0),
    parcial: linhas.some((l) => l.proximaPagina > 1),
    erro: linhas.find((l) => l.erro)?.erro ?? null,
  };
}
