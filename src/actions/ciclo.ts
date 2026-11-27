"use server";

import { randomUUID } from "node:crypto";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { db, type Tx } from "@/db";
import { bucketDocumentos, garantirCiclo, notificar, objetosDocumentos } from "@/db/ciclos";
import {
  ciclosMensais, contadores, contasBancarias, documentosRecebidos, empresas, guias, importacoes, membros, type CicloMensal, type Guia,
} from "@/db/schema";
import {
  competenciaAtual, MAX_DOCUMENTO, mimeDocumento, MOTIVOS_ENCERRAMENTO, nomeCompetencia, nomeParaPath, proximoStatus, statusPelasGuias,
  TransicaoInvalida, type EventoCiclo, type MotivoEncerramento,
} from "@/lib/ciclo";
import { lerGuiaPdf, type Guia as GuiaLida } from "@/lib/das";
import { emailExtratoPorFora, emailExtratoRecebido, emailGuiaPaga, emailGuiasDisponiveis, type Email } from "@/lib/email";
import { fmtCnpj, hoje, parseValorBR } from "@/lib/format";
import { arquivoGuia, rotuloGuia, tipoDetectado, TIPOS_GUIA, type TipoGuia } from "@/lib/guias";
import { atualizarTituloDaGuia, cancelarTituloDaGuia, criarTituloDaGuia } from "@/lib/guia-titulo";
import { requireMembro, requireUser } from "@/supabase/server";
import type { User } from "@supabase/supabase-js";

export type Resultado<T = object> = { erro: string } | ({ ok: true } & T);
type Envio = { path: string; token: string; mime: string };

const uuid = z.uuid();
const competenciaSchema = z.iso.date().refine((d) => d.endsWith("-01"), "Competência inválida.");
const pasta = (empresaId: string, competencia: string) => `${empresaId}/${competencia.slice(0, 7)}/`;

async function siteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL || (await headers()).get("origin") || "";
}

const nomeDe = (user: User) => (user.user_metadata?.display_name as string | undefined) || user.email || "O cliente";
const linkFechamento = (site: string, empresaId: string, competencia: string) =>
  `${site}/e/${empresaId}/fechamento?ciclo=${competencia.slice(0, 7)}`;

/** E-mail para todos os contadores, registrado em notificacoes. */
async function avisarContadores(base: { empresaId: string; cicloId: string; tipo: "extrato_recebido" | "extrato_por_fora" | "das_pago" }, email: Omit<Email, "para">) {
  const lista = await db.select({ email: contadores.email }).from(contadores);
  await Promise.all(lista.map((c) => notificar(base, c.email, email)));
}

async function nomeEmpresa(empresaId: string) {
  const [e] = await db.select({ nome: empresas.razaoSocial }).from(empresas).where(eq(empresas.id, empresaId));
  return e?.nome ?? "";
}

/**
 * Aplica um evento ao ciclo da competência com lock de linha: valida a transição e grava o novo status + campos extras.
 * `set` recebe o ciclo atual e a transação (para checar e mexer nas guias; lança TransicaoInvalida para recusar) e devolve
 * os campos a gravar. Depois, o status considera as guias (statusPelasGuias: das_pago quando todas as enviadas estão pagas).
 */
async function mudarCiclo(
  empresaId: string,
  competencia: string,
  evento: EventoCiclo,
  set: (c: CicloMensal, tx: Tx) => Partial<CicloMensal> | Promise<Partial<CicloMensal>> = () => ({}),
): Promise<Resultado<{ ciclo: CicloMensal }>> {
  await garantirCiclo(empresaId, competencia);
  try {
    const ciclo = await db.transaction(async (tx) => {
      const [c] = await tx
        .select()
        .from(ciclosMensais)
        .where(and(eq(ciclosMensais.empresaId, empresaId), eq(ciclosMensais.competencia, competencia)))
        .for("update");
      const base = proximoStatus(c.status, evento);
      const campos = await set(c, tx);
      const gs = await tx.select({ enviadoEm: guias.enviadoEm, pagoEm: guias.pagoEm }).from(guias).where(eq(guias.cicloId, c.id));
      const [novo] = await tx
        .update(ciclosMensais)
        .set({ ...campos, status: statusPelasGuias(base, gs) })
        .where(eq(ciclosMensais.id, c.id))
        .returning();
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
  // guia-/das- são as guias do contador: o cliente não registra uma delas como documento seu.
  if (arquivos.some((a) => !a.path.startsWith(prefixo) || a.path.includes("..") || /^(guia|das)-/.test(a.path.slice(prefixo.length)))) return { erro: "Arquivo fora da pasta da empresa." };

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

  const [empresa, site] = await Promise.all([nomeEmpresa(empresaId), siteUrl()]);
  const email = emailExtratoRecebido({
    empresa,
    competencia: nomeCompetencia(competencia),
    arquivos: arquivos.map((a) => a.nome),
    quem: nomeDe(user),
    observacao,
    link: `${site}/e/${empresaId}/documentos`,
  });
  await avisarContadores({ empresaId, cicloId: m.ciclo.id, tipo: "extrato_recebido" }, email);
  revalidar(empresaId);
  return { ok: true, qtd: arquivos.length };
}

const notaSchema = z.string().trim().max(500).transform((s) => s || null);

/** "Já enviei por outro canal": o mês sai de aguardando extrato, guarda a nota e avisa os contadores. */
export async function avisarExtratoPorFora(empresaId: string, nota: string): Promise<Resultado> {
  const { user } = await requireMembro(empresaId);
  const r = notaSchema.safeParse(nota);
  if (!r.success) return { erro: "A nota passa de 500 caracteres." };
  const competencia = competenciaAtual(hoje());
  const m = await mudarCiclo(empresaId, competencia, "extrato_por_fora", () => ({ extratoRecebidoEm: new Date(), clienteObs: r.data }));
  if ("erro" in m) return m;
  const [empresa, site] = await Promise.all([nomeEmpresa(empresaId), siteUrl()]);
  const email = emailExtratoPorFora({
    empresa,
    mes: nomeCompetencia(competencia),
    quem: nomeDe(user),
    nota: r.data,
    link: linkFechamento(site, empresaId, competencia),
  });
  await avisarContadores({ empresaId, cicloId: m.ciclo.id, tipo: "extrato_por_fora" }, email);
  revalidar(empresaId);
  return { ok: true };
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

/** Guia da empresa com a competência do ciclo; null se não existe ou é de outra empresa. */
async function guiaDa(empresaId: string, guiaId: string) {
  if (!uuid.safeParse(guiaId).success) return null;
  const [g] = await db
    .select({ guia: guias, competencia: ciclosMensais.competencia })
    .from(guias)
    .innerJoin(ciclosMensais, eq(ciclosMensais.id, guias.cicloId))
    .where(and(eq(guias.id, guiaId), eq(guias.empresaId, empresaId)));
  return g ?? null;
}

/** Download de uma guia. O cliente só baixa as que já foram enviadas. */
export async function baixarGuia(empresaId: string, guiaId: string): Promise<Resultado<{ url: string }>> {
  const { papel } = await requireMembro(empresaId);
  const g = await guiaDa(empresaId, guiaId);
  if (!g || (papel === "cliente" && !g.guia.enviadoEm)) return { erro: "Guia não encontrada." };
  return urlDeDownload(g.guia.path, arquivoGuia(g.guia.tipo, g.competencia));
}

/** "Já paguei" (cliente, avisa os contadores por e-mail) ou "Marcar como paga" (contador), uma guia por vez. */
export async function marcarGuiaPaga(empresaId: string, guiaId: string): Promise<Resultado<{ todasPagas: boolean }>> {
  const { user, papel } = await requireMembro(empresaId);
  const g = await guiaDa(empresaId, guiaId);
  if (!g?.guia.enviadoEm) return { erro: "Guia não encontrada." };
  const paga: { guia?: Guia } = {};
  const m = await mudarCiclo(empresaId, g.competencia, "pagar", async (c, tx) => {
    [paga.guia] = await tx
      .update(guias)
      .set({ pagoEm: new Date(), pagoPor: user.id })
      .where(and(eq(guias.id, guiaId), eq(guias.cicloId, c.id), isNotNull(guias.enviadoEm), isNull(guias.pagoEm)))
      .returning();
    if (!paga.guia) throw new TransicaoInvalida("Esta guia já está paga.");
    return {};
  });
  if ("erro" in m) return m;
  const todasPagas = m.ciclo.status === "das_pago";
  if (papel === "cliente") {
    const [empresa, site, abertas] = await Promise.all([
      nomeEmpresa(empresaId),
      siteUrl(),
      db
        .select({ tipo: guias.tipo, descricao: guias.descricao })
        .from(guias)
        .where(and(eq(guias.cicloId, m.ciclo.id), isNotNull(guias.enviadoEm), isNull(guias.pagoEm))),
    ]);
    const email = emailGuiaPaga({
      empresa,
      competencia: nomeCompetencia(g.competencia),
      guia: { nome: rotuloGuia(paga.guia!), valor: paga.guia!.valor },
      faltam: abertas.map(rotuloGuia),
      quem: nomeDe(user),
      quando: paga.guia!.pagoEm!.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }),
      link: linkFechamento(site, empresaId, g.competencia),
    });
    await avisarContadores({ empresaId, cicloId: m.ciclo.id, tipo: "das_pago" }, email);
  }
  revalidar(empresaId);
  return { ok: true, todasPagas };
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

/** "Começar processamento" no fechamento: põe o ciclo em processamento sem precisar marcar um documento. */
export async function iniciarProcessamento(empresaId: string, competencia: string): Promise<Resultado> {
  await requireUser();
  if (!uuid.safeParse(empresaId).success || !competenciaSchema.safeParse(competencia).success) return { erro: "Competência inválida." };
  const m = await mudarCiclo(empresaId, competencia, "processar");
  if ("erro" in m) return m;
  revalidar(empresaId);
  return { ok: true };
}

const prefixoGuia = (empresaId: string, competencia: string) => `${pasta(empresaId, competencia)}guia-`;

/** URL de upload de uma guia ({empresaId}/{AAAA-MM}/guia-{uuid}.pdf). */
export async function prepararGuia(empresaId: string, competencia: string): Promise<Resultado<{ envios: Envio[] }>> {
  await requireUser();
  if (!uuid.safeParse(empresaId).success || !competenciaSchema.safeParse(competencia).success) return { erro: "Competência inválida." };
  return urlsDeEnvio([{ path: `${prefixoGuia(empresaId, competencia)}${randomUUID()}.pdf`, mime: "application/pdf" }]);
}

const pathGuia = (empresaId: string, competencia: string, path: string) =>
  path.startsWith(prefixoGuia(empresaId, competencia)) && !path.includes("..");

/** Confere que o PDF da guia chegou ao Storage, na pasta da competência. */
async function conferirPdf(empresaId: string, competencia: string, path: string): Promise<string | null> {
  if (!pathGuia(empresaId, competencia, path)) return "Guia inválida.";
  const obj = (await objetosDocumentos([path])).get(path);
  if (!obj) return "A guia não chegou. Envie o PDF de novo.";
  if (obj.mime !== "application/pdf") return "A guia precisa ser um PDF.";
  return null;
}

/**
 * Lê a guia que acabou de chegar ao Storage (o PDF não passa pela server action: limite de 4,5 MB da Vercel).
 * Devolve o que deu para ler, o tipo no vocabulário do sistema e avisos quando o CNPJ ou o período não batem.
 */
export async function lerGuiaEnviada(
  empresaId: string,
  competencia: string,
  path: string,
): Promise<Resultado<{ guia: GuiaLida; tipo: TipoGuia | null; fonte: "texto" | "ia" | null; avisos: string[] }>> {
  await requireUser();
  if (!uuid.safeParse(empresaId).success || !competenciaSchema.safeParse(competencia).success) return { erro: "Competência inválida." };
  if (!pathGuia(empresaId, competencia, path)) return { erro: "Guia inválida." };
  const [{ data, error }, [empresa]] = await Promise.all([
    (await bucketDocumentos()).download(path),
    db.select({ cnpj: empresas.cnpj, regime: empresas.regimeTributario }).from(empresas).where(eq(empresas.id, empresaId)),
  ]);
  if (error || !data || !empresa) return { erro: "Não foi possível abrir a guia enviada." };
  const { guia, fonte } = await lerGuiaPdf(new Uint8Array(await data.arrayBuffer()));
  const avisos: string[] = [];
  if (guia.cnpj && guia.cnpj !== empresa.cnpj.replace(/\D/g, "")) {
    avisos.push(`O CNPJ da guia (${fmtCnpj(guia.cnpj)}) não é o desta empresa (${fmtCnpj(empresa.cnpj)}). Confira se anexou a guia certa.`);
  }
  if (guia.periodo && guia.periodo !== competencia.slice(0, 7)) {
    avisos.push(`A guia é de ${nomeCompetencia(`${guia.periodo}-01`)}, mas você está anexando em ${nomeCompetencia(competencia)}.`);
  }
  return { ok: true, guia, tipo: tipoDetectado(guia, empresa.regime), fonte, avisos };
}

/** PDF anexado e abandonado (diálogo fechado sem salvar): apaga do Storage se nenhuma guia usa. */
export async function descartarGuiaEnviada(empresaId: string, competencia: string, path: string): Promise<Resultado> {
  await requireUser();
  if (!uuid.safeParse(empresaId).success || !competenciaSchema.safeParse(competencia).success) return { erro: "Competência inválida." };
  if (!pathGuia(empresaId, competencia, path)) return { erro: "Guia inválida." };
  const [usada] = await db.select({ id: guias.id }).from(guias).where(eq(guias.path, path));
  if (!usada) await (await bucketDocumentos()).remove([path]);
  return { ok: true };
}

const guiaSchema = z.object({
  tipo: z.enum(TIPOS_GUIA, "Escolha o tipo da guia."),
  descricao: z.string().trim().max(120).transform((s) => s || null),
  valor: z
    .string()
    .transform(parseValorBR)
    .pipe(z.string().regex(/^\d+(\.\d{1,2})?$/, "Informe o valor da guia.").refine((v) => Number(v) > 0, "Informe o valor da guia.")),
  vencimento: z.iso.date("Informe o vencimento."),
  codigoReceita: z.string().trim().max(20).transform((s) => s || null),
});
export type DadosGuia = z.input<typeof guiaSchema>;
const contasGuiaSchema = z.object({ obrigacaoId: z.uuid("Escolha a conta da obrigação."), despesaId: z.uuid("Escolha a conta da despesa.").nullable() }).nullish();
export type ContasGuia = z.input<typeof contasGuiaSchema>;

/** Erro do título da guia (validação, trigger) como recusa da transição: o mudarCiclo devolve a mensagem em vez de 500. */
async function obrigacao<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof TransicaoInvalida) throw e;
    const err = e as { message?: string; cause?: { message?: string } };
    throw new TransicaoInvalida((err.cause?.message ?? err.message ?? "Erro ao registrar a obrigação da guia.").replace(/^error:s*/i, ""));
  }
}

/**
 * Anexa (com `path` do upload) ou edita (com `guiaId`) uma guia do mês. Anexada fica como rascunho até "Concluir mês e enviar guias".
 * Guia paga não muda; mês encerrado não aceita mudanças. Já no upload a guia vira título a pagar (obrigação) na
 * competência; editar ajusta o título (estorno + novo, mês aberto).
 */
export async function salvarGuia(
  empresaId: string,
  competencia: string,
  alvo: { path: string } | { guiaId: string },
  dados: DadosGuia,
  contasGuia?: ContasGuia,
): Promise<Resultado<{ aviso?: string }>> {
  const user = await requireUser();
  const cg = contasGuiaSchema.safeParse(contasGuia);
  if (!cg.success) return { erro: cg.error.issues[0].message };
  if (!uuid.safeParse(empresaId).success || !competenciaSchema.safeParse(competencia).success) return { erro: "Competência inválida." };
  const r = guiaSchema.safeParse(dados);
  if (!r.success) return { erro: r.error.issues[0].message };
  if ("path" in alvo) {
    const erro = await conferirPdf(empresaId, competencia, alvo.path);
    if (erro) return { erro };
  } else if (!uuid.safeParse(alvo.guiaId).success) return { erro: "Guia não encontrada." };

  const titulo: { aviso?: string } = {};
  const m = await mudarCiclo(empresaId, competencia, "editar_guia", async (c, tx) => {
    const p = { empresaId, competencia, contas: cg.data, usuarioId: user.id };
    if ("path" in alvo) {
      const [g] = await tx.insert(guias).values({ ...r.data, cicloId: c.id, empresaId, path: alvo.path }).onConflictDoNothing().returning();
      if (g) Object.assign(titulo, await obrigacao(() => criarTituloDaGuia(tx, { ...p, guia: g })));
    } else {
      const [g] = await tx
        .update(guias)
        .set(r.data)
        .where(and(eq(guias.id, alvo.guiaId), eq(guias.cicloId, c.id), isNull(guias.pagoEm)))
        .returning();
      if (!g) throw new TransicaoInvalida("Guia não encontrada ou já paga.");
      Object.assign(titulo, await obrigacao(() => atualizarTituloDaGuia(tx, { ...p, guia: g })));
    }
    return {};
  });
  if ("erro" in m) return m;
  revalidar(empresaId);
  return { ok: true, aviso: titulo.aviso };
}

/** Remove uma guia que ainda não foi enviada ao cliente (registro e PDF) e cancela a obrigação dela (estorno). */
export async function removerGuia(empresaId: string, guiaId: string): Promise<Resultado> {
  const user = await requireUser();
  const g = await guiaDa(empresaId, guiaId);
  if (!g) return { erro: "Guia não encontrada." };
  const m = await mudarCiclo(empresaId, g.competencia, "editar_guia", async (c, tx) => {
    const [rascunho] = await tx.select({ id: guias.id }).from(guias)
      .where(and(eq(guias.id, guiaId), eq(guias.cicloId, c.id), isNull(guias.enviadoEm)));
    if (rascunho) await obrigacao(() => cancelarTituloDaGuia(tx, empresaId, guiaId, user.id));
    const [x] = await tx
      .delete(guias)
      .where(and(eq(guias.id, guiaId), eq(guias.cicloId, c.id), isNull(guias.enviadoEm)))
      .returning({ id: guias.id });
    if (!x) throw new TransicaoInvalida("Esta guia já foi enviada ao cliente. Reabra o mês para removê-la.");
    return {};
  });
  if ("erro" in m) return m;
  await (await bucketDocumentos()).remove([g.guia.path]);
  revalidar(empresaId);
  return { ok: true };
}

export type ResultadoEnvio = { qtd: number; emails: { enviados: number; total: number; naoConfigurado: boolean } };

/**
 * "Concluir mês e enviar guias": marca as guias ainda não enviadas, conclui o mês (das_enviado) e manda UM e-mail com elas.
 * Depois do primeiro envio, uma guia nova sai pelo mesmo caminho, num e-mail só com ela.
 */
export async function enviarGuias(empresaId: string, competencia: string): Promise<Resultado<ResultadoEnvio>> {
  await requireUser();
  if (!uuid.safeParse(empresaId).success || !competenciaSchema.safeParse(competencia).success) return { erro: "Competência inválida." };
  const envio: { guias: Guia[]; extra: boolean } = { guias: [], extra: false };
  const m = await mudarCiclo(empresaId, competencia, "concluir", async (c, tx) => {
    const agora = new Date();
    envio.extra = c.status === "das_enviado" || c.status === "das_pago";
    envio.guias = await tx
      .update(guias)
      .set({ enviadoEm: agora })
      .where(and(eq(guias.cicloId, c.id), isNull(guias.enviadoEm)))
      .returning();
    if (envio.guias.length === 0) {
      // Reaberto sem guia nova (todas pagas): conclui de novo sem e-mail. Sem guia nenhuma não há o que enviar.
      const [{ id } = { id: null }] = await tx.select({ id: guias.id }).from(guias).where(eq(guias.cicloId, c.id)).limit(1);
      if (!id) throw new TransicaoInvalida("Anexe ao menos uma guia antes de enviar.");
    }
    return { concluidoEm: c.concluidoEm ?? agora };
  });
  if ("erro" in m) return m;

  const enviadas = envio.guias.sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  const [empresa, site, clientes] = await Promise.all([
    nomeEmpresa(empresaId),
    siteUrl(),
    db
      .select({ email: membros.email })
      .from(membros)
      .where(and(eq(membros.empresaId, empresaId), isNotNull(membros.userId), isNotNull(membros.aceitoEm))),
  ]);
  const status = enviadas.length
    ? await Promise.all(
        clientes.map((c) =>
          notificar(
            { empresaId, cicloId: m.ciclo.id, tipo: "guias_disponiveis" },
            c.email,
            emailGuiasDisponiveis({
              empresa,
              competencia: nomeCompetencia(competencia),
              guias: enviadas.map((g) => ({ nome: rotuloGuia(g), valor: g.valor, vencimento: g.vencimento })),
              extra: envio.extra,
              link: `${site}/portal/${empresaId}`,
            }),
          ),
        ),
      )
    : [];
  revalidar(empresaId);
  return {
    ok: true,
    qtd: enviadas.length,
    emails: { enviados: status.filter((s) => s === "enviado").length, total: status.length, naoConfigurado: status.includes("nao_configurado") },
  };
}

const encerramentoSchema = z.object({
  motivo: z.enum(Object.keys(MOTIVOS_ENCERRAMENTO) as [MotivoEncerramento, ...MotivoEncerramento[]], "Escolha o motivo."),
  observacao: z.string().trim().max(1000).transform((s) => s || null),
});

/** "Encerrar mês sem guias": tira o mês das pendências e para os lembretes. Nenhum e-mail sai. */
export async function encerrarCiclo(empresaId: string, competencia: string, dados: z.input<typeof encerramentoSchema>): Promise<Resultado> {
  await requireUser();
  if (!uuid.safeParse(empresaId).success || !competenciaSchema.safeParse(competencia).success) return { erro: "Competência inválida." };
  const r = encerramentoSchema.safeParse(dados);
  if (!r.success) return { erro: r.error.issues[0].message };
  const m = await mudarCiclo(empresaId, competencia, "encerrar", () => ({
    encerradoEm: new Date(), encerradoMotivo: r.data.motivo, encerradoObs: r.data.observacao,
  }));
  if ("erro" in m) return m;
  revalidar(empresaId);
  return { ok: true };
}

/**
 * Volta o ciclo para processamento (corrigir guias ou desfazer o encerramento). As guias em aberto voltam a rascunho
 * (o cliente deixa de vê-las até o próximo envio); as pagas continuam pagas.
 */
export async function reabrirCiclo(empresaId: string, competencia: string): Promise<Resultado> {
  await requireUser();
  if (!uuid.safeParse(empresaId).success || !competenciaSchema.safeParse(competencia).success) return { erro: "Competência inválida." };
  const m = await mudarCiclo(empresaId, competencia, "reabrir", async (c, tx) => {
    await tx.update(guias).set({ enviadoEm: null }).where(and(eq(guias.cicloId, c.id), isNull(guias.pagoEm)));
    return { concluidoEm: null, encerradoEm: null, encerradoMotivo: null, encerradoObs: null };
  });
  if ("erro" in m) return m;
  revalidar(empresaId);
  return { ok: true };
}

