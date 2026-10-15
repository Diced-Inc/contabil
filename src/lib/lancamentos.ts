import { eq, or } from "drizzle-orm";
import type { Tx } from "@/db";
import { lancamentos, partidas, lancamentoLog, titulos } from "@/db/schema";
import { cents, fromCents, primeiroDiaDoMes, hoje } from "./format";

export type PartidaInput = { contaId: string; debito?: string; credito?: string };
export type LancamentoInput = {
  empresaId: string; data: string; competencia?: string; dataPagamento?: string | null;
  historico: string; documento?: string | null;
  origem: "manual" | "conciliacao" | "apuracao" | "estorno"; partidas: PartidaInput[];
  usuarioId?: string | null; estornoDeId?: string | null;
};
export type EdicaoInput = Omit<LancamentoInput, "origem" | "estornoDeId">;

export function validarPartidas(ps: PartidaInput[]) {
  if (ps.length < 2) throw new Error("Lançamento precisa de pelo menos duas partidas");
  let d = 0, c = 0;
  for (const p of ps) {
    const dd = cents(p.debito || 0), cc = cents(p.credito || 0);
    if (Number.isNaN(dd) || Number.isNaN(cc) || dd < 0 || cc < 0 || (dd > 0) === (cc > 0)) {
      throw new Error("Cada partida precisa de débito OU crédito positivo");
    }
    d += dd; c += cc;
  }
  if (d !== c) throw new Error(`Lançamento desbalanceado: débitos ${fromCents(d)} ≠ créditos ${fromCents(c)}`);
  return { total: d };
}

const normalizar = (p: PartidaInput) => ({
  contaId: p.contaId, debito: fromCents(cents(p.debito || 0)), credito: fromCents(cents(p.credito || 0)),
});
const linhas = (id: string, ps: PartidaInput[]) => ps.map((p, i) => ({ lancamentoId: id, ordem: i, ...normalizar(p) }));

/** Retrato JSON-safe (só strings) gravado em lancamento_log.antes/depois. */
function retrato(l: {
  data: string; competencia: string; dataPagamento?: string | null; historico: string; documento?: string | null;
  partidas: PartidaInput[];
}) {
  return {
    data: l.data, competencia: l.competencia, dataPagamento: l.dataPagamento ?? null,
    historico: l.historico, documento: l.documento ?? null, partidas: l.partidas.map(normalizar),
  };
}
export type RetratoLancamento = ReturnType<typeof retrato>;

export async function criarLancamento(tx: Tx, input: LancamentoInput) {
  validarPartidas(input.partidas);
  const competencia = input.competencia ?? primeiroDiaDoMes(input.data);
  const [l] = await tx.insert(lancamentos).values({
    empresaId: input.empresaId, data: input.data, competencia,
    dataPagamento: input.dataPagamento ?? null, historico: input.historico, documento: input.documento ?? null,
    origem: input.origem, estornoDeId: input.estornoDeId ?? null, createdBy: input.usuarioId ?? null,
  }).returning();
  await tx.insert(partidas).values(linhas(l.id, input.partidas));
  await tx.insert(lancamentoLog).values({
    lancamentoId: l.id, empresaId: input.empresaId, acao: "criado", usuarioId: input.usuarioId ?? null,
    depois: { ...retrato({ ...input, competencia }), origem: input.origem },
  });
  return l;
}

/** Lançamentos de título (competência ou baixa) só mudam pelo fluxo do título ou da conciliação. */
export async function exigirSemTitulo(tx: Tx, id: string) {
  const [t] = await tx
    .select({ id: titulos.id })
    .from(titulos)
    .where(or(eq(titulos.lancamentoId, id), eq(titulos.baixaLancamentoId, id)))
    .limit(1);
  if (t) throw new Error("Lançamento vinculado a um título; cancele o título ou desfaça a conciliação");
}

/** Substitui cabeçalho e partidas. Só lançamentos manuais não estornados (conciliação/apuração/estorno têm fluxo próprio). */
export async function editarLancamento(tx: Tx, id: string, input: EdicaoInput) {
  validarPartidas(input.partidas);
  const antes = await tx.query.lancamentos.findFirst({ where: eq(lancamentos.id, id), with: { partidas: true } });
  if (!antes || antes.empresaId !== input.empresaId) throw new Error("Lançamento não encontrado");
  if (antes.status === "estornado") throw new Error("Lançamento estornado não pode ser editado");
  if (antes.origem === "apuracao") throw new Error("Lançamento de apuração não pode ser editado; reverta a apuração");
  if (antes.origem === "conciliacao") throw new Error("Lançamento de conciliação não pode ser editado; desfaça a conciliação");
  if (antes.origem === "estorno") throw new Error("Lançamento de estorno não pode ser editado");
  await exigirSemTitulo(tx, id);
  const competencia = input.competencia ?? primeiroDiaDoMes(input.data);
  await tx.update(lancamentos).set({
    data: input.data, competencia, dataPagamento: input.dataPagamento ?? null,
    historico: input.historico, documento: input.documento ?? null, updatedAt: new Date(),
  }).where(eq(lancamentos.id, id));
  await tx.delete(partidas).where(eq(partidas.lancamentoId, id));
  await tx.insert(partidas).values(linhas(id, input.partidas));
  await tx.insert(lancamentoLog).values({
    lancamentoId: id, empresaId: input.empresaId, acao: "alterado", usuarioId: input.usuarioId ?? null,
    antes: retrato({ ...antes, partidas: [...antes.partidas].sort((a, b) => a.ordem - b.ordem) }),
    depois: retrato({ ...input, competencia }),
  });
}

/**
 * Cria lançamento inverso na data informada e marca o original como estornado. Retorna o estorno.
 * `origem: "apuracao"` no estorno da apuração, para a DRE (que ignora apuração) continuar mostrando o ano.
 */
export async function estornarLancamento(
  tx: Tx, id: string, data: string = hoje(), usuarioId?: string | null, origem: "estorno" | "apuracao" = "estorno",
) {
  const orig = await tx.query.lancamentos.findFirst({ where: eq(lancamentos.id, id), with: { partidas: true } });
  if (!orig) throw new Error("Lançamento não encontrado");
  if (orig.status === "estornado") throw new Error("Lançamento já estornado");
  const estorno = await criarLancamento(tx, {
    empresaId: orig.empresaId, data, historico: `Estorno do lançamento ${orig.numero}: ${orig.historico}`,
    documento: orig.documento, origem, estornoDeId: orig.id, usuarioId,
    partidas: [...orig.partidas].sort((a, b) => a.ordem - b.ordem).map((p) => ({ contaId: p.contaId, debito: p.credito, credito: p.debito })),
  });
  await tx.update(lancamentos).set({ status: "estornado", updatedAt: new Date() }).where(eq(lancamentos.id, id));
  await tx.insert(lancamentoLog).values({
    lancamentoId: id, empresaId: orig.empresaId, acao: "estornado", usuarioId: usuarioId ?? null,
    depois: { estornoId: estorno.id, estornoNumero: estorno.numero, data },
  });
  return estorno;
}
