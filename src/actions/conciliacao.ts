"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { contasBancarias, planoContas, transacoesBancarias } from "@/db/schema";
import { aplicarTemplate, valorDoPadrao } from "@/lib/classificacao/regras";
import { sugerirPendentes, type ResultadoSugestao } from "@/lib/classificacao/pipeline";
import {
  adiantarTransacao, alterarIgnorada, baixarTitulosPorTransacao, classificarTransacao, contaSobDemanda, desfazerConciliacao as desfazer, ErroSemTitulo,
  inserirRegra, lancarDireta, parearTransferenciaSemPar, previaZerarTransitoria, reclassificarTransacao, reconhecerEBaixar,
  transferirEntreContas, zerarTransitoria,
} from "@/lib/conciliacao";
import { NOME_OUTRA_CONTA } from "@/lib/classificacao/transferencias";
import { IDS_OPERACAO, NOMES_A_IDENTIFICAR, PAI_A_IDENTIFICAR } from "@/lib/operacoes";
import { contaDeTitulo } from "@/lib/sem-titulo";
import { cents, fmtCompetencia, fmtData, fromCents, parseValorBR, somenteDigitos } from "@/lib/format";
import { requireUser } from "@/supabase/server";
import type { EstadoForm } from "./empresas";

/** Mensagem do trigger/validação, sem SQL (Drizzle embrulha o erro do Postgres em `cause`). */
function msg(e: unknown) {
  const err = e as { message?: string; cause?: { message?: string } };
  return (err.cause?.message ?? err.message ?? "").replace(/^error:\s*/i, "") || "Erro ao conciliar.";
}

async function executar(empresaId: string, fn: (usuarioId: string) => Promise<unknown>): Promise<EstadoForm> {
  const user = await requireUser();
  try {
    await fn(user.id);
  } catch (e) {
    return { erro: msg(e) };
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  return { ok: true };
}

const uuid = z.uuid("Transação inválida.");
/** empresaId da URL: sem isso, um id malformado vira erro 500 do Postgres nos lotes. */
const empresaValida = (id: string) => z.uuid().safeParse(id).success;

const novaRegraSchema = z
  .object({
    nome: z.string().trim().min(1, "Informe o nome da regra."),
    tipoMatch: z.enum(["memo_contem", "documento", "valor_exato"], "Selecione o tipo da regra."),
    padrao: z.string().trim().min(1, "Informe o padrão da regra."),
    sinal: z.enum(["entrada", "saida", "qualquer"], "Selecione o sinal da regra."),
  })
  .optional()
  .refine((r) => r?.tipoMatch !== "valor_exato" || valorDoPadrao(r.padrao) > 0, "Para valor exato, o padrão deve ser um valor maior que zero.")
  .refine((r) => r?.tipoMatch !== "documento" || !!somenteDigitos(r.padrao), "Para documento, o padrão deve conter os dígitos do CPF/CNPJ.");

const classificacaoSchema = z.object({
  transacaoId: uuid,
  partidas: z
    .array(
      z.object({
        contaId: z.uuid("Selecione a conta em todas as linhas."),
        valor: z.string().transform(parseValorBR).pipe(z.string().regex(/^\d+(\.\d{1,2})?$/, "Valor inválido (use até 2 casas decimais).")),
      }),
    )
    .min(1, "Informe ao menos uma contrapartida."),
  historico: z.string().trim().min(3, "Histórico deve ter ao menos 3 caracteres."),
  documento: z.string().trim().optional().transform((s) => s || null),
  competencia: z
    .string()
    .regex(/^(\d{4}-\d{2})?$/, "Competência inválida.")
    .optional()
    .transform((s) => (s ? `${s}-01` : undefined)),
  criarRegra: novaRegraSchema,
  confirmarSemTitulo: z.boolean().optional(),
  operacao: z.enum(IDS_OPERACAO).optional(),
});
export type ClassificacaoInput = z.input<typeof classificacaoSchema>;

export async function aprovarClassificacao(empresaId: string, input: ClassificacaoInput): Promise<EstadoForm> {
  const r = classificacaoSchema.safeParse(input);
  if (!r.success) return { erro: r.error.issues[0].message };
  return executar(empresaId, (usuarioId) => db.transaction((tx) => classificarTransacao(tx, { ...r.data, empresaId, usuarioId })));
}

const reclassificacaoSchema = classificacaoSchema.omit({ criarRegra: true });
export type ReclassificacaoInput = z.input<typeof reclassificacaoSchema>;

/** Estorna o lançamento da conciliação e cria o novo na data do extrato (hoje se o mês estiver fechado). */
export async function reclassificar(empresaId: string, input: ReclassificacaoInput): Promise<EstadoForm & { aviso?: string }> {
  const r = reclassificacaoSchema.safeParse(input);
  if (!r.success) return { erro: r.error.issues[0].message };
  const fora: { d?: Awaited<ReturnType<typeof reclassificarTransacao>> } = {};
  const res = await executar(empresaId, async (usuarioId) => {
    fora.d = await db.transaction((tx) => reclassificarTransacao(tx, { ...r.data, empresaId, usuarioId }));
  });
  if (!fora.d) return res;
  const { extrato, novo, estorno } = fora.d;
  const quando = estorno === novo ? `estorno e novo lançamento em ${fmtData(novo)}` : `novo lançamento em ${fmtData(novo)}`;
  return { ...res, aviso: `Mês ${fmtCompetencia(extrato)} fechado: ${quando}, competência ${fmtCompetencia(r.data.competencia ?? extrato)}.` };
}

const valorSchema = z.string().transform(parseValorBR).pipe(z.string().regex(/^\d+(\.\d{1,2})?$/, "Valor inválido (use até 2 casas decimais)."));
const valorOpcional = z.string().optional().transform((v) => (v?.trim() ? parseValorBR(v) : "0"))
  .pipe(z.string().regex(/^\d+(\.\d{1,2})?$/, "Valor inválido (use até 2 casas decimais)."));
const contaOpcional = z.uuid().nullish().or(z.literal("").transform(() => null));

const baixaSchema = z.object({
  transacaoId: uuid,
  itens: z.array(z.object({ tituloId: z.uuid("Selecione o título."), valor: valorSchema, juros: valorOpcional, desconto: valorOpcional }))
    .min(1, "Selecione ao menos um título."),
  contaJurosId: contaOpcional,
  contaDescontoId: contaOpcional,
});
export type BaixaInput = z.input<typeof baixaSchema>;

/** Baixa total/parcial de um ou mais títulos pela transação. */
export async function baixarTitulosPelaTransacao(empresaId: string, input: BaixaInput): Promise<EstadoForm> {
  const r = baixaSchema.safeParse(input);
  if (!r.success) return { erro: r.error.issues[0].message };
  return executar(empresaId, (usuarioId) => db.transaction((tx) => baixarTitulosPorTransacao(tx, { ...r.data, empresaId, usuarioId })));
}

const competenciaMes = z.string().regex(/^\d{4}-\d{2}$/, "Competência inválida.").transform((s) => `${s}-01`);
const linhasSchema = classificacaoSchema.shape.partidas;

const reconhecerSchema = z.object({
  transacaoId: uuid,
  contraparte: z.string().trim().min(1, "Informe a contraparte.").max(200),
  descricao: z.string().trim().min(3, "Descrição deve ter ao menos 3 caracteres."),
  documento: z.string().trim().optional().transform((s) => s || null),
  competencia: competenciaMes,
  vencimento: z.union([z.literal("").transform(() => null), z.iso.date("Vencimento inválido.")]).optional(),
  linhas: linhasSchema,
});
export type ReconhecerInput = z.input<typeof reconhecerSchema>;

/** "Reconhecer agora": título(s) na competência + baixa pela transação. */
export async function reconhecerEBaixarAction(empresaId: string, input: ReconhecerInput): Promise<EstadoForm> {
  const r = reconhecerSchema.safeParse(input);
  if (!r.success) return { erro: r.error.issues[0].message };
  return executar(empresaId, (usuarioId) => db.transaction((tx) => reconhecerEBaixar(tx, { ...r.data, empresaId, usuarioId })));
}

const diretaSchema = z.object({
  transacaoId: uuid,
  partidas: linhasSchema,
  historico: z.string().trim().min(3, "Histórico deve ter ao menos 3 caracteres."),
  documento: z.string().trim().optional().transform((s) => s || null),
  competencia: competenciaMes,
  contraparte: z.string().trim().min(1, "Informe a contraparte.").max(200),
});
export type DiretaInput = z.input<typeof diretaSchema>;

/** Receita/despesa direta: um lançamento no mês do extrato, ou reconhecimento na competência + baixa. */
export async function lancarDiretaAction(empresaId: string, input: DiretaInput): Promise<EstadoForm & { aviso?: string }> {
  const r = diretaSchema.safeParse(input);
  if (!r.success) return { erro: r.error.issues[0].message };
  let separada = false;
  const res = await executar(empresaId, async (usuarioId) => {
    separada = (await db.transaction((tx) => lancarDireta(tx, { ...r.data, empresaId, usuarioId }))).separada;
  });
  return separada && res.ok
    ? { ...res, aviso: `Reconhecido em ${fmtCompetencia(r.data.competencia)} (título criado em Títulos) e baixado na data do extrato.` }
    : res;
}

const adiantamentoSchema = z.object({
  transacaoId: uuid,
  contraparte: z.string().trim().min(1, "Informe a contraparte (cliente ou fornecedor).").max(200),
  documento: z.string().trim().max(20).optional().transform((s) => s?.replace(/[^0-9A-Za-z]/g, "").toUpperCase() || null),
  historico: z.string().trim().min(3, "Histórico deve ter ao menos 3 caracteres."),
});
export type AdiantamentoInput = z.input<typeof adiantamentoSchema>;

/** Receita/despesa ainda não reconhecida: adiantamento de cliente (entrada) ou a fornecedor (saída), com a contraparte. */
export async function registrarAdiantamentoAction(empresaId: string, input: AdiantamentoInput): Promise<EstadoForm> {
  const r = adiantamentoSchema.safeParse(input);
  if (!r.success) return { erro: r.error.issues[0].message };
  return executar(empresaId, (usuarioId) => db.transaction((tx) => adiantarTransacao(tx, { ...r.data, empresaId, usuarioId })));
}

export async function marcarTransferencia(empresaId: string, input: { transacaoId: string; parId: string }): Promise<EstadoForm> {
  const r = z.object({ transacaoId: uuid, parId: z.uuid("Selecione a transação par.") }).safeParse(input);
  if (!r.success) return { erro: r.error.issues[0].message };
  return executar(empresaId, (usuarioId) => db.transaction((tx) => transferirEntreContas(tx, { ...r.data, empresaId, usuarioId })));
}

export async function ignorarTransacao(empresaId: string, transacaoId: string, motivo?: string): Promise<EstadoForm> {
  if (!uuid.safeParse(transacaoId).success) return { erro: "Transação inválida." };
  return executar(empresaId, () => db.transaction((tx) => alterarIgnorada(tx, empresaId, transacaoId, true, motivo?.trim())));
}

/** Ignora várias pendentes (ex.: linhas "SALDO TOTAL DISPONÍVEL DIA" do extrato); cada uma na sua transação do banco. */
export async function ignorarEmLote(empresaId: string, transacaoIds: string[], motivo?: string): Promise<{ ignoradas: number; erros: string[] }> {
  await requireUser();
  if (!empresaValida(empresaId)) return { ignoradas: 0, erros: ["Empresa inválida."] };
  const ids = z.array(z.uuid()).safeParse(transacaoIds);
  if (!ids.success || !ids.data.length) return { ignoradas: 0, erros: ["Nenhuma transação selecionada."] };
  let ignoradas = 0;
  const erros: string[] = [];
  for (const id of new Set(ids.data)) {
    try {
      await db.transaction((tx) => alterarIgnorada(tx, empresaId, id, true, motivo?.trim().slice(0, 500)));
      ignoradas++;
    } catch (e) {
      erros.push(`${id.slice(0, 8)}: ${msg(e)}`);
    }
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  return { ignoradas, erros };
}

export async function reativarTransacao(empresaId: string, transacaoId: string): Promise<EstadoForm> {
  if (!uuid.safeParse(transacaoId).success) return { erro: "Transação inválida." };
  return executar(empresaId, () => db.transaction((tx) => alterarIgnorada(tx, empresaId, transacaoId, false)));
}

const avisoReabertos = (n: number) =>
  n ? `${n} título(s) reaberto(s): o valor baixado por esta transação volta a ficar em aberto. Se o reconhecimento também estava errado, cancele o título em Títulos.` : undefined;

export async function desfazerConciliacao(empresaId: string, transacaoId: string): Promise<EstadoForm & { aviso?: string }> {
  if (!uuid.safeParse(transacaoId).success) return { erro: "Transação inválida." };
  let n = 0;
  const res = await executar(empresaId, async (usuarioId) => {
    n = (await db.transaction((tx) => desfazer(tx, empresaId, transacaoId, usuarioId))).titulosReabertos;
  });
  return { ...res, aviso: res.ok ? avisoReabertos(n) : undefined };
}

/** Cada transação na sua própria transação do banco; o par de uma transferência é desfeito junto. */
export async function desfazerEmLote(empresaId: string, transacaoIds: string[]): Promise<{ desfeitas: number; erros: string[]; aviso?: string }> {
  const user = await requireUser();
  if (!empresaValida(empresaId)) return { desfeitas: 0, erros: ["Empresa inválida."] };
  const ids = z.array(z.uuid()).safeParse(transacaoIds);
  if (!ids.success || !ids.data.length) return { desfeitas: 0, erros: ["Nenhuma transação selecionada."] };
  const txs = await db
    .select({ id: transacoesBancarias.id, memo: transacoesBancarias.memo, lancamentoId: transacoesBancarias.lancamentoId })
    .from(transacoesBancarias)
    .innerJoin(contasBancarias, eq(contasBancarias.id, transacoesBancarias.contaBancariaId))
    .where(and(eq(contasBancarias.empresaId, empresaId), inArray(transacoesBancarias.id, ids.data)));
  let desfeitas = 0;
  let reabertos = 0;
  const erros: string[] = [];
  const feitos = new Set<string>();
  for (const t of txs) {
    if (t.lancamentoId && feitos.has(t.lancamentoId)) continue;
    try {
      reabertos += (await db.transaction((tx) => desfazer(tx, empresaId, t.id, user.id))).titulosReabertos;
      if (t.lancamentoId) feitos.add(t.lancamentoId);
      desfeitas++;
    } catch (e) {
      erros.push(`${t.memo.slice(0, 40) || t.id.slice(0, 8)}: ${msg(e)}`);
    }
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  return { desfeitas, erros, aviso: avisoReabertos(reabertos) };
}

/** semTitulo: sugestões da IA em Clientes puladas por falta de confirmação; diretas: aprovadas direto em conta de título. */
export type ResultadoAprovacao = { aprovadas: number; puladas: number; semTitulo: number; diretas: number; erros: string[] };

/**
 * Aprova sugestões de regra, transferência e IA; cada transação na sua própria transação do banco.
 * `minConfiancaIa`: sugestões de IA abaixo do limite ficam pendentes e entram em `puladas`.
 */
export async function aprovarEmLote(
  empresaId: string,
  transacaoIds: string[],
  opcoes: { minConfiancaIa?: number; confirmarSemTitulo?: boolean } = {},
): Promise<ResultadoAprovacao> {
  const user = await requireUser();
  const vazio = { aprovadas: 0, puladas: 0, semTitulo: 0, diretas: 0 };
  if (!empresaValida(empresaId)) return { ...vazio, erros: ["Empresa inválida."] };
  const ids = z.array(z.uuid()).safeParse(transacaoIds);
  if (!ids.success || !ids.data.length) return { ...vazio, erros: ["Nenhuma transação selecionada."] };
  const min = z.number().min(0).max(1).optional().safeParse(opcoes.minConfiancaIa);
  if (!min.success) return { ...vazio, erros: ["Confiança mínima inválida."] };
  const txs = await db
    .select({
      id: transacoesBancarias.id, memo: transacoesBancarias.memo, valor: transacoesBancarias.valor,
      sugestaoOrigem: transacoesBancarias.sugestaoOrigem, sugestaoContaId: transacoesBancarias.sugestaoContaId,
      sugestaoHistorico: transacoesBancarias.sugestaoHistorico, transferenciaParId: transacoesBancarias.transferenciaParId,
      sugestaoConfianca: transacoesBancarias.sugestaoConfianca,
      contaCodigo: planoContas.codigo, contaNome: planoContas.nome, contaPapel: planoContas.papel,
    })
    .from(transacoesBancarias)
    .innerJoin(contasBancarias, eq(contasBancarias.id, transacoesBancarias.contaBancariaId))
    .leftJoin(planoContas, eq(planoContas.id, transacoesBancarias.sugestaoContaId))
    .where(and(eq(contasBancarias.empresaId, empresaId), inArray(transacoesBancarias.id, ids.data)));

  let aprovadas = 0;
  let puladas = 0;
  let semTitulo = 0;
  let diretas = 0;
  const erros: string[] = [];
  const feitas = new Set<string>();
  for (const t of txs) {
    if (feitas.has(t.id)) continue;
    if (t.sugestaoOrigem === "ia" && min.data !== undefined && Number(t.sugestaoConfianca ?? 0) < min.data) {
      puladas++;
      continue;
    }
    try {
      if ((t.sugestaoOrigem === "regra" || t.sugestaoOrigem === "ia") && t.sugestaoContaId) {
        const contaId = t.sugestaoContaId;
        await db.transaction((tx) =>
          classificarTransacao(tx, {
            empresaId, transacaoId: t.id, usuarioId: user.id,
            partidas: [{ contaId, valor: fromCents(Math.abs(cents(t.valor))) }],
            historico: t.sugestaoHistorico || t.memo || "Conciliação bancária",
            // regra = decisão do contador; sugestão da IA em Clientes precisa da confirmação
            confirmarSemTitulo: t.sugestaoOrigem === "regra" || !!opcoes.confirmarSemTitulo,
          }),
        );
        if (t.contaCodigo && contaDeTitulo({ codigo: t.contaCodigo, nome: t.contaNome ?? "", papel: t.contaPapel })) diretas++;
      } else if (t.sugestaoOrigem === "transferencia" && t.transferenciaParId) {
        const parId = t.transferenciaParId;
        await db.transaction((tx) => transferirEntreContas(tx, { empresaId, transacaoId: t.id, parId, usuarioId: user.id }));
        feitas.add(parId);
      } else {
        throw new Error("Sem sugestão para aprovar");
      }
      feitas.add(t.id);
      aprovadas++;
    } catch (e) {
      if (e instanceof ErroSemTitulo) semTitulo++;
      else erros.push(`${t.memo.slice(0, 40) || t.id.slice(0, 8)}: ${msg(e)}`);
    }
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  return { aprovadas, puladas, semTitulo, diretas, erros };
}

const loteSchema = z.object({
  transacaoIds: z.array(z.uuid()).min(1, "Nenhuma transação selecionada."),
  contaId: z.uuid("Selecione a contrapartida."),
  historicoTemplate: z.string().trim().min(1, "Informe o histórico."),
  documento: z.string().trim().nullish().transform((s) => s || null),
  competencia: z.string().regex(/^\d{4}-\d{2}$/, "Competência inválida.").nullish(),
  criarRegra: novaRegraSchema,
  confirmarSemTitulo: z.boolean().optional(),
});
export type ClassificacaoLoteInput = z.input<typeof loteSchema>;

/** Mesma contrapartida para várias transações do mesmo sinal; cada uma na sua própria transação do banco. */
export async function classificarEmLote(empresaId: string, input: ClassificacaoLoteInput): Promise<{ aprovadas: number; erros: string[] }> {
  const user = await requireUser();
  if (!empresaValida(empresaId)) return { aprovadas: 0, erros: ["Empresa inválida."] };
  const r = loteSchema.safeParse(input);
  if (!r.success) return { aprovadas: 0, erros: [r.error.issues[0].message] };
  const { transacaoIds, contaId, historicoTemplate, documento, competencia, criarRegra, confirmarSemTitulo } = r.data;
  const encontradas = await db
    .select({
      id: transacoesBancarias.id, memo: transacoesBancarias.memo, valor: transacoesBancarias.valor,
      data: transacoesBancarias.data, status: transacoesBancarias.status,
    })
    .from(transacoesBancarias)
    .innerJoin(contasBancarias, eq(contasBancarias.id, transacoesBancarias.contaBancariaId))
    .where(and(eq(contasBancarias.empresaId, empresaId), inArray(transacoesBancarias.id, transacaoIds)));
  const porId = new Map(encontradas.map((t) => [t.id, t]));
  const txs = [...new Set(transacaoIds)].flatMap((id) => porId.get(id) ?? []);
  if (!txs.length) return { aprovadas: 0, erros: ["Nenhuma transação encontrada."] };

  const entrada = cents(txs[0].valor) > 0;
  let aprovadas = 0;
  const erros: string[] = [];
  for (const t of txs) {
    try {
      if (t.status !== "pendente") throw new Error("Transação não está mais pendente");
      if (cents(t.valor) > 0 !== entrada) throw new Error(entrada ? "Não é entrada" : "Não é saída");
      await db.transaction((tx) =>
        classificarTransacao(tx, {
          empresaId, transacaoId: t.id, usuarioId: user.id, documento,
          partidas: [{ contaId, valor: fromCents(Math.abs(cents(t.valor))) }],
          historico: aplicarTemplate(historicoTemplate, t).trim() || "Conciliação bancária",
          competencia: competencia ? `${competencia}-01` : undefined, confirmarSemTitulo,
        }),
      );
      aprovadas++;
    } catch (e) {
      erros.push(`${t.memo.slice(0, 40) || t.id.slice(0, 8)}: ${msg(e)}`);
    }
  }
  // regra só depois que ao menos uma classificou: lote todo com erro não deixa regra órfã
  if (criarRegra && aprovadas) {
    try {
      await db.transaction((tx) => inserirRegra(tx, empresaId, criarRegra, contaId, historicoTemplate));
    } catch (e) {
      erros.push(`Regra: ${msg(e)}`);
    }
  }
  revalidatePath(`/e/${empresaId}`, "layout");
  return { aprovadas, erros };
}

export async function sugerirComIA(empresaId: string): Promise<ResultadoSugestao> {
  await requireUser();
  const r = await sugerirPendentes(empresaId);
  revalidatePath(`/e/${empresaId}`, "layout");
  return r;
}

export async function parearSemPar(empresaId: string, input: { transacaoId: string; parId: string }): Promise<EstadoForm> {
  const r = z.object({ transacaoId: uuid, parId: z.uuid("Selecione a transação par.") }).safeParse(input);
  if (!r.success) return { erro: r.error.issues[0].message };
  return executar(empresaId, (usuarioId) => db.transaction((tx) => parearTransferenciaSemPar(tx, { ...r.data, empresaId, usuarioId })));
}

const dataSchema = z.iso.date("Informe a data.");

/** Saldo (centavos) da conta de transferências na data, para a prévia do "Zerar manualmente". */
export async function previaZerarTransferencias(empresaId: string, data: string): Promise<{ erro?: string; saldo?: number; contaId?: string }> {
  await requireUser();
  const d = dataSchema.safeParse(data);
  if (!empresaValida(empresaId) || !d.success) return { erro: "Data inválida." };
  try {
    const p = await db.transaction((tx) => previaZerarTransitoria(tx, empresaId, d.data));
    return { saldo: p.saldo, contaId: p.id };
  } catch (e) {
    return { erro: msg(e) };
  }
}

const zerarSchema = z.object({
  contaId: z.uuid("Selecione a contrapartida."),
  data: dataSchema,
  historico: z.string().trim().min(3, "Histórico deve ter ao menos 3 caracteres."),
  saldoEsperado: z.number().int(),
});

/** Lançamento manual que zera a transitória contra a conta escolhida (prévia confirmada em `saldoEsperado`). */
export async function zerarTransferencias(empresaId: string, input: z.input<typeof zerarSchema>): Promise<EstadoForm & { numero?: number }> {
  const r = zerarSchema.safeParse(input);
  if (!r.success) return { erro: r.error.issues[0].message };
  let numero: number | undefined;
  const res = await executar(empresaId, async (usuarioId) => {
    numero = (await db.transaction((tx) => zerarTransitoria(tx, { ...r.data, empresaId, usuarioId }))).numero;
  });
  return { ...res, numero };
}

/** Cria (ou devolve, se já existe) a analítica "Bancos – Outra Conta (a cadastrar)" no próximo código livre de 1.1.1. */
export async function criarContaOutroBanco(empresaId: string): Promise<{ erro?: string; conta?: { id: string; codigo: string; nome: string } }> {
  await requireUser();
  if (!empresaValida(empresaId)) return { erro: "Empresa inválida." };
  try {
    const conta = await db.transaction((tx) => contaSobDemanda(tx, empresaId, { paiCodigo: "1.1.1", nome: NOME_OUTRA_CONTA, natureza: "D" }));
    revalidatePath(`/e/${empresaId}`, "layout");
    return { conta };
  } catch (e) {
    return { erro: msg(e) };
  }
}

/** Cria (ou devolve) "Recebimentos a identificar" (2.1.5, entrada) ou "Pagamentos a identificar" (1.1.4, saída). */
export async function criarContaAIdentificar(empresaId: string, entrada: boolean): Promise<{ erro?: string; conta?: { id: string; codigo: string; nome: string; papel: string | null } }> {
  await requireUser();
  if (!empresaValida(empresaId)) return { erro: "Empresa inválida." };
  const lado = entrada ? "entrada" : "saida";
  try {
    const conta = await db.transaction((tx) => contaSobDemanda(tx, empresaId, {
      paiCodigo: PAI_A_IDENTIFICAR[lado].codigo, nome: NOMES_A_IDENTIFICAR[lado], natureza: PAI_A_IDENTIFICAR[lado].natureza,
    }));
    revalidatePath(`/e/${empresaId}`, "layout");
    return { conta };
  } catch (e) {
    return { erro: msg(e) };
  }
}
