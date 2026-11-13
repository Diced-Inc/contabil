"use server";

import { randomUUID } from "node:crypto";
import { and, eq, isNotNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { db } from "@/db";
import { bucketDocumentos, garantirCiclo, notificar, objetosDocumentos } from "@/db/ciclos";
import {
  ciclosMensais, contadores, contasBancarias, documentosRecebidos, empresas, importacoes, membros, type CicloMensal,
} from "@/db/schema";
import {
  competenciaAtual, MAX_DOCUMENTO, mimeDocumento, nomeCompetencia, nomeParaPath, proximoStatus, TransicaoInvalida,
  type EventoCiclo,
} from "@/lib/ciclo";
import { emailDasDisponivel, emailExtratoRecebido } from "@/lib/email";
import { hoje, parseValorBR } from "@/lib/format";
import { requireMembro, requireUser } from "@/supabase/server";

export type Resultado<T = object> = { erro: string } | ({ ok: true } & T);
type Envio = { path: string; token: string; mime: string };

const uuid = z.uuid();
const competenciaSchema = z.iso.date().refine((d) => d.endsWith("-01"), "Competência inválida.");
const pasta = (empresaId: string, competencia: string) => `${empresaId}/${competencia.slice(0, 7)}/`;

async function siteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL || (await headers()).get("origin") || "";
}

async function nomeEmpresa(empresaId: string) {
  const [e] = await db.select({ nome: empresas.razaoSocial }).from(empresas).where(eq(empresas.id, empresaId));
  return e?.nome ?? "";
}

/**
 * Aplica um evento ao ciclo da competência com lock de linha: valida a transição e grava o novo status + campos extras.
 * `set` recebe o ciclo atual (para checagens) e devolve os campos a gravar.
 */
async function mudarCiclo(
  empresaId: string,
  competencia: string,
  evento: EventoCiclo,
  set: (c: CicloMensal) => Partial<CicloMensal> = () => ({}),
): Promise<Resultado<{ ciclo: CicloMensal }>> {
  await garantirCiclo(empresaId, competencia);
  try {
    const ciclo = await db.transaction(async (tx) => {
      const [c] = await tx
        .select()
        .from(ciclosMensais)
        .where(and(eq(ciclosMensais.empresaId, empresaId), eq(ciclosMensais.competencia, competencia)))
        .for("update");
      const status = proximoStatus(c.status, evento);
      const [novo] = await tx.update(ciclosMensais).set({ ...set(c), status }).where(eq(ciclosMensais.id, c.id)).returning();
      return novo;
    });
    return { ok: true, ciclo };
  } catch (e) {
    if (e instanceof TransicaoInvalida) return { erro: e.message };
    throw e;
  }
}

function revalidar(empresaId: string) {
  revalidatePath(`/portal/${empresaId}`);
  revalidatePath(`/e/${empresaId}`, "layout");
  revalidatePath("/");
}

/** URLs assinadas de upload (2 h) no Storage; o navegador envia direto, sem passar pelo limite de corpo da Vercel. */
async function urlsDeEnvio(paths: { path: string; mime: string }[]): Promise<Resultado<{ envios: Envio[] }>> {
  const bucket = await bucketDocumentos();
  const envios: Envio[] = [];
  for (const { path, mime } of paths) {
    const { data, error } = await bucket.createSignedUploadUrl(path);
    if (error) return { erro: `Não foi possível preparar o envio: ${error.message}` };
    envios.push({ path: data.path, token: data.token, mime });
  }
  return { ok: true, envios };
}

async function urlDeDownload(path: string, nome: string): Promise<Resultado<{ url: string }>> {
  const { data, error } = await (await bucketDocumentos()).createSignedUrl(path, 300, { download: nome });
  if (error) return { erro: `Não foi possível baixar: ${error.message}` };
  return { ok: true, url: data.signedUrl };
}

// ---------- Cliente (portal) ----------

const arquivosSchema = z
  .array(z.object({ nome: z.string().trim().min(1).max(200), tamanho: z.number().int().positive() }))
  .min(1, "Selecione ao menos um arquivo.")
  .max(20, "Envie até 20 arquivos por vez.");

/** Passo 1 do envio do cliente: valida os arquivos e devolve as URLs de upload da competência atual. */
export async function prepararEnvio(empresaId: string, arquivos: { nome: string; tamanho: number }[]): Promise<Resultado<{ envios: Envio[] }>> {
  await requireMembro(empresaId);
  const r = arquivosSchema.safeParse(arquivos);
  if (!r.success) return { erro: r.error.issues[0].message };
  for (const a of r.data) {
    if (!mimeDocumento(a.nome)) return { erro: `${a.nome}: formato não aceito (use OFX, CSV, PDF, PNG ou JPG).` };
    if (a.tamanho > MAX_DOCUMENTO) return { erro: `${a.nome}: maior que 10 MB.` };
  }
  const competencia = competenciaAtual(hoje());
  const ciclo = await garantirCiclo(empresaId, competencia);
  try {
    proximoStatus(ciclo.status, "extrato_enviado");
  } catch (e) {
    return { erro: (e as Error).message };
  }
  return urlsDeEnvio(
    r.data.map((a) => ({ path: `${pasta(empresaId, competencia)}${randomUUID()}-${nomeParaPath(a.nome)}`, mime: mimeDocumento(a.nome)! })),
  );
}

const registroSchema = z.object({
  arquivos: z.array(z.object({ path: z.string().max(400), nome: z.string().trim().min(1).max(200) })).min(1).max(20),
  contaBancariaId: uuid.nullable(),
  observacao: z.string().trim().max(1000).transform((s) => s || null),
});

/** Passo 2: confere que os arquivos chegaram ao Storage, grava os documentos, avança o ciclo e avisa o contador. */
export async function registrarEnvio(empresaId: string, dados: z.input<typeof registroSchema>): Promise<Resultado<{ qtd: number }>> {
  const { user } = await requireMembro(empresaId);
  const r = registroSchema.safeParse(dados);
  if (!r.success) return { erro: "Dados do envio inválidos." };
  const { arquivos, contaBancariaId, observacao } = r.data;
  const competencia = competenciaAtual(hoje());
  const prefixo = pasta(empresaId, competencia);
  if (arquivos.some((a) => !a.path.startsWith(prefixo) || a.path.includes(".."))) return { erro: "Arquivo fora da pasta da empresa." };

  const objetos = await objetosDocumentos(arquivos.map((a) => a.path));
  const faltando = arquivos.find((a) => !objetos.has(a.path));
  if (faltando) return { erro: `O arquivo ${faltando.nome} não chegou. Tente de novo.` };

  if (contaBancariaId) {
    const [c] = await db
      .select({ id: contasBancarias.id })
      .from(contasBancarias)
      .where(and(eq(contasBancarias.id, contaBancariaId), eq(contasBancarias.empresaId, empresaId), eq(contasBancarias.ativa, true)));
    if (!c) return { erro: "Conta bancária não encontrada." };
  }

  const m = await mudarCiclo(empresaId, competencia, "extrato_enviado", (c) => ({ extratoRecebidoEm: c.extratoRecebidoEm ?? new Date() }));
  if ("erro" in m) return m;
  await db
    .insert(documentosRecebidos)
    .values(
      arquivos.map((a) => ({
        empresaId,
        cicloId: m.ciclo.id,
        contaBancariaId,
        nomeArquivo: a.nome,
        path: a.path,
        mime: objetos.get(a.path)!.mime,
        tamanho: objetos.get(a.path)!.tamanho,
        observacao,
        enviadoPor: user.id,
      })),
    )
    .onConflictDoNothing();

  const [empresa, site, lista] = await Promise.all([
    nomeEmpresa(empresaId),
    siteUrl(),
    db.select({ email: contadores.email }).from(contadores),
  ]);
  const email = emailExtratoRecebido({
    empresa,
    competencia: nomeCompetencia(competencia),
    arquivos: arquivos.map((a) => a.nome),
    quem: (user.user_metadata?.display_name as string | undefined) || user.email || "O cliente",
    observacao,
    link: `${site}/e/${empresaId}/documentos`,
  });
  await Promise.all(lista.map((c) => notificar({ empresaId, cicloId: m.ciclo.id, tipo: "extrato_recebido" }, c.email, email)));
  revalidar(empresaId);
  return { ok: true, qtd: arquivos.length };
}

/** Download de um documento recebido (cliente da empresa ou contador). */
export async function baixarDocumento(empresaId: string, documentoId: string): Promise<Resultado<{ url: string }>> {
  await requireMembro(empresaId);
  if (!uuid.safeParse(documentoId).success) return { erro: "Documento não encontrado." };
  const [d] = await db
    .select({ path: documentosRecebidos.path, nome: documentosRecebidos.nomeArquivo })
    .from(documentosRecebidos)
    .where(and(eq(documentosRecebidos.id, documentoId), eq(documentosRecebidos.empresaId, empresaId)));
  if (!d) return { erro: "Documento não encontrado." };
  return urlDeDownload(d.path, d.nome);
}

/** Download da guia do DAS da competência. */
export async function baixarDas(empresaId: string, competencia: string): Promise<Resultado<{ url: string }>> {
  await requireMembro(empresaId);
  if (!competenciaSchema.safeParse(competencia).success) return { erro: "Competência inválida." };
  const [c] = await db
    .select({ path: ciclosMensais.dasPath })
    .from(ciclosMensais)
    .where(and(eq(ciclosMensais.empresaId, empresaId), eq(ciclosMensais.competencia, competencia)));
  if (!c?.path) return { erro: "Guia do DAS não encontrada." };
  return urlDeDownload(c.path, `DAS-${competencia.slice(0, 7)}.pdf`);
}

/** "Já paguei" (cliente) ou "Marcar DAS como pago" (contador). */
export async function marcarDasPago(empresaId: string, competencia: string): Promise<Resultado> {
  const { user } = await requireMembro(empresaId);
  if (!competenciaSchema.safeParse(competencia).success) return { erro: "Competência inválida." };
  const m = await mudarCiclo(empresaId, competencia, "pagar", () => ({ dasPagoEm: new Date(), dasPagoPor: user.id }));
  if ("erro" in m) return m;
  revalidar(empresaId);
  return { ok: true };
}

// ---------- Contador ----------

/** Marca o documento como processado (com a importação que o consumiu, se houver) e põe o ciclo em processamento. */
export async function marcarProcessado(empresaId: string, documentoId: string, importacaoId: string | null = null): Promise<Resultado> {
  await requireUser();
  if (!uuid.safeParse(documentoId).success || (importacaoId && !uuid.safeParse(importacaoId).success)) return { erro: "Dados inválidos." };
  const [d] = await db
    .select({ cicloId: documentosRecebidos.cicloId, competencia: ciclosMensais.competencia })
    .from(documentosRecebidos)
    .innerJoin(ciclosMensais, eq(ciclosMensais.id, documentosRecebidos.cicloId))
    .where(and(eq(documentosRecebidos.id, documentoId), eq(documentosRecebidos.empresaId, empresaId)));
  if (!d) return { erro: "Documento não encontrado." };
  if (importacaoId) {
    const [i] = await db
      .select({ id: importacoes.id })
      .from(importacoes)
      .innerJoin(contasBancarias, eq(contasBancarias.id, importacoes.contaBancariaId))
      .where(and(eq(importacoes.id, importacaoId), eq(contasBancarias.empresaId, empresaId)));
    if (!i) return { erro: "Importação não encontrada." };
  }
  const m = await mudarCiclo(empresaId, d.competencia, "processar");
  if ("erro" in m) return m;
  await db
    .update(documentosRecebidos)
    .set({ processadoEm: new Date(), ...(importacaoId ? { importacaoId } : {}) })
    .where(eq(documentosRecebidos.id, documentoId));
  revalidar(empresaId);
  return { ok: true };
}

/** URL de upload da guia do DAS ({empresaId}/{AAAA-MM}/das-{uuid}.pdf). */
export async function prepararDas(empresaId: string, competencia: string): Promise<Resultado<{ envios: Envio[] }>> {
  await requireUser();
  if (!uuid.safeParse(empresaId).success || !competenciaSchema.safeParse(competencia).success) return { erro: "Competência inválida." };
  return urlsDeEnvio([{ path: `${pasta(empresaId, competencia)}das-${randomUUID()}.pdf`, mime: "application/pdf" }]);
}

const conclusaoSchema = z.object({
  path: z.string().max(400),
  valor: z
    .string()
    .transform(parseValorBR)
    .pipe(z.string().regex(/^\d+(\.\d{1,2})?$/, "Informe o valor do DAS.").refine((v) => Number(v) > 0, "Informe o valor do DAS.")),
  vencimento: z.iso.date("Informe o vencimento."),
  observacao: z.string().trim().max(1000).transform((s) => s || null),
});

/** "Concluir mês e enviar DAS": grava a guia, muda para das_enviado e avisa os clientes da empresa. */
export async function concluirCiclo(
  empresaId: string,
  competencia: string,
  dados: z.input<typeof conclusaoSchema>,
): Promise<Resultado<{ emails: { enviados: number; total: number; naoConfigurado: boolean } }>> {
  await requireUser();
  if (!uuid.safeParse(empresaId).success || !competenciaSchema.safeParse(competencia).success) return { erro: "Competência inválida." };
  const r = conclusaoSchema.safeParse(dados);
  if (!r.success) return { erro: r.error.issues[0].message };
  const { path, valor, vencimento, observacao } = r.data;
  if (!path.startsWith(`${pasta(empresaId, competencia)}das-`) || path.includes("..")) return { erro: "Guia inválida." };
  const obj = (await objetosDocumentos([path])).get(path);
  if (!obj) return { erro: "A guia não chegou. Envie o PDF de novo." };
  if (obj.mime !== "application/pdf") return { erro: "A guia precisa ser um PDF." };

  const anterior: { path: string | null } = { path: null };
  const m = await mudarCiclo(empresaId, competencia, "concluir", (c) => {
    anterior.path = c.dasPath;
    const agora = new Date();
    return {
      concluidoEm: agora, dasValor: valor, dasVencimento: vencimento, dasPath: path, dasEnviadoEm: agora,
      dasPagoEm: null, dasPagoPor: null, observacao,
    };
  });
  if ("erro" in m) return m;
  if (anterior.path && anterior.path !== path) await (await bucketDocumentos()).remove([anterior.path]); // guia de antes da reabertura

  const [empresa, site, clientes] = await Promise.all([
    nomeEmpresa(empresaId),
    siteUrl(),
    db
      .select({ email: membros.email })
      .from(membros)
      .where(and(eq(membros.empresaId, empresaId), isNotNull(membros.userId), isNotNull(membros.aceitoEm))),
  ]);
  const email = emailDasDisponivel({ empresa, competencia: nomeCompetencia(competencia), valor, vencimento, link: `${site}/portal/${empresaId}` });
  const status = await Promise.all(clientes.map((c) => notificar({ empresaId, cicloId: m.ciclo.id, tipo: "das_disponivel" }, c.email, email)));
  revalidar(empresaId);
  return {
    ok: true,
    emails: { enviados: status.filter((s) => s === "enviado").length, total: status.length, naoConfigurado: status.includes("nao_configurado") },
  };
}

/** Volta o ciclo para processamento (corrigir a guia, por exemplo). A guia atual continua até a próxima conclusão. */
export async function reabrirCiclo(empresaId: string, competencia: string): Promise<Resultado> {
  await requireUser();
  if (!uuid.safeParse(empresaId).success || !competenciaSchema.safeParse(competencia).success) return { erro: "Competência inválida." };
  const m = await mudarCiclo(empresaId, competencia, "reabrir", () => ({ concluidoEm: null, dasPagoEm: null, dasPagoPor: null }));
  if ("erro" in m) return m;
  revalidar(empresaId);
  return { ok: true };
}

