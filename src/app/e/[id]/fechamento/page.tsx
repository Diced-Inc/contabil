import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { and, count, eq, isNotNull, sql } from "drizzle-orm";
import { ArrowRight, Calculator, ChevronLeft, ChevronRight, CircleCheck, FileText, Handshake, Lock, LockOpen, Paperclip, ShieldCheck } from "lucide-react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Carregando, PageHeader } from "@/components/page-header";
import { ProgressoCiclo } from "@/components/progresso-ciclo";
import { db } from "@/db";
import { listarGuias } from "@/db/ciclos";
import { ciclosMensais, documentosRecebidos, membros } from "@/db/schema";
import { competenciaAtual, MOTIVOS_ENCERRAMENTO, passou, tituloCompetencia, somarMeses, STATUS_CICLO, type StatusCiclo } from "@/lib/ciclo";
import { fmtData, fmtValor, hoje, lerAno } from "@/lib/format";
import { guiasEsperadas, resumoGuias } from "@/lib/guias";
import { getEmpresa } from "../empresa";
import { EncerrarDialog, ProcessarBotao, ReabrirBotao } from "./ciclo-acoes";
import { ApuracaoBotao, MesBotao } from "./fechamento-botoes";
import { GuiasDoMes } from "./guias-mes";
import { painelFechamento } from "./queries";

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const dataHora = (d: Date) => d.toLocaleDateString("pt-BR");
const DESCRICAO =
  "Mês fechado não aceita lançamentos novos, edições nem estornos. Feche os meses em ordem; a apuração exige os 12 meses do exercício fechados.";

const dataHoraSP = (d: Date) =>
  d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

const arquivos = (n: number, novo = false) => `${n} ${n === 1 ? "arquivo" : "arquivos"}${novo ? (n === 1 ? " novo" : " novos") : ""}`;
const guiasTxt = (n: number) => `${n} ${n === 1 ? "guia" : "guias"}`;

/** "Próximo passo": o que o contador faz agora para o mês andar, com a ação principal do status. */
function ProximoPasso({ empresaId, competencia, status, novos, totalDocs, porFora, rascunhos, abertas }: {
  empresaId: string; competencia: string; status: StatusCiclo; novos: number; totalDocs: number; porFora: boolean; rascunhos: number;
  abertas: { qtd: number; vencidas: number; emAberto: number };
}) {
  const verArquivos = totalDocs > 0 && (
    <Link href={`/e/${empresaId}/documentos`} className={buttonVariants({ variant: "outline" })}>
      <FileText />
      Ver arquivos
    </Link>
  );
  const irParaGuias = (
    <a href="#guias-do-mes" className={buttonVariants({ variant: "outline" })}>
      <Paperclip />
      Ir para as guias
    </a>
  );
  const passo: { titulo: string; texto: string; acoes?: React.ReactNode } = {
    aguardando_extrato: {
      titulo: "Esperando o cliente enviar os extratos",
      texto: "O cliente recebe lembretes por e-mail. Se ele mandou por outro canal, comece o processamento ou encerre o mês sem guias.",
      acoes: <ProcessarBotao empresaId={empresaId} competencia={competencia} variant="outline" />,
    },
    extrato_recebido: {
      titulo: novos > 0 ? `${arquivos(novos, true)} do cliente` : porFora ? "O cliente enviou os extratos por outro canal" : "Extratos recebidos",
      texto: "Importe os extratos em Documentos (importar já começa o processamento) ou comece agora. O cliente passa a ver “Em processamento” no portal.",
      acoes: <>{verArquivos}<ProcessarBotao empresaId={empresaId} competencia={competencia} /></>,
    },
    em_processamento: {
      titulo: "Anexe as guias do mês e envie ao cliente",
      texto:
        (rascunhos > 0
          ? "Quando terminar, clique em “Concluir mês e enviar guias”: o cliente recebe o e-mail e as guias aparecem no portal."
          : "Anexe as guias em Guias do mês, logo abaixo, e clique em “Concluir mês e enviar guias”. Sem guias no mês? Encerre o mês sem guias.") +
        (novos > 0 ? ` Ainda há ${arquivos(novos)} do cliente sem processar.` : ""),
      acoes: <>{novos > 0 && verArquivos}{irParaGuias}</>,
    },
    das_enviado: {
      titulo: "Aguardando o cliente pagar",
      texto:
        `${guiasTxt(abertas.qtd)} em aberto, R$ ${fmtValor(abertas.emAberto)}` +
        (abertas.vencidas > 0 ? ` (${abertas.vencidas} ${abertas.vencidas === 1 ? "vencida" : "vencidas"})` : "") +
        ". Quando o cliente clica em “Já paguei”, a guia fica paga; dá para marcar como paga aqui também.",
    },
    das_pago: { titulo: "Mês concluído", texto: "Todas as guias enviadas estão pagas. Nada pendente." },
    encerrado: { titulo: "Mês encerrado", texto: "Encerrado sem guias. Nada pendente." },
  }[status];
  const feito = status === "das_pago" || status === "encerrado";
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border px-4 py-3",
        feito ? "border-success/25 bg-success-soft/40" : "border-primary/20 bg-accent/50",
      )}
    >
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full",
          feito ? "bg-success-soft text-success" : "bg-primary text-primary-foreground",
        )}
      >
        {feito ? <CircleCheck className="size-4" /> : <ArrowRight className="size-4" />}
      </span>
      <div className="min-w-0 flex-1 basis-64">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{feito ? "Tudo certo" : "Próximo passo"}</p>
        <p className="text-sm font-semibold text-foreground">{passo.titulo}</p>
        <p className="text-sm text-muted-foreground">{passo.texto}</p>
      </div>
      {passo.acoes && <div className="flex flex-wrap items-center gap-2">{passo.acoes}</div>}
    </div>
  );
}

/** Ciclo com o cliente da competência escolhida (?ciclo=AAAA-MM; padrão: a que o cliente está enviando agora). */
async function CicloBloco({ empresaId, competencia, ano }: { empresaId: string; competencia: string; ano: number }) {
  const [empresa, [ciclo], [docs], clientes] = await Promise.all([
    getEmpresa(empresaId),
    db
      .select()
      .from(ciclosMensais)
      .where(and(eq(ciclosMensais.empresaId, empresaId), eq(ciclosMensais.competencia, competencia))),
    db
      .select({ total: count(), novos: sql<number>`count(*) filter (where ${documentosRecebidos.processadoEm} is null)`.mapWith(Number) })
      .from(documentosRecebidos)
      .innerJoin(ciclosMensais, eq(ciclosMensais.id, documentosRecebidos.cicloId))
      .where(and(eq(ciclosMensais.empresaId, empresaId), eq(ciclosMensais.competencia, competencia))),
    db
      .select({ email: membros.email })
      .from(membros)
      .where(and(eq(membros.empresaId, empresaId), isNotNull(membros.userId), isNotNull(membros.aceitoEm))),
  ]);
  const status = ciclo?.status ?? "aguardando_extrato";
  const st = STATUS_CICLO[status];
  const guias = ciclo ? await listarGuias([ciclo.id], { comRascunhos: true }) : [];
  const link = (n: number) => `/e/${empresaId}/fechamento?ano=${ano}&ciclo=${somarMeses(competencia, n).slice(0, 7)}`;
  // Sem arquivo mas com data de recebimento = o cliente avisou que mandou por WhatsApp/e-mail (só avisarExtratoPorFora faz isso).
  const porFora = ciclo?.extratoRecebidoEm && (docs.total === 0 || ciclo.clienteObs);
  const encerrar = status !== "das_pago" && status !== "encerrado" && <EncerrarDialog empresaId={empresaId} competencia={competencia} />;

  return (
    <Card className="mb-6 pb-5">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-md bg-accent text-primary">
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
        <CardDescription className="sm:pl-10.5">
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
          {porFora && (
            <span className="mt-1 block text-foreground">
              O cliente avisou em {dataHoraSP(ciclo.extratoRecebidoEm!)} que enviou os extratos por outro canal
              {ciclo.clienteObs ? <>: <i>&ldquo;{ciclo.clienteObs}&rdquo;</i></> : "."}
            </span>
          )}
          {ciclo?.status === "encerrado" && (
            <span className="mt-1 block text-foreground">
              Encerrado sem guias{ciclo.encerradoEm && <> em {dataHoraSP(ciclo.encerradoEm)}</>}
              {ciclo.encerradoMotivo && <>: <b className="font-semibold">{MOTIVOS_ENCERRAMENTO[ciclo.encerradoMotivo].rotulo}</b></>}
              {ciclo.encerradoObs && <> · <i>{ciclo.encerradoObs}</i></>}. O cliente não recebe mais lembretes deste mês.
            </span>
          )}
          {ciclo?.concluidoEm && passou(status, "das_enviado") && status !== "encerrado" && (
            <span className="mt-1 block">Guias enviadas ao cliente em {dataHoraSP(ciclo.concluidoEm)}.</span>
          )}
        </CardDescription>
        <CardAction>
          <div className="flex flex-wrap items-center gap-2">
            {encerrar}
            {passou(status, "das_enviado") && <ReabrirBotao empresaId={empresaId} competencia={competencia} />}
          </div>
        </CardAction>
      </CardHeader>
      <div className="grid gap-5 border-t px-6 pt-5">
        <ProgressoCiclo status={status} />
        <ProximoPasso
          empresaId={empresaId}
          competencia={competencia}
          status={status}
          novos={docs.novos}
          totalDocs={docs.total}
          porFora={!!porFora}
          rascunhos={guias.filter((g) => !g.enviadoEm).length}
          abertas={resumoGuias(guias.filter((g) => g.enviadoEm && !g.pagoEm), hoje())}
        />
      </div>
      <GuiasDoMes
        empresaId={empresaId}
        competencia={competencia}
        hoje={hoje()}
        status={status}
        esperadas={guiasEsperadas({ regime: empresa.regimeTributario, temProLabore: empresa.temProLabore })}
        guias={guias.map((g) => ({
          id: g.id, tipo: g.tipo, descricao: g.descricao, valor: g.valor, vencimento: g.vencimento, codigoReceita: g.codigoReceita,
          enviadoEm: g.enviadoEm, pagoEm: g.pagoEm,
        }))}
        clientes={clientes.map((c) => c.email)}
        vencimentoSugerido={`${somarMeses(competencia, 1).slice(0, 8)}20`}
      />
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
                  "flex size-8 shrink-0 items-center justify-center rounded-md",
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
            <span className="flex size-8 items-center justify-center rounded-md bg-accent text-primary">
              <Calculator className="size-4" />
            </span>
            Apuração do exercício {ano}
            {apuracao ? <Badge variant="success">Apurado</Badge> : <Badge variant="muted">Não apurado</Badge>}
          </CardTitle>
          <CardDescription className="sm:pl-10.5">
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
