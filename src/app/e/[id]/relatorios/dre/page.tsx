import { Suspense } from "react";
import { connection } from "next/server";
import { cn } from "cn";
import { DataRange, lerPeriodo } from "@/components/data-range";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtData, fmtValor } from "@/lib/format";
import { dre, umAnoAntes } from "@/lib/relatorios/dre";
import { Carregando } from "@/components/page-header";
import { getEmpresa } from "../../empresa";
import { RelatorioShell } from "../relatorio-shell";

const periodo = (de: string, ate: string) => `${fmtData(de)} a ${fmtData(ate)}`;

async function Dre({ params, searchParams }: PageProps<"/e/[id]/relatorios/dre">) {
  await connection();
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
      dataAssinatura={ate}
      filtros={<DataRange path={`/e/${id}/relatorios/dre`} sp={sp} de={de} ate={ate} />}
    >
      <Table className="text-[13px]">
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
                l.tipo === "grupo" && "font-medium",
                l.tipo === "subtotal" && "border-t border-t-foreground/30 bg-muted/40 font-semibold hover:bg-muted/50",
                i === linhas.length - 1 && "border-t-2 border-b-2 border-t-foreground/70 border-b-foreground/70 bg-accent text-[14px] hover:bg-accent",
              )}
            >
              <TableCell className={cn("py-1.5", l.tipo === "conta" && "pl-8 text-muted-foreground")}>
                {l.tipo === "conta" && <span className="mr-2 font-mono text-xs">{l.codigo}</span>}
                {l.tipo === "subtotal" ? `= ${l.label}` : l.label}
              </TableCell>
              <TableCell className={cn("py-1.5 text-right", Number(l.atual) < 0 && "text-danger")}>{fmtValor(l.atual)}</TableCell>
              <TableCell className={cn("py-1.5 text-right", Number(l.anterior) < 0 && "text-danger")}>{fmtValor(l.anterior)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </RelatorioShell>
  );
}

export default function DrePage(props: PageProps<"/e/[id]/relatorios/dre">) {
  return (
    <Suspense fallback={<Carregando />}>
      <Dre {...props} />
    </Suspense>
  );
}
