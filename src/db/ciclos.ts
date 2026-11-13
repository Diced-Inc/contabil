import { and, eq, sql } from "drizzle-orm";
import { enviarEmail, type Email } from "@/lib/email";
import { adminClient } from "@/supabase/admin";
import { createClient } from "@/supabase/server";
import { db } from ".";
import { ciclosMensais, notificacoes, type TipoNotificacao } from "./schema";

/** Envia e registra a tentativa (uma linha por ciclo/tipo/destinatário/dia; nova tentativa no mesmo dia atualiza). */
export async function notificar(
  base: { empresaId: string; cicloId: string; tipo: TipoNotificacao },
  para: string,
  email: Omit<Email, "para">,
) {
  const r = await enviarEmail({ para, ...email });
  if (r.status === "erro") console.error(`[notificacao] ${base.tipo} para ${para}:`, r.erro);
  const v = { status: r.status, resendId: r.id ?? null, erro: r.erro ?? null, assunto: email.assunto };
  await db
    .insert(notificacoes)
    .values({ ...base, para, ...v })
    .onConflictDoUpdate({
      target: [notificacoes.cicloId, notificacoes.tipo, notificacoes.para, notificacoes.dataRef],
      set: { ...v, createdAt: new Date() },
    });
  return r.status;
}

/** Ciclo da competência, criado na primeira vez que alguém precisa dele. */
export async function garantirCiclo(empresaId: string, competencia: string) {
  await db.insert(ciclosMensais).values({ empresaId, competencia }).onConflictDoNothing();
  const [c] = await db
    .select()
    .from(ciclosMensais)
    .where(and(eq(ciclosMensais.empresaId, empresaId), eq(ciclosMensais.competencia, competencia)));
  return c;
}

/**
 * Bucket "documentos": service role quando configurada; senão o client da sessão (policies por pode_acessar_empresa).
 * Quem chama já autorizou com requireMembro/requireUser.
 */
export async function bucketDocumentos() {
  return (adminClient() ?? (await createClient())).storage.from("documentos");
}

/** Metadados reais dos objetos já enviados (tamanho e MIME vêm do Storage, não do navegador). */
export async function objetosDocumentos(paths: string[]) {
  if (paths.length === 0) return new Map<string, { tamanho: number; mime: string }>();
  const linhas = await db.execute<{ name: string; tamanho: string | null; mime: string | null }>(sql`
    select name, metadata->>'size' as tamanho, metadata->>'mimetype' as mime
    from storage.objects where bucket_id = 'documentos' and name in ${paths}`);
  return new Map(linhas.map((l) => [l.name, { tamanho: Number(l.tamanho ?? 0), mime: l.mime ?? "application/octet-stream" }]));
}
