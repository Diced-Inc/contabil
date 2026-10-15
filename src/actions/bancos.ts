"use server";

import { and, eq, isNotNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { contasBancarias, importacoes, transacoesBancarias } from "@/db/schema";
import { contaAtivoAnaliticaValida, getContaBancaria } from "@/app/e/[id]/bancos/queries";
import { sugerirPendentes } from "@/lib/classificacao/pipeline";
import { normalizarIdOfx, parseOfx, type OfxExtrato } from "@/lib/ofx";
import { requireUser } from "@/supabase/server";
import type { EstadoForm } from "./empresas";

export type Sugestao = Awaited<ReturnType<typeof sugerirPendentes>>;
export type EstadoImportacao = EstadoForm & { novas?: number; repetidas?: number; sugestao?: Sugestao };

const MAX_OFX = 4 * 1024 * 1024; // corpo de função na Vercel: 4,5 MB
const LOTE = 1000; // linhas por INSERT (limite de parâmetros do Postgres)

const opcional = z.string().trim().transform((s) => s || null);
const contaSchema = z.object({
  nome: z.string().trim().min(1, "Informe o nome da conta."),
  banco: opcional,
  agencia: opcional,
  numero: opcional,
  ofxBankid: z.string().trim().min(1, "Informe o BANKID do OFX."),
  ofxAcctid: z.string().trim().min(1, "Informe o ACCTID do OFX."),
  contaContabilId: z.uuid("Selecione a conta contábil."),
});

function lerConta(form: FormData) {
  return contaSchema.safeParse({
    nome: form.get("nome") ?? "",
    banco: form.get("banco") ?? "",
    agencia: form.get("agencia") ?? "",
    numero: form.get("numero") ?? "",
    ofxBankid: form.get("ofxBankid") ?? "",
    ofxAcctid: form.get("ofxAcctid") ?? "",
    contaContabilId: form.get("contaContabilId") ?? "",
  });
}

function duplicada(e: unknown): EstadoForm {
  const err = e as { code?: string; cause?: { code?: string } };
  if ((err.cause?.code ?? err.code) === "23505") return { erro: "Já existe conta bancária com esse BANKID/ACCTID." };
  throw e;
}

const CONTA_INVALIDA = "A conta contábil precisa ser analítica, ativa e do Ativo (classe 1).";

export async function criarContaBancaria(empresaId: string, _prev: EstadoForm, form: FormData): Promise<EstadoForm> {
  await requireUser();
  const r = lerConta(form);
  if (!r.success) return { erro: r.error.issues[0].message };
  if (!(await contaAtivoAnaliticaValida(empresaId, r.data.contaContabilId))) return { erro: CONTA_INVALIDA };
  try {
    await db.insert(contasBancarias).values({ empresaId, ...r.data });
  } catch (e) {
    return duplicada(e);
  }
  revalidatePath(`/e/${empresaId}/bancos`);
  return { ok: true };
}

export async function atualizarContaBancaria(
  empresaId: string,
  contaBancariaId: string,
  _prev: EstadoForm,
  form: FormData,
): Promise<EstadoForm> {
  await requireUser();
  const r = lerConta(form);
  if (!r.success) return { erro: r.error.issues[0].message };
  const atual = await getContaBancaria(empresaId, contaBancariaId);
  if (!atual) return { erro: "Conta bancária não encontrada." };
  if (r.data.contaContabilId !== atual.contaContabilId) {
    if (!(await contaAtivoAnaliticaValida(empresaId, r.data.contaContabilId))) return { erro: CONTA_INVALIDA };
    // Lançamentos de conciliação já usam a conta contábil antiga; trocar quebraria a conferência de saldo.
    const [t] = await db
      .select({ id: transacoesBancarias.id })
      .from(transacoesBancarias)
      .where(and(eq(transacoesBancarias.contaBancariaId, contaBancariaId), isNotNull(transacoesBancarias.lancamentoId)))
      .limit(1);
    if (t) return { erro: "A conta já tem transações conciliadas; a conta contábil não pode ser trocada." };
  }
  try {
    await db
      .update(contasBancarias)
      .set({ ...r.data, ativa: form.get("ativa") === "on" })
      .where(eq(contasBancarias.id, contaBancariaId));
  } catch (e) {
    return duplicada(e);
  }
  revalidatePath(`/e/${empresaId}/bancos`);
  return { ok: true };
}

/** Data do saldo: DTASOF do LEDGERBAL; sem ela, DTEND; sem ela, a última transação (null se não houver). */
function dataDoSaldo(ext: OfxExtrato) {
  return ext.dataSaldo ?? ext.dtEnd ?? ext.transacoes.reduce<string | null>((m, t) => (!m || t.data > m ? t.data : m), null);
}

export async function importarOfx(empresaId: string, _prev: EstadoImportacao, form: FormData): Promise<EstadoImportacao> {
  await requireUser();
  const id = z.uuid().safeParse(form.get("contaBancariaId"));
  if (!id.success) return { erro: "Selecione a conta bancária." };
  const arquivo = form.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) return { erro: "Selecione o arquivo OFX." };
  if (arquivo.size > MAX_OFX) return { erro: "Arquivo maior que 4 MB." };

  const conta = await getContaBancaria(empresaId, id.data);
  if (!conta) return { erro: "Conta bancária não encontrada." };
  if (!conta.ativa) return { erro: "Conta bancária inativa." };

  let ext: OfxExtrato;
  try {
    ext = parseOfx(Buffer.from(await arquivo.arrayBuffer()));
  } catch (e) {
    return { erro: `Arquivo OFX inválido: ${(e as Error).message}.` };
  }
  if (
    normalizarIdOfx(ext.bankId) !== normalizarIdOfx(conta.ofxBankid) ||
    normalizarIdOfx(ext.acctId) !== normalizarIdOfx(conta.ofxAcctid)
  ) {
    return { erro: `Arquivo pertence a outra conta (banco ${ext.bankId}, conta ${ext.acctId}).` };
  }

  const novosIds = await db.transaction(async (tx) => {
    const [imp] = await tx
      .insert(importacoes)
      .values({
        contaBancariaId: conta.id,
        nomeArquivo: arquivo.name.slice(0, 200) || "extrato.ofx", // só exibição
        periodoInicio: ext.dtStart,
        periodoFim: ext.dtEnd,
        saldoFinal: ext.saldoFinal,
        dataSaldo: dataDoSaldo(ext),
        qtdTransacoes: ext.transacoes.length,
        qtdNovas: 0,
      })
      .returning({ id: importacoes.id });
    const ids: string[] = [];
    for (let i = 0; i < ext.transacoes.length; i += LOTE) {
      const inseridas = await tx
        .insert(transacoesBancarias)
        .values(
          ext.transacoes.slice(i, i + LOTE).map((t) => ({
            contaBancariaId: conta.id,
            importacaoId: imp.id,
            fitid: t.fitid,
            data: t.data,
            valor: t.valor,
            memo: t.memo,
            tipoOfx: t.tipo,
          })),
        )
        .onConflictDoNothing({ target: [transacoesBancarias.contaBancariaId, transacoesBancarias.fitid] })
        .returning({ id: transacoesBancarias.id });
      ids.push(...inseridas.map((t) => t.id));
    }
    await tx.update(importacoes).set({ qtdNovas: ids.length }).where(eq(importacoes.id, imp.id));
    return ids;
  });

  // A importação já está gravada: falha na sugestão vira aviso, nunca erro.
  let sugestao: Sugestao;
  try {
    sugestao = novosIds.length
      ? await sugerirPendentes(empresaId, novosIds)
      : { regras: 0, transferencias: 0, ia: 0, erros: [] };
  } catch (e) {
    sugestao = { regras: 0, transferencias: 0, ia: 0, erros: [(e as Error).message] };
  }

  revalidatePath(`/e/${empresaId}`, "layout");
  return { ok: true, novas: novosIds.length, repetidas: ext.transacoes.length - novosIds.length, sugestao };
}
