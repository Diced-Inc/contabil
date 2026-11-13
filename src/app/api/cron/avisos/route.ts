import { and, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { garantirCiclo, notificar } from "@/db/ciclos";
import { ciclosMensais, empresas, membros, notificacoes, type CicloMensal } from "@/db/schema";
import { avisosDoDia, diasEntre, type Aviso } from "@/lib/avisos";
import { competenciaAtual, nomeCompetencia } from "@/lib/ciclo";
import { emailLembreteDas, emailPedidoExtrato } from "@/lib/email";
import { hoje as hojeSP } from "@/lib/format";
import { requireUser } from "@/supabase/server";

// A Vercel chama diariamente às 11:00 UTC (08:00 em Brasília) com `Authorization: Bearer ${CRON_SECRET}` (vercel.json).
// O contador logado pode simular uma empresa: POST ?empresa=<id>&simular=1 (sempre sem enviar).

type Linha = { tipo: Aviso["tipo"]; competencia: string; para: string; assunto: string; status: string };
type Resumo = { id: string; nome: string; avisos: Linha[]; erro?: string };

const cronAutorizado = (request: Request) => {
  const segredo = process.env.CRON_SECRET;
  return !!segredo && request.headers.get("authorization") === `Bearer ${segredo}`;
};

function montarEmail(a: Aviso, ciclo: CicloMensal | undefined, empresa: string, link: string, hoje: string) {
  const competencia = nomeCompetencia(a.competencia);
  if (a.tipo !== "lembrete_das") return emailPedidoExtrato({ empresa, competencia, link, lembrete: a.tipo === "lembrete_extrato" });
  const vencimento = ciclo!.dasVencimento!;
  return emailLembreteDas({ empresa, competencia, valor: ciclo!.dasValor!, vencimento, dias: diasEntre(hoje, vencimento), link });
}

async function rodar({ empresaId, simular, site }: { empresaId: string | null; simular: boolean; site: string }) {
  const hoje = hojeSP();
  const competencia = competenciaAtual(hoje);
  const lista = await db
    .select()
    .from(empresas)
    .where(
      and(
        empresaId ? eq(empresas.id, empresaId) : undefined,
        simular ? undefined : eq(empresas.avisosAtivos, true), // a simulação mostra o que a configuração salva faria
      ),
    );
  const ids = lista.map((e) => e.id);
  const [clientes, ciclos] = await Promise.all([
    db
      .select({ empresaId: membros.empresaId, email: membros.email })
      .from(membros)
      .where(and(inArray(membros.empresaId, ids), isNotNull(membros.userId), isNotNull(membros.aceitoEm))),
    db
      .select()
      .from(ciclosMensais)
      .where(
        and(
          inArray(ciclosMensais.empresaId, ids),
          or(eq(ciclosMensais.competencia, competencia), eq(ciclosMensais.status, "das_enviado")),
        ),
      ),
  ]);
  // Já enviados: os de hoje (qualquer tipo) e o pedido da competência atual em qualquer dia.
  const atuais = ciclos.filter((c) => c.competencia === competencia).map((c) => c.id);
  const enviados = new Set(
    (
      await db
        .select({ cicloId: notificacoes.cicloId, tipo: notificacoes.tipo, para: notificacoes.para, dataRef: notificacoes.dataRef })
        .from(notificacoes)
        .where(
          and(
            inArray(notificacoes.empresaId, ids),
            eq(notificacoes.status, "enviado"),
            or(eq(notificacoes.dataRef, hoje), and(eq(notificacoes.tipo, "pedido_extrato"), inArray(notificacoes.cicloId, atuais))),
          ),
        )
    ).map((n) => `${n.cicloId}|${n.tipo}|${n.para}|${n.tipo === "pedido_extrato" ? "" : n.dataRef}`),
  );

  const resumo: Resumo[] = [];
  for (const e of lista) {
    const r: Resumo = { id: e.id, nome: e.razaoSocial, avisos: [] };
    resumo.push(r);
    try {
      const para = clientes.filter((c) => c.empresaId === e.id).map((c) => c.email);
      const cs = ciclos.filter((c) => c.empresaId === e.id);
      const avisos = avisosDoDia({ hoje, config: { ...e, avisosAtivos: simular || e.avisosAtivos }, ciclos: cs, membrosAtivos: para.length });
      for (const a of avisos) {
        let ciclo = cs.find((c) => c.competencia === a.competencia);
        if (!ciclo && !simular) ciclo = await garantirCiclo(e.id, a.competencia);
        const email = montarEmail(a, ciclo, e.razaoSocial, `${site}/portal/${e.id}`, hoje);
        let algumEnviado = false;
        for (const p of para) {
          const linha = { tipo: a.tipo, competencia: a.competencia, para: p, assunto: email.assunto };
          if (ciclo && enviados.has(`${ciclo.id}|${a.tipo}|${p}|${a.tipo === "pedido_extrato" ? "" : a.dataRef}`)) {
            r.avisos.push({ ...linha, status: "ja_enviado" });
            continue;
          }
          const status = simular ? "simulado" : await notificar({ empresaId: e.id, cicloId: ciclo!.id, tipo: a.tipo }, p, email);
          algumEnviado ||= status === "enviado";
          r.avisos.push({ ...linha, status });
        }
        if (algumEnviado && a.tipo === "pedido_extrato") {
          await db
            .update(ciclosMensais)
            .set({ extratoSolicitadoEm: new Date() })
            .where(and(eq(ciclosMensais.id, ciclo!.id), isNull(ciclosMensais.extratoSolicitadoEm)));
        }
      }
    } catch (err) {
      console.error(`[avisos] empresa ${e.id}:`, err);
      r.erro = err instanceof Error ? err.message : String(err);
    }
  }

  const todos = resumo.flatMap((r) => r.avisos);
  const conta = (s: string) => todos.filter((a) => a.status === s).length;
  return {
    ok: resumo.every((r) => !r.erro),
    hoje,
    simular,
    totais: {
      empresas: resumo.length,
      enviados: conta("enviado"),
      erros: conta("erro") + resumo.filter((r) => r.erro).length,
      naoConfigurado: conta("nao_configurado"),
      jaEnviados: conta("ja_enviado"),
      simulados: conta("simulado"),
    },
    empresas: resumo,
  };
}

const params = (request: Request) => {
  const url = new URL(request.url);
  const empresa = url.searchParams.get("empresa");
  return {
    empresaId: empresa,
    valido: !empresa || z.uuid().safeParse(empresa).success,
    simular: url.searchParams.get("simular") === "1",
    site: process.env.NEXT_PUBLIC_SITE_URL || url.origin,
  };
};

export async function GET(request: Request) {
  if (!cronAutorizado(request)) return new Response("Unauthorized", { status: 401 });
  const p = params(request);
  if (!p.valido) return Response.json({ ok: false, erro: "Empresa inválida." }, { status: 400 });
  return Response.json(await rodar(p));
}

/** Simulação pelo botão em Configurações (contador logado). Com o segredo do cron, aceita os mesmos parâmetros do GET. */
export async function POST(request: Request) {
  const p = params(request);
  if (!cronAutorizado(request)) {
    await requireUser();
    if (!p.empresaId) return Response.json({ ok: false, erro: "Informe a empresa." }, { status: 400 });
    p.simular = true;
  }
  if (!p.valido) return Response.json({ ok: false, erro: "Empresa inválida." }, { status: 400 });
  return Response.json(await rodar(p));
}
