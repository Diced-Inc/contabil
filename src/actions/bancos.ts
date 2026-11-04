"use server";

import { and, eq, isNotNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { contasBancarias, importacoes, mapeamentosCsv, transacoesBancarias } from "@/db/schema";
import { contaAtivoAnaliticaValida, getContaBancaria } from "@/app/e/[id]/bancos/queries";
import { sugerirPendentes } from "@/lib/classificacao/pipeline";
import { detectarCsv, parseCsv, type DeteccaoCsv, type ExtratoCsv, type MapeamentoCsv } from "@/lib/csv";
import { atribuirFitids } from "@/lib/dedup";
import { extrairExtratoPdf, type ExtratoIA } from "@/lib/extrato-ia";
import { normalizarIdOfx, parseOfx, type OfxExtrato } from "@/lib/ofx";
import { requireUser } from "@/supabase/server";
import type { EstadoForm } from "./empresas";

export type Sugestao = Awaited<ReturnType<typeof sugerirPendentes>>;

const MAX_OFX = 4_400_000; // decimal: abaixo dos 4,5 MB da Vercel em qualquer unidade; bodySizeLimit "4.4mb" (MiB) cobre o multipart
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

export type ResultadoArquivo = { erro: string } | { ok: true; novas: number; repetidas: number; ids: string[] };
type ContaBancaria = NonNullable<Awaited<ReturnType<typeof getContaBancaria>>>;

/** Conta da empresa, ativa; ou a mensagem de erro. */
async function contaParaImportar(empresaId: string, contaBancariaId: string): Promise<ContaBancaria | string> {
  await requireUser();
  const id = z.uuid().safeParse(contaBancariaId);
  if (!id.success) return "Selecione a conta bancária.";
  const conta = await getContaBancaria(empresaId, id.data);
  if (!conta) return "Conta bancária não encontrada.";
  if (!conta.ativa) return "Conta bancária inativa.";
  return conta;
}

function lerArquivo(form: FormData, rotulo: string): File | string {
  const arquivo = form.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) return `Selecione o arquivo ${rotulo}.`;
  if (arquivo.size > MAX_OFX) return "Arquivo maior que 4,4 MB.";
  return arquivo;
}

type Gravacao = {
  nomeArquivo: string;
  origem: "ofx" | "csv" | "pdf";
  periodoInicio: string | null;
  periodoFim: string | null;
  saldoFinal: string | null;
  dataSaldo: string | null;
  transacoes: { fitid: string; data: string; valor: string; memo: string; tipo: string | null }[];
};

/** Grava a importação e as transações novas (FITID repetido na conta é ignorado) numa transação de banco. */
async function gravarImportacao(conta: ContaBancaria, g: Gravacao): Promise<ResultadoArquivo> {
  const novosIds = await db.transaction(async (tx) => {
    const [imp] = await tx
      .insert(importacoes)
      .values({
        contaBancariaId: conta.id,
        nomeArquivo: g.nomeArquivo.slice(0, 200) || `extrato.${g.origem}`, // só exibição
        origem: g.origem,
        periodoInicio: g.periodoInicio,
        periodoFim: g.periodoFim,
        saldoFinal: g.saldoFinal,
        dataSaldo: g.dataSaldo,
        qtdTransacoes: g.transacoes.length,
        qtdNovas: 0,
      })
      .returning({ id: importacoes.id });
    const ids: string[] = [];
    for (let i = 0; i < g.transacoes.length; i += LOTE) {
      const inseridas = await tx
        .insert(transacoesBancarias)
        .values(
          g.transacoes.slice(i, i + LOTE).map((t) => ({
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
  return { ok: true, novas: novosIds.length, repetidas: g.transacoes.length - novosIds.length, ids: novosIds };
}

/** Importa um OFX (uma requisição por arquivo, por causa do limite de corpo da Vercel). A sugestão roda depois, em sugerirAposImportacao. */
export async function importarOfxArquivo(empresaId: string, contaBancariaId: string, form: FormData): Promise<ResultadoArquivo> {
  const conta = await contaParaImportar(empresaId, contaBancariaId);
  if (typeof conta === "string") return { erro: conta };
  const arquivo = lerArquivo(form, "OFX");
  if (typeof arquivo === "string") return { erro: arquivo };

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
  return gravarImportacao(conta, {
    nomeArquivo: arquivo.name,
    origem: "ofx",
    periodoInicio: ext.dtStart,
    periodoFim: ext.dtEnd,
    saldoFinal: ext.saldoFinal,
    dataSaldo: dataDoSaldo(ext),
    transacoes: ext.transacoes,
  });
}

const indice = z.number().int().min(0).max(200);
const mapeamentoSchema = z.object({
  linhaCabecalho: z.number().int().min(-1),
  separador: z.enum([";", ",", "\t"]),
  encoding: z.enum(["utf8", "latin1"]),
  data: indice,
  historico: z.array(indice).max(20),
  valor: indice.optional(),
  debito: indice.optional(),
  credito: indice.optional(),
  saldo: indice.optional(),
  formatoData: z.enum(["DMY", "YMD", "MDY"]),
  sinalInvertido: z.boolean().optional(),
});
/** Como fica gravado: o mapeamento + as colunas do cabeçalho, para reaplicar só em arquivos do mesmo layout. */
export type MapeamentoSalvo = MapeamentoCsv & { colunas: string[] };

/** Detecta o layout do CSV e devolve o mapeamento salvo da conta, se houver. Não grava nada. */
export async function analisarCsv(
  empresaId: string,
  contaBancariaId: string,
  form: FormData,
): Promise<{ erro: string } | { deteccao: DeteccaoCsv; mapeamentoSalvo: MapeamentoSalvo | null }> {
  const conta = await contaParaImportar(empresaId, contaBancariaId);
  if (typeof conta === "string") return { erro: conta };
  const arquivo = lerArquivo(form, "CSV");
  if (typeof arquivo === "string") return { erro: arquivo };
  const deteccao = detectarCsv(new Uint8Array(await arquivo.arrayBuffer()));
  if (deteccao.amostra.length === 0) return { erro: "Não encontrei linhas de dados no CSV." };
  const [m] = await db
    .select({ mapeamento: mapeamentosCsv.mapeamento })
    .from(mapeamentosCsv)
    .where(eq(mapeamentosCsv.contaBancariaId, conta.id));
  return { deteccao, mapeamentoSalvo: (m?.mapeamento as MapeamentoSalvo | undefined) ?? null };
}

export async function importarCsvArquivo(
  empresaId: string,
  contaBancariaId: string,
  form: FormData,
  mapeamento: MapeamentoSalvo,
  salvarMapeamento: boolean,
): Promise<ResultadoArquivo> {
  const conta = await contaParaImportar(empresaId, contaBancariaId);
  if (typeof conta === "string") return { erro: conta };
  const arquivo = lerArquivo(form, "CSV");
  if (typeof arquivo === "string") return { erro: arquivo };
  const mp = mapeamentoSchema.safeParse(mapeamento);
  if (!mp.success) return { erro: "Mapeamento de colunas inválido." };
  const colunas = z.array(z.string().max(200)).max(200).safeParse(mapeamento.colunas);

  let ext: ExtratoCsv;
  try {
    ext = parseCsv(new Uint8Array(await arquivo.arrayBuffer()), mp.data);
  } catch (e) {
    return { erro: `CSV inválido: ${(e as Error).message}.` };
  }
  if (ext.transacoes.length === 0) return { erro: "Nenhuma linha com data e valor válidos com esse mapeamento." };

  const r = await gravarImportacao(conta, {
    nomeArquivo: arquivo.name,
    origem: "csv",
    periodoInicio: ext.dtStart,
    periodoFim: ext.dtEnd,
    saldoFinal: ext.saldoFinal ?? null,
    dataSaldo: ext.dataSaldo ?? null,
    transacoes: atribuirFitids("csv", ext.transacoes).map((t) => ({ ...t, tipo: "CSV" })),
  });
  if (salvarMapeamento) {
    const valor = { ...mp.data, colunas: colunas.success ? colunas.data : [] };
    await db
      .insert(mapeamentosCsv)
      .values({ contaBancariaId: conta.id, nome: conta.banco ?? conta.nome, mapeamento: valor })
      .onConflictDoUpdate({ target: mapeamentosCsv.contaBancariaId, set: { mapeamento: valor, createdAt: new Date() } });
  }
  return r;
}

/** Extrai as linhas de um PDF de extrato com IA, para revisão. Não grava nada. */
export async function extrairPdf(empresaId: string, contaBancariaId: string, form: FormData): Promise<{ erro: string } | ExtratoIA> {
  const conta = await contaParaImportar(empresaId, contaBancariaId);
  if (typeof conta === "string") return { erro: conta };
  const arquivo = lerArquivo(form, "PDF");
  if (typeof arquivo === "string") return { erro: arquivo };
  try {
    return await extrairExtratoPdf(Buffer.from(await arquivo.arrayBuffer()));
  } catch (e) {
    return { erro: `Falha na extração: ${(e as Error).message}` };
  }
}

const linhaRevisada = z.object({
  data: z.iso.date(),
  memo: z.string().trim().max(500),
  valor: z.string().regex(/^-?\d+(\.\d{1,2})?$/, "Valor inválido.").refine((v) => Number(v) !== 0, "Valor zerado."),
});
const revisaoSchema = z.object({
  nomeArquivo: z.string().max(200),
  origem: z.enum(["pdf", "csv"]),
  linhas: z.array(linhaRevisada).min(1, "Nenhuma linha para importar.").max(20000),
  saldoFinal: z.string().regex(/^-?\d+(\.\d{1,2})?$/).optional(),
  dataSaldo: z.iso.date().optional(),
});

/** Grava linhas já revisadas na tela (PDF extraído por IA). Mesma deduplicação por data+valor+histórico. */
export async function importarLinhasRevisadas(
  empresaId: string,
  contaBancariaId: string,
  dados: z.input<typeof revisaoSchema>,
): Promise<ResultadoArquivo> {
  const conta = await contaParaImportar(empresaId, contaBancariaId);
  if (typeof conta === "string") return { erro: conta };
  const r = revisaoSchema.safeParse(dados);
  if (!r.success) {
    const i = r.error.issues[0];
    return { erro: i.path[0] === "linhas" && typeof i.path[1] === "number" ? `Linha ${i.path[1] + 1}: ${i.message}` : i.message };
  }
  const { linhas, origem } = r.data;
  const datas = linhas.map((l) => l.data).sort();
  const linhasComValor = linhas.map((l) => ({ ...l, valor: Number(l.valor).toFixed(2) }));
  return gravarImportacao(conta, {
    nomeArquivo: r.data.nomeArquivo,
    origem,
    periodoInicio: datas[0],
    periodoFim: datas[datas.length - 1],
    saldoFinal: r.data.saldoFinal ?? null,
    dataSaldo: r.data.saldoFinal ? (r.data.dataSaldo ?? datas[datas.length - 1]) : null,
    transacoes: atribuirFitids(origem, linhasComValor).map((t) => ({ ...t, tipo: origem.toUpperCase() })),
  });
}

/** Regras + transferências + IA (com o teto de sempre) uma única vez sobre as transações novas de todos os arquivos. */
export async function sugerirAposImportacao(empresaId: string, ids: string[]): Promise<Sugestao> {
  await requireUser();
  const r = z.array(z.uuid()).safeParse(ids);
  let sugestao: Sugestao = { regras: 0, transferencias: 0, ia: 0, erros: [] };
  // A importação já está gravada: falha na sugestão vira aviso, nunca erro.
  if (!r.success) sugestao.erros.push("IDs de transação inválidos.");
  else if (r.data.length) {
    try {
      sugestao = await sugerirPendentes(empresaId, r.data);
    } catch (e) {
      sugestao.erros.push((e as Error).message);
    }
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  return sugestao;
}
