import { Suspense } from "react";
import { cn } from "cn";
import { DataRange, lerPeriodo } from "@/components/data-range";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtData, fmtValor } from "@/lib/format";
import { dre, umAnoAntes } from "@/lib/relatorios/dre";
import { getEmpresa } from "../../empresa";
import { RelatorioShell } from "../relatorio-shell";

const periodo = (de: string, ate: string) => `${fmtData(de)} a ${fmtData(ate)}`;

async function Dre({ params, searchParams }: PageProps<"/e/[id]/relatorios/dre">) {
  const { id } = await params;
  const sp = await searchParams;
  const empresa = await getEmpresa(id);
  const { de, ate } = lerPeriodo(sp, "ano");
  const linhas = await dre(id, de, ate);

  return (
    <RelatorioShell
      titulo="Demonstração do resultado do exercício"
      empresa={empresa}
      periodoLabel={periodo(de, ate)}
      filtros={<DataRange path={`/e/${id}/relatorios/dre`} sp={sp} de={de} ate={ate} />}
    >
      <Table className="text-xs">
        <TableHeader>
          <TableRow>
            <TableHead>Descrição</TableHead>
            <TableHead className="text-right">{periodo(de, ate)}</TableHead>
            <TableHead className="text-right">{periodo(umAnoAntes(de), umAnoAntes(ate))}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {linhas.map((l, i) => (
            <TableRow
              key={i}
              className={cn(
                "tabular-nums",
                l.tipo === "grupo" && "font-medium",
                l.tipo === "subtotal" && "border-t-2 border-t-foreground/40 font-semibold",
              )}
            >
              <TableCell className={cn("py-1", l.tipo === "conta" && "pl-6 text-muted-foreground")}>
                {l.tipo === "conta" && <span className="mr-2">{l.codigo}</span>}
                {l.tipo === "subtotal" ? `= ${l.label}` : l.label}
              </TableCell>
              <TableCell className="py-1 text-right">{fmtValor(l.atual)}</TableCell>
              <TableCell className="py-1 text-right">{fmtValor(l.anterior)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </RelatorioShell>
  );
}

export default function DrePage(props: PageProps<"/e/[id]/relatorios/dre">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Carregando...</p>}>
      <Dre {...props} />
    </Suspense>
  );
}
