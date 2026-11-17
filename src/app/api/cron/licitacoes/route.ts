import { enviarAlertasLicitacoes, sincronizarLicitacoes, ufsParaSincronizar } from "@/db/licitacoes";

// A Vercel chama diariamente às 10:30 UTC (07:30 em Brasília) com `Authorization: Bearer ${CRON_SECRET}` (vercel.json).
// Sincroniza as UFs configuradas (o que faltar continua na próxima execução) e manda os alertas das buscas salvas.
export const maxDuration = 300;

export async function GET(request: Request) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || request.headers.get("authorization") !== `Bearer ${segredo}`) return new Response("Unauthorized", { status: 401 });
  const ufs = await ufsParaSincronizar();
  // CE (~26 páginas) leva 2 a 4 min; 180 s + uma página lenta com novas tentativas (até ~105 s) cabem nos 300 s
  const sync = await sincronizarLicitacoes({ ufs, prazoMs: 180_000 });
  const site = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
  const alertas = await enviarAlertasLicitacoes(site);
  return Response.json({ ok: sync.every((s) => s.status !== "erro"), sync, alertas });
}
