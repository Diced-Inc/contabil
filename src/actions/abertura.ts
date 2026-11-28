"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { planoContas } from "@/db/schema";
import { patrimonial } from "@/lib/abertura";
import { salvarAbertura } from "@/lib/abertura-registro";
import { contaSobDemanda } from "@/lib/conciliacao";
import { cents, parseValorBR } from "@/lib/format";
import { requireUser } from "@/supabase/server";
import type { EstadoForm } from "./empresas";

/** Mensagem do trigger/validação, sem SQL (Drizzle embrulha o erro do Postgres em `cause`). */
function msg(e: unknown) {
  const err = e as { message?: string; cause?: { message?: string } };
  return (err.cause?.message ?? err.message ?? "").replace(/^error:\s*/i, "") || "Erro ao gravar os saldos iniciais.";
}

const valor = z.string().transform(parseValorBR).pipe(z.string().regex(/^(\d+(\.\d{1,2})?)?$/, "Valor inválido (use até 2 casas decimais)."));
const aberturaSchema = z.object({
  data: z.iso.date("Informe a data dos saldos iniciais."),
  saldos: z.array(z.object({ contaId: z.uuid(), debito: valor, credito: valor })),
  diferenca: z.boolean().optional(),
  confirmar: z.boolean().optional(),
});
export type AberturaInput = z.input<typeof aberturaSchema>;

export async function salvarAberturaAction(empresaId: string, input: AberturaInput): Promise<EstadoForm & { confirmar?: string; numero?: number }> {
  const user = await requireUser();
  const r = aberturaSchema.safeParse(input);
  if (!r.success || !z.uuid().safeParse(empresaId).success) return { erro: r.error?.issues[0].message ?? "Empresa inválida." };
  for (const s of r.data.saldos)
    if (cents(s.debito || 0) && cents(s.credito || 0)) return { erro: "Informe o saldo devedor OU o credor de cada conta." };
  try {
    const res = await db.transaction((tx) => salvarAbertura(tx, {
      empresaId, data: r.data.data, diferenca: r.data.diferenca, confirmar: r.data.confirmar, usuarioId: user.id,
      saldos: r.data.saldos.map((s) => ({ contaId: s.contaId, saldo: cents(s.debito || 0) - cents(s.credito || 0) })),
    }));
    if ("confirmar" in res) return { confirmar: res.confirmar };
    revalidatePath(`/e/${empresaId}`, "layout");
    return { ok: true, numero: res.lancamento.numero };
  } catch (e) {
    return { erro: msg(e) };
  }
}

const contaSchema = z.object({
  paiId: z.uuid("Escolha o grupo da conta."), nome: z.string().trim().min(1, "Informe o nome da conta."), natureza: z.enum(["D", "C"]),
});

/** Conta do balancete que falta no plano: analítica no próximo código livre do grupo (ou a ativa com o mesmo nome). */
export async function criarContaAberturaAction(empresaId: string, input: z.input<typeof contaSchema>) {
  await requireUser();
  const r = contaSchema.safeParse(input);
  if (!r.success) return { erro: r.error.issues[0].message };
  try {
    const conta = await db.transaction(async (tx) => {
      const [pai] = await tx.select({ codigo: planoContas.codigo }).from(planoContas)
        .where(and(eq(planoContas.id, r.data.paiId), eq(planoContas.empresaId, empresaId), eq(planoContas.tipo, "sintetica")));
      if (!pai || !patrimonial(pai.codigo)) throw new Error("Grupo inválido: escolha um grupo do Ativo, Passivo ou PL");
      return contaSobDemanda(tx, empresaId, { paiCodigo: pai.codigo, nome: r.data.nome, natureza: r.data.natureza, soNoPai: true });
    });
    revalidatePath(`/e/${empresaId}`, "layout");
    return { conta };
  } catch (e) {
    return { erro: msg(e) };
  }
}
