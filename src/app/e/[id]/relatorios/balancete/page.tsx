import { Suspense } from "react";
import { connection } from "next/server";
import { cn } from "cn";
import { DataRange, lerPeriodo } from "@/components/data-range";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtData, fmtSaldoDC, fmtValor } from "@/lib/format";
import { balancete } from "@/lib/relatorios/balancete";
import { nivel } from "@/lib/relatorios/hierarquia";
import { getEmpresa } from "../../empresa";
import { RelatorioShell } from "../relatorio-shell";

async function Balancete({ params, searchParams }: PageProps<"/e/[id]/relatorios/balancete">) {
  await connection();
  const { id } = await params;
  const sp = await searchParams;
  const empresa = await getEmpresa(id);
  const { de, ate } = lerPeriodo(sp, "mes");
  const linhas = await balancete(id, de, ate);

  return (
    <RelatorioShell
      titulo="Balancete de verificação"
      empresa={empresa}
      periodoLabel={`${fmtData(de)} a ${fmtData(ate)}`}
      filtros={<DataRange path={`/e/${id}/relatorios/balancete`} sp={sp} de={de} ate={ate} />}
    >
      {linhas.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma conta com saldo ou movimento no período.</p>
      ) : (
        <Table className="text-xs">
          <TableHeader>
            <TableRow>
              <TableHead>Código</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead className="text-right">Saldo anterior</TableHead>
              <TableHead className="text-right">Débito</TableHead>
              <TableHead className="text-right">Crédito</TableHead>
              <TableHead className="text-right">Saldo atual</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.map((l) => (
              <TableRow key={l.id} className={cn("tabular-nums", l.tipo === "sintetica" && "font-semibold")}>
                <TableCell className="py-1">{l.codigo}</TableCell>
                <TableCell className="py-1" style={{ paddingLeft: `${(nivel(l.codigo) - 1) * 12 + 8}px` }}>
                  {l.nome}
                </TableCell>
                <TableCell className="py-1 text-right">{fmtSaldoDC(l.saldoAnterior, l.natureza)}</TableCell>
                <TableCell className="py-1 text-right">{fmtValor(l.debitos)}</TableCell>
                <TableCell className="py-1 text-right">{fmtValor(l.creditos)}</TableCell>
                <TableCell className="py-1 text-right">{fmtSaldoDC(l.saldoAtual, l.natureza)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </RelatorioShell>
  );
}

export default function BalancetePage(props: PageProps<"/e/[id]/relatorios/balancete">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Carregando...</p>}>
      <Balancete {...props} />
    </Suspense>
  );
}
