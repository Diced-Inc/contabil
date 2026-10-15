import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { Calculator, ChevronLeft, ChevronRight, Lock, LockOpen } from "lucide-react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Carregando, PageHeader } from "@/components/page-header";
import { fmtData, fmtValor, lerAno } from "@/lib/format";
import { getEmpresa } from "../empresa";
import { ApuracaoBotao, MesBotao } from "./fechamento-botoes";
import { painelFechamento } from "./queries";

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const dataHora = (d: Date) => d.toLocaleDateString("pt-BR");
const DESCRICAO =
  "Mês fechado não aceita lançamentos novos, edições nem estornos. Feche os meses em ordem; a apuração exige os 12 meses do exercício fechados.";

async function Fechamento({ params, searchParams }: PageProps<"/e/[id]/fechamento">) {
  await connection();
  const { id } = await params;
  const sp = await searchParams;
  const ano = lerAno(sp.ano);
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
            <ApuracaoBotao empresaId={id} ano={ano} apurada={!!apuracao} motivo={apuracao ? null : motivoNaoApurar} />
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
