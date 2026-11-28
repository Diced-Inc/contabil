"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { parseValorBR } from "@/lib/format";
import { IDS_OPERACAO } from "@/lib/operacoes";
import {
  contrapartidas, efeitoLote, filtrarCandidatas, OPERACOES_LOTE, resumoLote, situacao, type ContaInfo,
} from "@/lib/reclassificacao";
import {
  baseSaldos, contextoLote, corrigirEstornosForaDoMes, desfazerLote, listarCandidatas, mensagem, reclassificarLote, type ResultadoLote,
} from "@/lib/reclassificacao-registro";
import { planoContas } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireUser } from "@/supabase/server";

const vazio = (s: string | undefined) => (s?.trim() ? s.trim() : undefined);
const txt = () => z.string().optional().transform(vazio);
const mes = z.string().regex(/^\d{4}-\d{2}$/, "Competência inválida.");
const valor = z.string().transform(parseValorBR).pipe(z.string().regex(/^\d+(\.\d{1,2})?$/, "Valor inválido."));

const filtroSchema = z.object({
  contaBancariaId: txt().pipe(z.uuid().optional()), contaId: txt().pipe(z.uuid().optional()),
  operacao: txt().pipe(z.enum(IDS_OPERACAO).optional()), memo: txt().pipe(z.string().max(200).optional()),
  sinal: txt().pipe(z.enum(["entrada", "saida"]).optional()), valorMin: txt().pipe(valor.optional()), valorMax: txt().pipe(valor.optional()),
  de: txt().pipe(z.iso.date("Data inválida.").optional()), ate: txt().pipe(z.iso.date("Data inválida.").optional()),
  compDe: txt().pipe(mes.optional()).transform((s) => (s ? `${s}-01` : undefined)),
  compAte: txt().pipe(mes.optional()).transform((s) => (s ? `${s}-01` : undefined)),
});
export type FiltroLoteInput = z.input<typeof filtroSchema>;

const alvoSchema = z.object({
  operacao: z.enum(OPERACOES_LOTE).nullable(),
  contaId: z.uuid().nullable(),
  competencia: mes.nullable().transform((s) => (s ? `${s}-01` : null)),
  confirmarSemTitulo: z.boolean().optional(),
}).refine((a) => a.operacao === "adiantamento" || !!a.contaId, "Escolha a conta de destino.");
export type AlvoInput = z.input<typeof alvoSchema>;

const motivoSchema = z.string().trim().min(5, "Informe o motivo (ao menos 5 caracteres): vai para o histórico de cada lançamento.").max(500);

/** Candidatas do filtro com a situação, os lançamentos de cada uma e o efeito nos saldos, DRE e Balanço (nada é gravado). */
export async function previaReclassificacao(empresaId: string, filtroIn: FiltroLoteInput, alvoIn: AlvoInput) {
  await requireUser();
  if (!z.uuid().safeParse(empresaId).success) return { erro: "Empresa inválida." };
  const f = filtroSchema.safeParse(filtroIn);
  if (!f.success) return { erro: f.error.issues[0].message };
  const a = alvoSchema.safeParse(alvoIn);
  if (!a.success) return { erro: a.error.issues[0].message };
  try {
    const [cs, ctx, base, contas] = await Promise.all([
      listarCandidatas(db, empresaId), contextoLote(db, empresaId), baseSaldos(db, empresaId),
      db.select({ id: planoContas.id, codigo: planoContas.codigo, nome: planoContas.nome, natureza: planoContas.natureza, papel: planoContas.papel })
        .from(planoContas).where(eq(planoContas.empresaId, empresaId)),
    ]);
    const mapa = new Map(contas.map((c) => [c.id, c]));
    const itens = filtrarCandidatas(cs, f.data, mapa).map((c) => situacao(c, a.data, ctx));
    const nome = (id: string) => { const c = mapa.get(id); return c ? `${c.codigo} ${c.nome}` : "?"; };
    return {
      itens: itens.map((i) => ({
        transacaoId: i.c.transacaoId, data: i.c.data, memo: i.c.memo, valor: i.c.valor, banco: i.c.contaBancariaNome,
        numero: i.c.numero, lancamentoId: i.c.lancamentoId, atual: contrapartidas(i.c).map((x) => nome(x.contaId)).join(" + "),
        tipo: i.tipo, motivo: i.motivo, lancs: i.lancs,
      })),
      resumo: resumoLote(itens, mapa),
      efeito: efeitoLote(itens, base, mapa as Map<string, ContaInfo>),
    };
  } catch (e) {
    return { erro: mensagem(e) };
  }
}
export type PreviaReclassificacao = Exclude<Awaited<ReturnType<typeof previaReclassificacao>>, { erro: string }>;

const execSchema = z.object({ transacaoIds: z.array(z.uuid()).min(1, "Nenhuma transação a reclassificar.").max(2000), alvo: alvoSchema, motivo: motivoSchema });

/** Cada transação na sua transação do Postgres; devolve feitas, puladas e erros com o motivo. */
export async function executarReclassificacao(empresaId: string, input: z.input<typeof execSchema>): Promise<{ erro: string } | ResultadoLote> {
  const user = await requireUser();
  if (!z.uuid().safeParse(empresaId).success) return { erro: "Empresa inválida." };
  const r = execSchema.safeParse(input);
  if (!r.success) return { erro: r.error.issues[0].message };
  try {
    return await reclassificarLote(db, { empresaId, ...r.data, usuarioId: user.id });
  } catch (e) {
    return { erro: mensagem(e) };
  } finally {
    revalidatePath(`/e/${empresaId}`, "layout");
  }
}

export async function desfazerLoteAction(empresaId: string, loteId: string, motivo: string): Promise<{ erro: string } | ResultadoLote> {
  const user = await requireUser();
  if (!z.uuid().safeParse(empresaId).success || !z.uuid().safeParse(loteId).success) return { erro: "Lote inválido." };
  const m = motivoSchema.safeParse(motivo);
  if (!m.success) return { erro: m.error.issues[0].message };
  try {
    return await desfazerLote(db, { empresaId, loteId, motivo: m.data, usuarioId: user.id });
  } catch (e) {
    return { erro: mensagem(e) };
  } finally {
    revalidatePath(`/e/${empresaId}`, "layout");
  }
}

/** "Corrigir" da checagem: estornos fora do mês do original voltam para a competência do original. */
export async function corrigirEstornosAction(empresaId: string, motivo: string): Promise<{ erro: string } | ResultadoLote> {
  const user = await requireUser();
  if (!z.uuid().safeParse(empresaId).success) return { erro: "Empresa inválida." };
  const m = motivoSchema.safeParse(motivo);
  if (!m.success) return { erro: m.error.issues[0].message };
  try {
    return await corrigirEstornosForaDoMes(db, { empresaId, motivo: m.data, usuarioId: user.id });
  } catch (e) {
    return { erro: mensagem(e) };
  } finally {
    revalidatePath(`/e/${empresaId}`, "layout");
  }
}
