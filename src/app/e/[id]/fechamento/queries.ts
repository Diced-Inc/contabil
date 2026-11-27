import { and, eq, inArray, like, sql } from "drizzle-orm";
import { db } from "@/db";
import { apuracoes, lancamentos, partidas, planoContas, titulos } from "@/db/schema";
import { carregarEstado, mesesDoAno, motivoNaoApurar, motivoNaoFechar, motivoNaoReabrir } from "@/lib/fechamento";

export async function painelFechamento(empresaId: string, ano: number) {
  const [estado, [apuracao]] = await Promise.all([
    carregarEstado(db, empresaId),
    db
      .select({
        lancamentoId: apuracoes.lancamentoId,
        numero: lancamentos.numero,
        apuradoEm: apuracoes.createdAt,
        // Lucro = Σ(D − C) das partidas que zeraram as contas de resultado.
        resultado: sql<string>`coalesce(sum(${partidas.debito} - ${partidas.credito}), 0)::text`,
      })
      .from(apuracoes)
      .innerJoin(lancamentos, eq(lancamentos.id, apuracoes.lancamentoId))
      .leftJoin(partidas, eq(partidas.lancamentoId, apuracoes.lancamentoId))
      .leftJoin(planoContas, and(eq(planoContas.id, partidas.contaId), like(planoContas.codigo, "3%")))
      .where(and(eq(apuracoes.empresaId, empresaId), eq(apuracoes.exercicio, ano), sql`${planoContas.id} IS NOT NULL`))
      .groupBy(apuracoes.lancamentoId, lancamentos.numero, apuracoes.createdAt),
  ]);
  return {
    meses: mesesDoAno(ano).map((competencia) => ({
      competencia,
      fechadoEm: estado.fechados.get(competencia)?.fechadoEm ?? null,
      motivoNaoFechar: motivoNaoFechar(competencia, estado),
      motivoNaoReabrir: motivoNaoReabrir(competencia, estado),
    })),
    apuracao: apuracao ?? null,
    motivoNaoApurar: motivoNaoApurar(ano, estado),
  };
}

export type MesFechamento = Awaited<ReturnType<typeof painelFechamento>>["meses"][number];

/** Obrigação (título) de cada guia: contas, status e se já foi baixada no banco. */
export async function obrigacoesDasGuias(guiaIds: string[]) {
  if (!guiaIds.length) return new Map<string, ObrigacaoGuia>();
  const rs = await db
    .select({
      guiaId: titulos.guiaId, status: titulos.status, obrigacaoId: titulos.contaId,
      despesaId: sql<string | null>`(select p.conta_id from partidas p where p.lancamento_id = "titulos"."lancamento_id" and p.debito > 0 order by p.ordem limit 1)`,
      baixada: sql<boolean>`exists (select 1 from baixas b where b.titulo_id = "titulos"."id")`,
    })
    .from(titulos)
    .where(inArray(titulos.guiaId, guiaIds));
  return new Map(rs.filter((r) => r.status !== "cancelado").map((r) => [r.guiaId!, { obrigacaoId: r.obrigacaoId, despesaId: r.despesaId, baixada: r.baixada }]));
}
export type ObrigacaoGuia = { obrigacaoId: string | null; despesaId: string | null; baixada: boolean };
