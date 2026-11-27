"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { empresas } from "@/db/schema";
import { cents, fromCents, parseValorBR } from "@/lib/format";
import { chaveDocumento, contraparteDaNota, direcaoDaNota, documento } from "@/lib/notas";
import { chavesRegistradas, NotaDuplicada, registrarNota } from "@/lib/notas/registro";
import type { MovimentoCurtoPrazo } from "@/lib/parcelamentos";
import { cancelarParcelamento, criarParcelamento, transferirParaCurtoPrazo } from "@/lib/parcelamentos-registro";
import { cancelarTitulo, criarTitulo } from "@/lib/titulos";
import { TIPOS_RETENCAO } from "@/lib/tributos";
import { requireUser } from "@/supabase/server";
import { adiantamentosDoTitulo } from "@/lib/adiantamentos";
import { compensarAdiantamento, desfazerCompensacao, listarAdiantamentos } from "@/lib/adiantamentos-registro";
import type { EstadoForm } from "./empresas";

/** Mensagem do trigger/validação, sem SQL (Drizzle embrulha o erro do Postgres em `cause`). */
function mensagem(e: unknown, padrao: string) {
  const err = e as { message?: string; cause?: { message?: string } };
  const msg = err.cause?.message ?? err.message ?? "";
  return msg.replace(/^error:\s*/i, "") || padrao;
}
const ehUnica = (e: unknown) => (e as { cause?: { code?: string } }).cause?.code === "23505";

const uuid = z.uuid();
const valor = z.string().transform(parseValorBR).pipe(z.string().regex(/^\d+(\.\d{1,2})?$/, "Valor inválido (use até 2 casas decimais)."));
const valorPositivo = valor.refine((v) => Number(v) > 0, "Valor deve ser maior que zero.");
const data = z.iso.date("Data inválida.");
const dataOpcional = z.union([z.literal("").transform(() => null), z.iso.date("Vencimento inválido.")]).nullish().transform((v) => v ?? null);

const tituloSchema = z.object({
  tipo: z.enum(["receber", "pagar"], "Selecione o tipo."),
  contraparte: z.string().trim().min(1, "Informe a contraparte."),
  documento: z.string().trim().transform((s) => s || null),
  descricao: z.string().trim().min(1, "Informe a descrição."),
  valor: valorPositivo,
  competencia: z.iso.date("Informe a data do fato (competência)."),
  vencimento: dataOpcional,
  contaResultadoId: z.uuid("Selecione a contrapartida."),
});

/** Há adiantamento em aberto da contraparte (do tipo do título)? A tela avisa para compensar. */
async function temAdiantamento(empresaId: string, tipo: "receber" | "pagar", parte: { contraparte: string; contraparteDocumento?: string | null }) {
  return adiantamentosDoTitulo({ ...parte, tipo }, await listarAdiantamentos(db, empresaId)).length > 0;
}
const AVISO_ADIANTAMENTO = "Há adiantamento em aberto desta contraparte: compense em Títulos (botão Compensar na linha do título).";

export async function criarTituloAction(empresaId: string, _prev: EstadoForm, form: FormData): Promise<EstadoForm & { aviso?: string }> {
  const user = await requireUser();
  const str = (k: string) => (form.get(k) as string | null) ?? "";
  const r = tituloSchema.safeParse(Object.fromEntries(
    ["tipo", "contraparte", "documento", "descricao", "valor", "competencia", "vencimento", "contaResultadoId"].map((k) => [k, str(k)]),
  ));
  if (!r.success) return { erro: r.error.issues[0].message };
  if (r.data.vencimento && r.data.vencimento < r.data.competencia)
    return { erro: "Vencimento não pode ser anterior à competência." };
  try {
    await db.transaction((tx) => criarTitulo(tx, { ...r.data, empresaId, usuarioId: user.id }));
  } catch (e) {
    return { erro: mensagem(e, "Erro ao gravar o título.") };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  return { ok: true, aviso: (await temAdiantamento(empresaId, r.data.tipo, { contraparte: r.data.contraparte })) ? AVISO_ADIANTAMENTO : undefined };
}

export async function cancelarTituloAction(empresaId: string, tituloId: string): Promise<EstadoForm> {
  const user = await requireUser();
  try {
    await db.transaction((tx) => cancelarTitulo(tx, empresaId, tituloId, user.id));
  } catch (e) {
    return { erro: mensagem(e, "Erro ao cancelar o título.") };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  return { ok: true };
}

// ---------- notas fiscais ----------

const parteSchema = z.object({ documento: z.string().trim().max(20).transform(documento), nome: z.string().trim().max(200) });
const notaSchema = z.object({
  origem: z.enum(["manual", "nfe", "nfse"]),
  numero: z.string().trim().min(1, "Informe o número da nota.").max(30),
  serie: z.string().trim().max(10).nullish().transform((s) => s || null),
  emissao: data,
  competencia: z.string().regex(/^\d{4}-\d{2}$/, "Competência inválida.").transform((s) => `${s}-01`),
  emitente: parteSchema,
  destinatario: parteSchema.nullable(),
  bruto: valorPositivo,
  retencoes: z.array(z.object({ tipo: z.enum(TIPOS_RETENCAO), valor, contaId: uuid.nullish() })).max(10),
  contaResultadoId: z.uuid("Escolha a conta de receita ou de custo/despesa."),
  parcelas: z.array(z.object({ valor: valorPositivo, vencimento: dataOpcional })).min(1).max(120),
  descricao: z.string().trim().max(200).nullish(),
});
export type NotaInput = z.input<typeof notaSchema>;
export type ResultadoNota = { ok: true; titulos: number; adiantamento?: boolean } | { duplicada: true } | { erro: string };

async function cnpjDa(empresaId: string) {
  const [e] = await db.select({ cnpj: empresas.cnpj }).from(empresas).where(eq(empresas.id, empresaId));
  if (!e) throw new Error("Empresa não encontrada");
  return e.cnpj;
}

/** Chaves (da lista) que já têm título não cancelado na empresa: a revisão marca como duplicada. */
export async function chavesJaRegistradas(empresaId: string, chaves: string[]): Promise<string[]> {
  await requireUser();
  if (!uuid.safeParse(empresaId).success) return [];
  const ok = z.array(z.string().max(80)).max(500).safeParse(chaves);
  if (!ok.success) return [];
  return [...(await chavesRegistradas(db, empresaId, ok.data))];
}

/**
 * Registra as notas (XML revisado ou cadastro manual), cada uma na sua transação: a direção sai do CNPJ da empresa
 * (emitente → a receber, destinatário → a pagar); duplicada (mesma chave) é pulada.
 */
export async function registrarNotas(empresaId: string, notas: NotaInput[]): Promise<ResultadoNota[]> {
  const user = await requireUser();
  if (!uuid.safeParse(empresaId).success) return notas.map(() => ({ erro: "Empresa inválida." }));
  if (notas.length > 200) return notas.map(() => ({ erro: "Até 200 notas por vez." }));
  const cnpj = await cnpjDa(empresaId);
  const out: ResultadoNota[] = [];
  for (const bruta of notas) {
    const r = notaSchema.safeParse(bruta);
    if (!r.success) { out.push({ erro: r.error.issues[0].message }); continue; }
    const n = r.data;
    const tipo = direcaoDaNota(n, cnpj);
    if (!tipo) { out.push({ erro: "A empresa não é emitente nem destinatária desta nota (CNPJ)." }); continue; }
    // mesma chave para XML e cadastro manual: a nota registrada de um jeito não entra de novo pelo outro
    const chave = chaveDocumento(n.emitente.documento || n.emitente.nome, n.serie, n.numero);
    try {
      const ts = await db.transaction((tx) => registrarNota(tx, {
        empresaId, origem: n.origem, tipo, chave, numero: n.numero, serie: n.serie, emissao: n.emissao, competencia: n.competencia,
        contraparte: contraparteDaNota(n, tipo), bruto: fromCents(cents(n.bruto)), retencoes: n.retencoes,
        contaResultadoId: n.contaResultadoId, parcelas: n.parcelas, descricao: n.descricao, usuarioId: user.id,
      }));
      const parte = contraparteDaNota(n, tipo);
      out.push({ ok: true, titulos: ts.length, adiantamento: await temAdiantamento(empresaId, tipo, { contraparte: parte.nome, contraparteDocumento: parte.documento }) });
    } catch (e) {
      out.push(e instanceof NotaDuplicada || ehUnica(e) ? { duplicada: true } : { erro: mensagem(e, "Erro ao registrar a nota.") });
    }
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  return out;
}

// ---------- parcelamentos ----------

const parcelamentoSchema = z.object({
  descricao: z.string().trim().min(3, "Informe o tributo/origem do parcelamento.").max(120),
  principal: valor, multa: valor, juros: valor,
  nParcelas: z.coerce.number().int("Número de parcelas inválido.").min(1).max(240),
  valorParcela: valorPositivo,
  primeiroVencimento: data, data,
  contaPrincipalId: z.uuid("Escolha a conta do principal."),
  contaMultaId: uuid.nullable(), contaJurosId: uuid.nullable(),
  contaCpId: z.uuid("Escolha a conta de curto prazo."), contaLpId: z.uuid("Escolha a conta de longo prazo."),
  titulosIds: z.array(z.uuid()).max(200).optional(),
});
export type ParcelamentoForm = z.input<typeof parcelamentoSchema>;

export async function criarParcelamentoAction(empresaId: string, input: ParcelamentoForm): Promise<EstadoForm> {
  const user = await requireUser();
  const r = parcelamentoSchema.safeParse(input);
  if (!r.success) return { erro: r.error.issues[0].message };
  try {
    await db.transaction((tx) => criarParcelamento(tx, { ...r.data, empresaId, usuarioId: user.id }));
  } catch (e) {
    return { erro: mensagem(e, "Erro ao registrar o parcelamento.") };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  return { ok: true };
}

/** Prévia (aplicar = false) ou transferência LP → CP. `esperado`: total da prévia confirmada (recusa se mudou). */
export async function transferirCurtoPrazoAction(
  empresaId: string, input: { data: string; aplicar: boolean; esperado?: number },
): Promise<{ erro?: string; movimentos?: MovimentoCurtoPrazo[] }> {
  const user = await requireUser();
  const d = data.safeParse(input.data);
  if (!uuid.safeParse(empresaId).success || !d.success) return { erro: "Data inválida." };
  try {
    const movimentos = await db.transaction(async (tx) => {
      const ms = await transferirParaCurtoPrazo(tx, { empresaId, data: d.data, aplicar: input.aplicar, usuarioId: user.id });
      const total = ms.reduce((s, m) => s + m.valor, 0);
      if (input.aplicar && input.esperado !== undefined && total !== input.esperado)
        throw new Error("As parcelas mudaram desde a prévia: revise e confirme de novo");
      return ms;
    });
    if (input.aplicar) revalidatePath(`/e/${empresaId}`, "layout");
    return { movimentos };
  } catch (e) {
    return { erro: mensagem(e, "Erro ao transferir para o curto prazo.") };
  }
}

export async function cancelarParcelamentoAction(empresaId: string, id: string): Promise<EstadoForm> {
  const user = await requireUser();
  if (!uuid.safeParse(id).success) return { erro: "Parcelamento inválido." };
  try {
    await db.transaction((tx) => cancelarParcelamento(tx, empresaId, id, user.id));
  } catch (e) {
    return { erro: mensagem(e, "Erro ao cancelar o parcelamento.") };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  return { ok: true };
}

// ---------- adiantamentos ----------

const compensarSchema = z.object({
  tituloId: z.uuid("Título inválido."), adiantamentoId: z.uuid("Escolha o adiantamento."),
  valor: z.string().optional().transform((v) => (v?.trim() ? parseValorBR(v) : null))
    .pipe(z.string().regex(/^\d+(\.\d{1,2})?$/, "Valor inválido (use até 2 casas decimais).").nullable()),
});

/** Compensa o título com o adiantamento da contraparte (total ou parcial), na competência do título. */
export async function compensarAdiantamentoAction(empresaId: string, input: z.input<typeof compensarSchema>): Promise<EstadoForm> {
  const user = await requireUser();
  const r = compensarSchema.safeParse(input);
  if (!r.success) return { erro: r.error.issues[0].message };
  try {
    await db.transaction((tx) => compensarAdiantamento(tx, { ...r.data, empresaId, usuarioId: user.id }));
  } catch (e) {
    return { erro: mensagem(e, "Erro ao compensar.") };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  return { ok: true };
}

export async function desfazerCompensacaoAction(empresaId: string, lancamentoId: string): Promise<EstadoForm> {
  const user = await requireUser();
  if (!uuid.safeParse(lancamentoId).success) return { erro: "Compensação inválida." };
  try {
    await db.transaction((tx) => desfazerCompensacao(tx, empresaId, lancamentoId, user.id));
  } catch (e) {
    return { erro: mensagem(e, "Erro ao desfazer a compensação.") };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  return { ok: true };
}
