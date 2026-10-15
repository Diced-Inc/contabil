import { and, eq, like, sql } from "drizzle-orm";
import { db } from "@/db";
import { apuracoes, lancamentos, partidas, planoContas } from "@/db/schema";
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
