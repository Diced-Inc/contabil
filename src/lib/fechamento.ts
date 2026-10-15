import { and, eq, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { apuracoes, fechamentos, lancamentoLog, lancamentos } from "@/db/schema";
import { partidasApuracao } from "./apuracao";
import { cents, fmtCompetencia, fromCents, primeiroDiaDoMes } from "./format";
import { criarLancamento, estornarLancamento } from "./lancamentos";
import { saldos } from "./relatorios/saldos";
import { contaPorPapel } from "./titulos";

type Exec = typeof db | Tx;

/** Competências "YYYY-MM-01" do ano. */
export const mesesDoAno = (ano: number) =>
  Array.from({ length: 12 }, (_, i) => `${ano}-${String(i + 1).padStart(2, "0")}-01`);

export function mesAnterior(c: string) {
  const a = Number(c.slice(0, 4)), m = Number(c.slice(5, 7));
  return m === 1 ? `${a - 1}-12-01` : `${a}-${String(m - 1).padStart(2, "0")}-01`;
}

export type EstadoFechamento = {
  fechados: Map<string, { fechadoEm: Date; fechadoPor: string | null }>;
  /** Data do lançamento mais antigo em mês aberto (null se não houver). */
  primeiroAberto: string | null;
  apurados: Set<number>;
};

export async function carregarEstado(exec: Exec, empresaId: string): Promise<EstadoFechamento> {
  const [fs, [{ min }], aps] = await Promise.all([
    exec.select().from(fechamentos).where(eq(fechamentos.empresaId, empresaId)),
    exec
      .select({ min: sql<string | null>`min(${lancamentos.data})` })
      .from(lancamentos)
      .where(and(
        eq(lancamentos.empresaId, empresaId),
        sql`NOT EXISTS (SELECT 1 FROM ${fechamentos} f WHERE f.empresa_id = ${lancamentos.empresaId}
          AND f.competencia = date_trunc('month', ${lancamentos.data})::date)`,
      )),
    exec.select({ exercicio: apuracoes.exercicio }).from(apuracoes).where(eq(apuracoes.empresaId, empresaId)),
  ]);
  return {
    fechados: new Map(fs.map((f) => [f.competencia, { fechadoEm: f.fechadoEm, fechadoPor: f.fechadoPor }])),
    primeiroAberto: min,
    apurados: new Set(aps.map((a) => a.exercicio)),
  };
}

/** null = pode fechar; senão, o motivo. Exige mês anterior fechado ou nenhum lançamento anterior em mês aberto. */
export function motivoNaoFechar(c: string, e: EstadoFechamento): string | null {
  if (e.fechados.has(c)) return "Mês já está fechado";
  if (!e.fechados.has(mesAnterior(c)) && e.primeiroAberto && e.primeiroAberto < c) {
    return `Há lançamentos em ${fmtCompetencia(e.primeiroAberto)}, mês ainda aberto; feche os meses anteriores primeiro`;
  }
  return null;
}

/** null = pode reabrir. Exige nenhum mês posterior fechado e exercício não apurado. */
export function motivoNaoReabrir(c: string, e: EstadoFechamento): string | null {
  if (!e.fechados.has(c)) return "Mês não está fechado";
  if ([...e.fechados.keys()].some((f) => f > c)) return "Reabra antes os meses seguintes";
  const ano = Number(c.slice(0, 4));
  if (e.apurados.has(ano)) return `Reverta a apuração de ${ano} antes de reabrir`;
  return null;
}

export function motivoNaoApurar(ano: number, e: EstadoFechamento): string | null {
  if (e.apurados.has(ano)) return `Exercício ${ano} já apurado`;
  if (mesesDoAno(ano).some((m) => !e.fechados.has(m))) return `Feche os 12 meses de ${ano} antes de apurar`;
  return null;
}

function exigir(motivo: string | null) {
  if (motivo) throw new Error(motivo);
}

export async function fecharMes(tx: Tx, empresaId: string, competencia: string, usuarioId: string | null) {
  const c = primeiroDiaDoMes(competencia);
  exigir(motivoNaoFechar(c, await carregarEstado(tx, empresaId)));
  await tx.insert(fechamentos).values({ empresaId, competencia: c, fechadoPor: usuarioId });
  await tx.insert(lancamentoLog).values({ empresaId, acao: "fechamento", usuarioId, depois: { competencia: c } });
}

export async function reabrirMes(tx: Tx, empresaId: string, competencia: string, usuarioId: string | null) {
  const c = primeiroDiaDoMes(competencia);
  exigir(motivoNaoReabrir(c, await carregarEstado(tx, empresaId)));
  await tx.delete(fechamentos).where(and(eq(fechamentos.empresaId, empresaId), eq(fechamentos.competencia, c)));
  await tx.insert(lancamentoLog).values({ empresaId, acao: "reabertura", usuarioId, depois: { competencia: c } });
}

/** Abre dezembro só durante `fn` (os triggers barram escrita em mês fechado) e o refecha com os dados originais. */
async function comDezembroAberto<T>(tx: Tx, empresaId: string, ano: number, fn: () => Promise<T>) {
  const onde = and(eq(fechamentos.empresaId, empresaId), eq(fechamentos.competencia, `${ano}-12-01`));
  const [dez] = await tx.delete(fechamentos).where(onde).returning();
  const r = await fn();
  if (dez) await tx.insert(fechamentos).values(dez);
  return r;
}

export async function apurarExercicio(tx: Tx, empresaId: string, ano: number, usuarioId: string | null) {
  exigir(motivoNaoApurar(ano, await carregarEstado(tx, empresaId)));
  const linhas = await saldos(empresaId, `${ano}-01-01`, `${ano}-12-31`, tx);
  // Resultado do exercício = movimento do ano das analíticas de resultado.
  const resultado = linhas
    .filter((l) => l.tipo === "analitica" && l.codigo.startsWith("3"))
    .map((l) => ({ id: l.id, codigo: l.codigo, saldo: fromCents(cents(l.debitos) - cents(l.creditos)) }));
  const [lucros, prejuizos] = await Promise.all([
    contaPorPapel(tx, empresaId, "lucros_acumulados"),
    contaPorPapel(tx, empresaId, "prejuizos_acumulados"),
  ]);
  const ap = partidasApuracao(resultado, lucros.id, prejuizos.id);
  if (ap.partidas.length === 0) throw new Error("Não há resultado a apurar no exercício");
  const l = await comDezembroAberto(tx, empresaId, ano, () =>
    criarLancamento(tx, {
      empresaId, data: `${ano}-12-31`, historico: `Apuração do resultado do exercício ${ano}`,
      origem: "apuracao", partidas: ap.partidas, usuarioId,
    }),
  );
  await tx.insert(apuracoes).values({ empresaId, exercicio: ano, lancamentoId: l.id });
  await tx.insert(lancamentoLog).values({
    lancamentoId: l.id, empresaId, acao: "apuracao", usuarioId, depois: { exercicio: ano, resultado: ap.resultado },
  });
  return { lancamento: l, resultado: ap.resultado };
}

export async function reverterApuracao(tx: Tx, empresaId: string, ano: number, usuarioId: string | null) {
  const onde = and(eq(apuracoes.empresaId, empresaId), eq(apuracoes.exercicio, ano));
  const [ap] = await tx.select().from(apuracoes).where(onde);
  if (!ap) throw new Error(`Exercício ${ano} não está apurado`);
  const estorno = await comDezembroAberto(tx, empresaId, ano, () =>
    estornarLancamento(tx, ap.lancamentoId, `${ano}-12-31`, usuarioId),
  );
  await tx.delete(apuracoes).where(onde);
  await tx.insert(lancamentoLog).values({
    lancamentoId: ap.lancamentoId, empresaId, acao: "apuracao", usuarioId,
    antes: { exercicio: ano }, depois: { exercicio: ano, revertida: true, estornoId: estorno.id },
  });
  return estorno;
}
