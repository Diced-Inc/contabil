"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { contasBancarias, grupoDreEnum, naturezaEnum, papelEnum, partidas, planoContas } from "@/db/schema";
import { requireUser } from "@/supabase/server";
import type { EstadoForm } from "./empresas";

const opcional = <T extends z.ZodType>(s: T) =>
  z.preprocess((v) => (v === "" || v === null ? undefined : v), s.optional());

const campos = {
  nome: z.string().trim().min(1, "Informe o nome da conta."),
  natureza: z.enum(naturezaEnum.enumValues, "Natureza inválida."),
  grupoDre: opcional(z.enum(grupoDreEnum.enumValues, "Grupo DRE inválido.")),
  papel: opcional(z.enum(papelEnum.enumValues, "Papel inválido.")),
};
const novaSchema = z.object({
  codigo: z.string().trim().regex(/^\d+(\.\d+)*$/, "Código deve ter só números separados por ponto."),
  ...campos,
});
const edicaoSchema = z.object({ ...campos, ativa: z.boolean() });

function ler(form: FormData) {
  return {
    codigo: form.get("codigo") ?? "",
    nome: form.get("nome") ?? "",
    natureza: form.get("natureza"),
    grupoDre: form.get("grupoDre"),
    papel: form.get("papel"),
    ativa: form.get("ativa") === "on",
  };
}

const exigeGrupoDre = (codigo: string, grupoDre?: string) =>
  codigo.startsWith("3") && !grupoDre ? "Contas analíticas de resultado (classe 3) exigem grupo DRE." : null;

/** Traduz unique violation do Postgres; relança o resto. */
function erroUnico(e: unknown): EstadoForm {
  const err = e as { code?: string; constraint_name?: string; cause?: { code?: string; constraint_name?: string } };
  const pg = err.cause ?? err;
  if (pg.code === "23505") {
    if (pg.constraint_name?.endsWith("_papel_unique")) return { erro: "Já existe uma conta com esse papel." };
    if (pg.constraint_name?.endsWith("_codigo_unique")) return { erro: "Código já existe." };
  }
  throw e;
}

class ErroRegra extends Error {}

export async function criarConta(empresaId: string, parentId: string, _prev: EstadoForm, form: FormData): Promise<EstadoForm> {
  await requireUser();
  const r = novaSchema.safeParse(ler(form));
  if (!r.success) return { erro: r.error.issues[0].message };
  const d = r.data;
  const semDre = exigeGrupoDre(d.codigo, d.grupoDre);
  if (semDre) return { erro: semDre };

  try {
    await db.transaction(async (tx) => {
      const [pai] = await tx
        .select()
        .from(planoContas)
        .where(and(eq(planoContas.id, parentId), eq(planoContas.empresaId, empresaId)))
        .for("update");
      if (!pai) throw new ErroRegra("Conta pai não encontrada.");
      const resto = d.codigo.slice(pai.codigo.length + 1);
      if (!d.codigo.startsWith(pai.codigo + ".") || !/^\d+$/.test(resto)) {
        throw new ErroRegra(`Código deve ser ${pai.codigo}.<número>.`);
      }
      if (pai.tipo === "analitica") {
        // Só analítica recebe partida: converter o pai em sintética exige que ele esteja limpo.
        const [p] = await tx.select({ id: partidas.id }).from(partidas).where(eq(partidas.contaId, pai.id)).limit(1);
        if (p) throw new ErroRegra("A conta pai já possui lançamentos.");
        const [b] = await tx.select({ id: contasBancarias.id }).from(contasBancarias).where(eq(contasBancarias.contaContabilId, pai.id)).limit(1);
        if (b) throw new ErroRegra("A conta pai está vinculada a uma conta bancária.");
        if (pai.papel) throw new ErroRegra("A conta pai tem papel definido; remova o papel antes de criar subcontas.");
        await tx.update(planoContas).set({ tipo: "sintetica" }).where(eq(planoContas.id, pai.id));
      }
      await tx.insert(planoContas).values({
        empresaId,
        parentId: pai.id,
        codigo: d.codigo,
        nome: d.nome,
        natureza: d.natureza,
        tipo: "analitica",
        grupoDre: d.grupoDre ?? null,
        papel: d.papel ?? null,
      });
    });
  } catch (e) {
    if (e instanceof ErroRegra) return { erro: e.message };
    return erroUnico(e);
  }
  revalidatePath(`/e/${empresaId}/plano-de-contas`);
  return { ok: true };
}

export async function atualizarConta(empresaId: string, contaId: string, _prev: EstadoForm, form: FormData): Promise<EstadoForm> {
  await requireUser();
  const r = edicaoSchema.safeParse(ler(form));
  if (!r.success) return { erro: r.error.issues[0].message };
  const d = r.data;
  const [conta] = await db
    .select({ codigo: planoContas.codigo, tipo: planoContas.tipo })
    .from(planoContas)
    .where(and(eq(planoContas.id, contaId), eq(planoContas.empresaId, empresaId)));
  if (!conta) return { erro: "Conta não encontrada." };
  if (conta.tipo === "analitica") {
    const semDre = exigeGrupoDre(conta.codigo, d.grupoDre);
    if (semDre) return { erro: semDre };
  } else if (d.papel) {
    return { erro: "Só contas analíticas podem ter papel." };
  }
  try {
    await db
      .update(planoContas)
      .set({ nome: d.nome, natureza: d.natureza, grupoDre: d.grupoDre ?? null, papel: d.papel ?? null, ativa: d.ativa })
      .where(eq(planoContas.id, contaId));
  } catch (e) {
    return erroUnico(e);
  }
  revalidatePath(`/e/${empresaId}/plano-de-contas`);
  return { ok: true };
}

export async function inativarConta(empresaId: string, contaId: string): Promise<EstadoForm> {
  await requireUser();
  await db
    .update(planoContas)
    .set({ ativa: false })
    .where(and(eq(planoContas.id, contaId), eq(planoContas.empresaId, empresaId)));
  revalidatePath(`/e/${empresaId}/plano-de-contas`);
  return { ok: true };
}
