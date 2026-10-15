import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { planoContas, regras } from "@/db/schema";

export type RegraLinha = Awaited<ReturnType<typeof listarRegras>>[number];

/** Regras da empresa na ordem em que são avaliadas. */
export function listarRegras(empresaId: string) {
  return db
    .select({
      id: regras.id,
      nome: regras.nome,
      tipoMatch: regras.tipoMatch,
      padrao: regras.padrao,
      sinal: regras.sinal,
      contaId: regras.contaId,
      historicoTemplate: regras.historicoTemplate,
      prioridade: regras.prioridade,
      ativa: regras.ativa,
      contaCodigo: planoContas.codigo,
      contaNome: planoContas.nome,
    })
    .from(regras)
    .innerJoin(planoContas, eq(planoContas.id, regras.contaId))
    .where(eq(regras.empresaId, empresaId))
    .orderBy(asc(regras.prioridade), asc(regras.createdAt));
}

export async function contaAnaliticaValida(empresaId: string, contaId: string) {
  const [c] = await db
    .select({ id: planoContas.id })
    .from(planoContas)
    .where(
      and(
        eq(planoContas.id, contaId),
        eq(planoContas.empresaId, empresaId),
        eq(planoContas.tipo, "analitica"),
        eq(planoContas.ativa, true),
      ),
    );
  return !!c;
}
