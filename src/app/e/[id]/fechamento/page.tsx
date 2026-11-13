import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { and, count, eq, sql } from "drizzle-orm";
import { Calculator, ChevronLeft, ChevronRight, Handshake, Lock, LockOpen, ShieldCheck } from "lucide-react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Carregando, PageHeader } from "@/components/page-header";
import { Baixar } from "@/components/baixar";
import { db } from "@/db";
import { ciclosMensais, documentosRecebidos } from "@/db/schema";
import { competenciaAtual, passou, tituloCompetencia, situacaoDas, somarMeses, STATUS_CICLO, textoSituacaoDas } from "@/lib/ciclo";
import { fmtData, fmtValor, hoje, lerAno } from "@/lib/format";
import { getEmpresa } from "../empresa";
import { CicloBotao, ConcluirDasDialog } from "./ciclo-acoes";
import { ApuracaoBotao, MesBotao } from "./fechamento-botoes";
import { painelFechamento } from "./queries";

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const dataHora = (d: Date) => d.toLocaleDateString("pt-BR");
const DESCRICAO =
  "Mês fechado não aceita lançamentos novos, edições nem estornos. Feche os meses em ordem; a apuração exige os 12 meses do exercício fechados.";

const dataHoraSP = (d: Date) =>
  d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Ciclo com o cliente da competência escolhida (?ciclo=AAAA-MM; padrão: a que o cliente está enviando agora). */
async function CicloBloco({ empresaId, competencia, ano }: { empresaId: string; competencia: string; ano: number }) {
  const [[ciclo], [docs]] = await Promise.all([
    db
      .select()
      .from(ciclosMensais)
      .where(and(eq(ciclosMensais.empresaId, empresaId), eq(ciclosMensais.competencia, competencia))),
    db
      .select({ total: count(), novos: sql<number>`count(*) filter (where ${documentosRecebidos.processadoEm} is null)`.mapWith(Number) })
      .from(documentosRecebidos)
      .innerJoin(ciclosMensais, eq(ciclosMensais.id, documentosRecebidos.cicloId))
      .where(and(eq(ciclosMensais.empresaId, empresaId), eq(ciclosMensais.competencia, competencia))),
  ]);
  const status = ciclo?.status ?? "aguardando_extrato";
  const st = STATUS_CICLO[status];
  const situacao = ciclo ? situacaoDas(ciclo, hoje()) : null;
  const link = (n: number) => `/e/${empresaId}/fechamento?ano=${ano}&ciclo=${somarMeses(competencia, n).slice(0, 7)}`;

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-full bg-accent text-primary">
            <Handshake className="size-4" />
          </span>
          Ciclo com o cliente
          <span className="flex items-center gap-0.5 rounded-lg border bg-card p-0.5">
            <Link href={link(-1)} aria-label="Mês anterior" className={buttonVariants({ variant: "ghost", size: "icon-xs" })}>
              <ChevronLeft />
            </Link>
            <span className="min-w-36 text-center text-sm font-medium">{tituloCompetencia(competencia)}</span>
            <Link href={link(1)} aria-label="Próximo mês" className={buttonVariants({ variant: "ghost", size: "icon-xs" })}>
              <ChevronRight />
            </Link>
          </span>
          <Badge variant={st.badge}>{st.rotulo}</Badge>
        </CardTitle>
        <CardDescription className="pl-10.5">
          {docs.total === 0 ? (
            "Nenhum arquivo recebido do cliente nesta competência."
          ) : (
            <>
              {docs.total} {docs.total === 1 ? "arquivo recebido" : "arquivos recebidos"}
              {docs.novos > 0 && <>, {docs.novos} sem processar</>}.{" "}
              <Link href={`/e/${empresaId}/documentos`} className="font-medium text-primary underline-offset-4 hover:underline">
                Ver documentos
              </Link>
            </>
          )}
          {ciclo?.dasValor && ciclo.dasVencimento && (
            <span className="mt-1 block">
              DAS de <b className="font-semibold text-foreground">R$ {fmtValor(ciclo.dasValor)}</b>, vencimento {fmtData(ciclo.dasVencimento)}
              {situacao && (
                <span className={cn("font-medium", situacao.tipo === "vencido" ? "text-danger" : situacao.tipo === "pago" ? "text-success" : "")}>
                  {" "}· {situacao.tipo === "pago" && ciclo.dasPagoEm ? `Pago em ${dataHoraSP(ciclo.dasPagoEm)}` : textoSituacaoDas(situacao)}
                </span>
              )}
              {ciclo.concluidoEm && <> · enviado em {dataHoraSP(ciclo.concluidoEm)}</>}
            </span>
          )}
        </CardDescription>
        <CardAction>
          <div className="flex flex-wrap items-center gap-2">
            {ciclo?.dasPath && <Baixar empresaId={empresaId} competencia={competencia} rotulo="Guia do DAS" size="default" />}
            {passou(status, "das_enviado") ? (
              <>
                {status === "das_enviado" && <CicloBotao empresaId={empresaId} competencia={competencia} acao="pago" />}
                <CicloBotao empresaId={empresaId} competencia={competencia} acao="reabrir" />
              </>
            ) : (
              <ConcluirDasDialog
                empresaId={empresaId}
                competencia={competencia}
                vencimentoSugerido={`${somarMeses(competencia, 1).slice(0, 8)}20`}
              />
            )}
          </div>
        </CardAction>
      </CardHeader>
    </Card>
  );
}

async function Fechamento({ params, searchParams }: PageProps<"/e/[id]/fechamento">) {
  await connection();
  const { id } = await params;
  const sp = await searchParams;
  const ano = lerAno(sp.ano);
  const ciclo = typeof sp.ciclo === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.ciclo) ? `${sp.ciclo}-01` : competenciaAtual(hoje());
  await getEmpresa(id);
  const { meses, apuracao, motivoNaoApurar } = await painelFechamento(id, ano);
  const lucro = apuracao && Number(apuracao.resultado) >= 0;
  const fechados = meses.filter((m) => m.fechadoEm).length;

  return (
    <>
      <PageHeader
        title="Fechamento"
        description={DESCRICAO}
        actions={
          <div className="flex items-center gap-1 rounded-lg border bg-card p-1 shadow-xs">
            <Link href={`/e/${id}/fechamento?ano=${ano - 1}`} aria-label="Ano anterior" className={buttonVariants({ variant: "ghost", size: "icon-sm" })}>
              <ChevronLeft />
            </Link>
            <span className="w-16 text-center text-base font-semibold tabular-nums">{ano}</span>
            <Link href={`/e/${id}/fechamento?ano=${ano + 1}`} aria-label="Próximo ano" className={buttonVariants({ variant: "ghost", size: "icon-sm" })}>
              <ChevronRight />
            </Link>
          </div>
        }
      />

      <CicloBloco empresaId={id} competencia={ciclo} ano={ano} />

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Meses de {ano}</h2>
        <span className="text-sm text-muted-foreground tabular-nums">{fechados} de 12 fechados</span>
      </div>
      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(fechados / 12) * 100}%` }} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {meses.map((m, i) => (
          <div
            key={m.competencia}
            className={cn(
              "flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-card",
              m.fechadoEm && "border-success/25 bg-success-soft/40",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">{MESES[i]}</p>
                <p className="text-xs text-muted-foreground">
                  {m.fechadoEm ? `Fechado em ${dataHora(m.fechadoEm)}` : "Aberto"}
                </p>
              </div>
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full",
                  m.fechadoEm ? "bg-success-soft text-success ring-1 ring-success/20" : "bg-muted text-muted-foreground",
                )}
              >
                {m.fechadoEm ? <Lock className="size-3.5" /> : <LockOpen className="size-3.5" />}
              </span>
            </div>
            <MesBotao
              empresaId={id}
              competencia={m.competencia}
              fechado={!!m.fechadoEm}
              motivo={m.fechadoEm ? m.motivoNaoReabrir : m.motivoNaoFechar}
            />
          </div>
        ))}
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-full bg-accent text-primary">
              <Calculator className="size-4" />
            </span>
            Apuração do exercício {ano}
            {apuracao ? <Badge variant="success">Apurado</Badge> : <Badge variant="muted">Não apurado</Badge>}
          </CardTitle>
          <CardDescription className="pl-10.5">
            {apuracao ? (
              <>
                Apurada em {dataHora(apuracao.apuradoEm)} (lançamento em {fmtData(`${ano}-12-31`)}).{" "}
                <span className={cn("font-medium", lucro ? "text-success" : "text-danger")}>
                  {lucro ? "Lucro" : "Prejuízo"} de R$ {fmtValor(Math.abs(Number(apuracao.resultado)))}.
                </span>{" "}
                <Link href={`/e/${id}/lancamentos/${apuracao.lancamentoId}`} className="font-medium text-primary underline-offset-4 hover:underline">
                  Ver lançamento nº {apuracao.numero}
                </Link>
              </>
            ) : (
              <>{motivoNaoApurar}</>
            )}
          </CardDescription>
          <CardAction>
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/e/${id}/checagem?ano=${ano}`} className={buttonVariants({ variant: "outline" })}>
                <ShieldCheck />
                Checagem
              </Link>
              <ApuracaoBotao empresaId={id} ano={ano} apurada={!!apuracao} motivo={apuracao ? null : motivoNaoApurar} />
            </div>
          </CardAction>
        </CardHeader>
      </Card>
    </>
  );
}

export default function FechamentoPage(props: PageProps<"/e/[id]/fechamento">) {
  return (
    <Suspense fallback={<><PageHeader title="Fechamento" description={DESCRICAO} /><Carregando /></>}>
      <Fechamento {...props} />
    </Suspense>
  );
}
