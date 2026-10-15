import { Suspense } from "react";
import Link from "next/link";
import { cn } from "cn";
import { ArrowRight, CalendarCheck, Inbox, Landmark, TrendingUp, TriangleAlert } from "lucide-react";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/db";
import { carregarEstado, mesesDoAno } from "@/lib/fechamento";
import { fmtData, fmtValor, hoje } from "@/lib/format";
import { dre } from "@/lib/relatorios/dre";
import { listarContasComSaldo } from "./bancos/queries";
import { getEmpresa } from "./empresa";
import { contarPendentes, ultimosLancamentos } from "./queries";

const verLink = (href: string, label: string) => (
  <Link href={href} className="inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline">
    {label} <ArrowRight className="size-3.5" />
  </Link>
);

async function Resumo({ params }: PageProps<"/e/[id]">) {
  const { id } = await params;
  await getEmpresa(id);
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

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Inbox className="size-4 text-muted-foreground" /> Pendentes de conciliação
            </CardTitle>
            <CardAction>{verLink(`/e/${id}/conciliacao`, "Conciliar")}</CardAction>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums">{pendentes}</p>
            <p className="text-sm text-muted-foreground">
              {pendentes === 1 ? "transação aguardando classificação" : "transações aguardando classificação"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="size-4 text-muted-foreground" /> Resultado do ano até hoje
            </CardTitle>
            <CardDescription>
              DRE de {fmtData(`${ano}-01-01`)} a {fmtData(ate)}
            </CardDescription>
            <CardAction>{verLink(`/e/${id}/relatorios/dre?de=${ano}-01-01&ate=${ate}`, "DRE")}</CardAction>
          </CardHeader>
          <CardContent>
            <p
              className={cn(
                "text-3xl font-semibold tabular-nums",
                resultado >= 0 ? "text-green-700 dark:text-green-500" : "text-red-700 dark:text-red-500",
              )}
            >
              {fmtValor(resultado)}
            </p>
            <p className="text-sm text-muted-foreground">
              Resultado líquido ({resultado >= 0 ? "lucro" : "prejuízo"})
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Landmark className="size-4 text-muted-foreground" /> Contas bancárias
            </CardTitle>
            <CardDescription>Saldo do último OFX</CardDescription>
            <CardAction>{verLink(`/e/${id}/bancos`, "Bancos")}</CardAction>
          </CardHeader>
          <CardContent>
            {contas.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma conta bancária cadastrada.</p>
            ) : (
              <ul className="divide-y text-sm">
                {contas.map((c) => {
                  const diverge = c.diferenca !== null && Number(c.diferenca) !== 0;
                  return (
                    <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                      <span className="font-medium">{c.nome}</span>
                      <span className="text-right">
                        <span className="tabular-nums">{c.saldoOfx === null ? "Sem OFX" : fmtValor(c.saldoOfx)}</span>
                        {diverge && (
                          <span className="flex items-center justify-end gap-1 text-xs font-semibold text-red-700 dark:text-red-500">
                            <TriangleAlert className="size-3.5" /> Diferença de {fmtValor(c.diferenca!)}
                          </span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarCheck className="size-4 text-muted-foreground" /> Exercício {ano}
            </CardTitle>
            <CardAction>{verLink(`/e/${id}/fechamento?ano=${ano}`, "Fechamento")}</CardAction>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums">{fechados} / 12</p>
            <p className="text-sm text-muted-foreground">
              meses fechados · {estado.apurados.has(ano) ? "exercício apurado" : "exercício não apurado"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Últimos lançamentos</CardTitle>
          <CardAction>{verLink(`/e/${id}/lancamentos`, "Todos")}</CardAction>
        </CardHeader>
        <CardContent>
          {ultimos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum lançamento ainda.</p>
          ) : (
            <Table className="text-sm">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Nº</TableHead>
                  <TableHead className="w-28">Data</TableHead>
                  <TableHead>Histórico</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ultimos.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="tabular-nums">
                      <Link href={`/e/${id}/lancamentos/${l.id}`} className="underline-offset-4 hover:underline">
                        {l.numero}
                      </Link>
                    </TableCell>
                    <TableCell>{fmtData(l.data)}</TableCell>
                    <TableCell>
                      <Link href={`/e/${id}/lancamentos/${l.id}`} className="hover:underline">
                        {l.historico}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtValor(l.valor)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

export default function ResumoPage(props: PageProps<"/e/[id]">) {
  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold">Resumo</h1>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Carregando...</p>}>
        <Resumo {...props} />
      </Suspense>
    </div>
  );
}
