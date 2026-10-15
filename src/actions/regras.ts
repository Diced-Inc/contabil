"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { regras } from "@/db/schema";
import { contaAnaliticaValida } from "@/app/e/[id]/regras/queries";
import { valorDoPadrao } from "@/lib/classificacao/regras";
import { sugerirPendentes } from "@/lib/classificacao/pipeline";
import { somenteDigitos } from "@/lib/format";
import { requireUser } from "@/supabase/server";
import type { EstadoForm } from "./empresas";

const regraSchema = z.object({
  nome: z.string().trim().min(1, "Informe o nome da regra."),
  tipoMatch: z.enum(["memo_contem", "documento", "valor_exato"], "Selecione o tipo."),
  padrao: z.string().trim().min(1, "Informe o padrão."),
  sinal: z.enum(["entrada", "saida", "qualquer"], "Selecione o sinal."),
  contaId: z.uuid("Selecione a conta."),
  historicoTemplate: z.string().trim().min(1, "Informe o histórico."),
  prioridade: z.coerce.number("Prioridade inválida.").int("Prioridade deve ser inteira.").min(0, "Prioridade não pode ser negativa."),
});

type Leitura = { erro: string; data?: undefined } | { erro?: undefined; data: z.output<typeof regraSchema> };

async function lerRegra(empresaId: string, form: FormData): Promise<Leitura> {
  const r = regraSchema.safeParse({
    nome: form.get("nome") ?? "",
    tipoMatch: form.get("tipoMatch") ?? "",
    padrao: form.get("padrao") ?? "",
    sinal: form.get("sinal") ?? "",
    contaId: form.get("contaId") ?? "",
    historicoTemplate: form.get("historicoTemplate") ?? "",
    prioridade: form.get("prioridade") || 100,
  });
  if (!r.success) return { erro: r.error.issues[0].message };
  const { tipoMatch, padrao } = r.data;
  if (tipoMatch === "valor_exato" && !(valorDoPadrao(padrao) > 0))
    return { erro: "Para valor exato, o padrão deve ser um valor maior que zero (ex.: 1.500,00)." };
  if (tipoMatch === "documento" && !somenteDigitos(padrao))
    return { erro: "Para documento, o padrão deve conter os dígitos do CPF/CNPJ." };
  if (!(await contaAnaliticaValida(empresaId, r.data.contaId)))
    return { erro: "A conta precisa ser analítica, ativa e desta empresa." };
  return { data: r.data };
}

const daEmpresa = (empresaId: string, regraId: string) => and(eq(regras.id, regraId), eq(regras.empresaId, empresaId));

export async function criarRegra(empresaId: string, _prev: EstadoForm, form: FormData): Promise<EstadoForm> {
  await requireUser();
  const r = await lerRegra(empresaId, form);
  if (!r.data) return { erro: r.erro };
  await db.insert(regras).values({ empresaId, ...r.data });
  revalidatePath(`/e/${empresaId}/regras`);
  return { ok: true };
}

export async function atualizarRegra(empresaId: string, regraId: string, _prev: EstadoForm, form: FormData): Promise<EstadoForm> {
  await requireUser();
  const r = await lerRegra(empresaId, form);
  if (!r.data) return { erro: r.erro };
  const alteradas = await db
    .update(regras)
    .set({ ...r.data, ativa: form.get("ativa") === "on" })
    .where(daEmpresa(empresaId, regraId))
    .returning({ id: regras.id });
  if (!alteradas.length) return { erro: "Regra não encontrada." };
  revalidatePath(`/e/${empresaId}/regras`);
  return { ok: true };
}

/** Transações já sugeridas guardam só `sugestaoRegraId` (sem FK), então excluir é seguro. */
export async function excluirRegra(empresaId: string, regraId: string): Promise<EstadoForm> {
  await requireUser();
  const removidas = await db.delete(regras).where(daEmpresa(empresaId, regraId)).returning({ id: regras.id });
  if (!removidas.length) return { erro: "Regra não encontrada." };
  revalidatePath(`/e/${empresaId}/regras`);
  return { ok: true };
}

export type ResultadoAplicacao = EstadoForm & Partial<Awaited<ReturnType<typeof sugerirPendentes>>>;

export async function aplicarRegrasPendentes(empresaId: string): Promise<ResultadoAplicacao> {
  await requireUser();
  try {
    const r = await sugerirPendentes(empresaId, undefined, { ia: false });
    revalidatePath(`/e/${empresaId}`, "layout");
    return { ok: true, ...r };
  } catch (e) {
    return { erro: `Falha ao aplicar as regras: ${(e as Error).message}` };
  }
}
