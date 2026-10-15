import { Suspense } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Lock, LockOpen } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtData, fmtValor, lerAno } from "@/lib/format";
import { getEmpresa } from "../empresa";
import { ApuracaoBotao, MesBotao } from "./fechamento-botoes";
import { painelFechamento } from "./queries";

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const dataHora = (d: Date) => d.toLocaleDateString("pt-BR");

async function Fechamento({ params, searchParams }: PageProps<"/e/[id]/fechamento">) {
  const { id } = await params;
  const sp = await searchParams;
  const ano = lerAno(sp.ano);
  await getEmpresa(id);
  const { meses, apuracao, motivoNaoApurar } = await painelFechamento(id, ano);
  const lucro = apuracao && Number(apuracao.resultado) >= 0;

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <Link href={`/e/${id}/fechamento?ano=${ano - 1}`} aria-label="Ano anterior" className={buttonVariants({ variant: "outline", size: "icon-sm" })}>
          <ChevronLeft />
        </Link>
        <span className="w-14 text-center text-lg font-semibold tabular-nums">{ano}</span>
        <Link href={`/e/${id}/fechamento?ano=${ano + 1}`} aria-label="Próximo ano" className={buttonVariants({ variant: "outline", size: "icon-sm" })}>
          <ChevronRight />
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {meses.map((m, i) => (
          <Card key={m.competencia} size="sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {m.fechadoEm ? (
                  <Lock className="size-4 text-green-600 dark:text-green-500" />
                ) : (
                  <LockOpen className="size-4 text-muted-foreground" />
                )}
                {MESES[i]}
              </CardTitle>
              <CardDescription>{m.fechadoEm ? `Fechado em ${dataHora(m.fechadoEm)}` : "Aberto"}</CardDescription>
            </CardHeader>
            <CardContent>
              <MesBotao
                empresaId={id}
                competencia={m.competencia}
                fechado={!!m.fechadoEm}
                motivo={m.fechadoEm ? m.motivoNaoReabrir : m.motivoNaoFechar}
              />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Apuração do exercício</CardTitle>
          <CardDescription>
            {apuracao ? (
              <>
                Apurada em {dataHora(apuracao.apuradoEm)} (lançamento em {fmtData(`${ano}-12-31`)}).{" "}
                {lucro ? "Lucro" : "Prejuízo"} de R$ {fmtValor(Math.abs(Number(apuracao.resultado)))}.{" "}
                <Link href={`/e/${id}/lancamentos/${apuracao.lancamentoId}`} className="underline underline-offset-4">
                  Ver lançamento nº {apuracao.numero}
                </Link>
              </>
            ) : (
              <>Não apurada. {motivoNaoApurar}</>
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
    <div>
      <h1 className="mb-2 text-2xl font-semibold">Fechamento</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Mês fechado não aceita lançamentos novos, edições nem estornos. Feche os meses em ordem; a apuração exige os 12
        meses do exercício fechados.
      </p>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Carregando...</p>}>
        <Fechamento {...props} />
      </Suspense>
    </div>
  );
}
