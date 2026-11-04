import { sql } from "drizzle-orm";
import { db } from "@/db";

// Supabase Free pausa o projeto após 7 dias sem atividade. A Vercel chama esta rota
// diariamente (vercel.json) com `Authorization: Bearer ${CRON_SECRET}`.
export async function GET(request: Request) {
  const esperado = process.env.CRON_SECRET;
  if (esperado && request.headers.get("authorization") !== `Bearer ${esperado}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const [row] = await db.execute<{ agora: string }>(sql`select now()::text as agora`);
  return Response.json({ ok: true, agora: row.agora });
}
