import { Suspense, type ReactNode } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { cn } from "cn";
import {
  ArrowRight, BookOpen, CalendarCheck, Inbox, Landmark, TrendingDown, TrendingUp, TriangleAlert, type LucideIcon,
} from "lucide-react";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Carregando, EmptyState, PageHeader } from "@/components/page-header";
import { db } from "@/db";
import { carregarEstado, mesesDoAno } from "@/lib/fechamento";
import { fmtData, fmtValor, hoje } from "@/lib/format";
import { dre } from "@/lib/relatorios/dre";
import { listarContasComSaldo } from "./bancos/queries";
import { getEmpresa } from "./empresa";
import { contarPendentes, ultimosLancamentos } from "./queries";

const verLink = (href: string, label: string) => (
  <Link
    href={href}
    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-primary transition-colors hover:bg-accent"
  >
    {label} <ArrowRight className="size-3.5" />
  </Link>
);

const TONS = {
  brand: "bg-accent text-primary",
  warning: "bg-warning-soft text-warning",
  success: "bg-success-soft text-success",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
} as const;

function Stat({ label, icon: Icon, tom = "brand", valor, valorCls, ajuda, link }: {
  label: string;
  icon: LucideIcon;
  tom?: keyof typeof TONS;
  valor: ReactNode;
  valorCls?: string;
  ajuda: ReactNode;
  link: ReactNode;
}) {
  return (
    <Card className="gap-0 pb-2">
      <CardContent>
        <div className="flex items-start justify-between gap-3">
          <p className="pt-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">{label}</p>
          <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", TONS[tom])}>
            <Icon className="size-4" />
          </span>
        </div>
        <p className={cn("mt-1 text-3xl font-semibold tracking-tight tabular-nums", valorCls)}>{valor}</p>
        <p className="mt-1 text-sm text-muted-foreground">{ajuda}</p>
      </CardContent>
      <div className="mx-5 mt-4 border-t pt-2 [&>a]:-ml-2">{link}</div>
    </Card>
  );
}

const reais = (v: number | string) => (
  <>
    <span className="mr-1 text-base font-medium text-muted-foreground">R$</span>
    {fmtValor(v)}
  </>
);

async function Resumo({ params }: PageProps<"/e/[id]">) {
  await connection();
  const { id } = await params;
  const empresa = await getEmpresa(id);
  const ate = hoje();
  const ano = Number(ate.slice(0, 4));
  const [pendentes, contas, estado, linhasDre, ultimos] = await Promise.all([
    contarPendentes(id),
    listarContasComSaldo(id),
    carregarEstado(db, id),
    dre(id, `${ano}-01-01`, ate),
    ultimosLancamentos(id),
  ]);
  const fechados = mesesDoAno(ano).filter((m) => estado.fechados.has(m)).length;
  const resultado = Number(linhasDre.at(-1)?.atual ?? 0);
  const comSaldo = contas.filter((c) => c.saldoOfx !== null);
  const saldoBancos = comSaldo.reduce((s, c) => s + Number(c.saldoOfx), 0);
  const divergentes = contas.filter((c) => c.diferenca !== null && Number(c.diferenca) !== 0).length;

  return (
    <>
      <PageHeader title="Resumo" description={`${empresa.razaoSocial} · posição em ${fmtData(ate)}`} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="A conciliar"
          icon={Inbox}
          tom={pendentes > 0 ? "warning" : "success"}
          valor={pendentes}
          ajuda={pendentes === 1 ? "transação aguardando revisão" : "transações aguardando revisão"}
          link={verLink(`/e/${id}/conciliacao`, "Abrir conciliação")}
        />
        <Stat
          label={`Resultado ${ano}`}
          icon={resultado >= 0 ? TrendingUp : TrendingDown}
          tom={resultado >= 0 ? "success" : "danger"}
          valor={reais(resultado)}
          valorCls={resultado >= 0 ? "text-success" : "text-danger"}
          ajuda={`${resultado >= 0 ? "Lucro" : "Prejuízo"} de 01/01 a ${fmtData(ate).slice(0, 5)}`}
          link={verLink(`/e/${id}/relatorios/dre?de=${ano}-01-01&ate=${ate}`, "Ver DRE")}
        />
        <Stat
          label="Saldo em bancos"
          icon={Landmark}
          tom={divergentes ? "danger" : "info"}
          valor={reais(saldoBancos)}
          ajuda={
            divergentes ? (
              <span className="font-medium text-danger">
                {divergentes} {divergentes === 1 ? "conta com diferença" : "contas com diferença"}
              </span>
            ) : (
              `${comSaldo.length} ${comSaldo.length === 1 ? "conta" : "contas"} · último OFX`
            )
          }
          link={verLink(`/e/${id}/bancos`, "Ver bancos")}
        />
        <Stat
          label={`Exercício ${ano}`}
          icon={CalendarCheck}
          valor={
            <>
              {fechados}
              <span className="text-lg font-medium text-muted-foreground"> / 12</span>
            </>
          }
          ajuda={`meses fechados · ${estado.apurados.has(ano) ? "apurado" : "não apurado"}`}
          link={verLink(`/e/${id}/fechamento?ano=${ano}`, "Fechamento")}
        />
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <Card className="gap-0 pb-0 xl:col-span-2">
          <CardHeader className="border-b">
            <CardTitle>Últimos lançamentos</CardTitle>
            <CardDescription>Os 10 mais recentes, por data</CardDescription>
            <CardAction>{verLink(`/e/${id}/lancamentos`, "Ver todos")}</CardAction>
          </CardHeader>
          {ultimos.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              title="Nenhum lançamento ainda"
              hint="Importe um OFX e concilie, ou crie um lançamento manual."
              className="m-5 border-0"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16 pl-5 text-right">Nº</TableHead>
                  <TableHead className="w-28">Data</TableHead>
                  <TableHead>Histórico</TableHead>
                  <TableHead className="pr-5 text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ultimos.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="pl-5 text-right text-muted-foreground">
                      <Link href={`/e/${id}/lancamentos/${l.id}`} className="hover:text-primary hover:underline">
                        {l.numero}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{fmtData(l.data)}</TableCell>
                    <TableCell className="max-w-md truncate">
                      <Link href={`/e/${id}/lancamentos/${l.id}`} className="font-medium hover:text-primary hover:underline">
                        {l.historico}
                      </Link>
                    </TableCell>
                    <TableCell className="pr-5 text-right font-medium">{fmtValor(l.valor)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>

        <Card className="gap-0 pb-0">
          <CardHeader className="border-b">
            <CardTitle>Contas bancárias</CardTitle>
            <CardDescription>Saldo do último extrato importado</CardDescription>
          </CardHeader>
          {contas.length === 0 ? (
            <EmptyState icon={Landmark} title="Nenhuma conta" hint="Cadastre uma conta em Bancos." className="m-5 border-0" />
          ) : (
            <ul className="divide-y">
              {contas.map((c) => {
                const diverge = c.diferenca !== null && Number(c.diferenca) !== 0;
                return (
                  <li key={c.id} className="flex items-center gap-3 px-5 py-3.5">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <Landmark className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{c.nome}</span>
                      <span className="block text-xs text-muted-foreground">
                        {c.dataSaldo ? `em ${fmtData(c.dataSaldo)}` : "sem extrato"}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="block text-sm font-semibold tabular-nums">
                        {c.saldoOfx === null ? "-" : fmtValor(c.saldoOfx)}
                      </span>
                      {diverge && (
                        <span className="flex items-center justify-end gap-1 text-xs font-medium text-danger tabular-nums">
                          <TriangleAlert className="size-3" /> dif. {fmtValor(c.diferenca!)}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

export default function ResumoPage(props: PageProps<"/e/[id]">) {
  return (
    <Suspense fallback={<><PageHeader title="Resumo" /><Carregando /></>}>
      <Resumo {...props} />
    </Suspense>
  );
}
