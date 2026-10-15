import { Suspense } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "cn";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtSaldoDC, fmtValor, fromCents } from "@/lib/format";
import { balanco, type TotaisBalanco } from "@/lib/relatorios/balanco";
import { nivel } from "@/lib/relatorios/hierarquia";
import { getEmpresa } from "../../empresa";
import { RelatorioShell } from "../relatorio-shell";

const fecha = (t: TotaisBalanco) =>
  t.fecha ? "Balanço fecha" : `Não fecha (diferença ${fmtValor(fromCents(Math.abs(t.ativo + t.passivoPl)))})`;

async function Balanco({ params, searchParams }: PageProps<"/e/[id]/relatorios/balanco">) {
  const { id } = await params;
  const sp = await searchParams;
  const ano = typeof sp.ano === "string" && /^\d{4}$/.test(sp.ano) ? Number(sp.ano) : new Date().getFullYear();
  const empresa = await getEmpresa(id);
  const b = await balanco(id, ano);
  const base = `/e/${id}/relatorios/balanco`;

  return (
    <RelatorioShell
      titulo="Balanço patrimonial"
      empresa={empresa}
      periodoLabel={`31/12/${ano} e 31/12/${ano - 1}`}
      filtros={
        <div className="flex items-center gap-2">
          <Link href={`${base}?ano=${ano - 1}`} aria-label="Ano anterior" className={buttonVariants({ variant: "outline", size: "icon-sm" })}>
            <ChevronLeft />
          </Link>
          <span className="w-14 text-center text-lg font-semibold tabular-nums">{ano}</span>
          <Link href={`${base}?ano=${ano + 1}`} aria-label="Próximo ano" className={buttonVariants({ variant: "outline", size: "icon-sm" })}>
            <ChevronRight />
          </Link>
        </div>
      }
    >
      <Table className="text-xs">
        <TableHeader>
          <TableRow>
            <TableHead>Descrição</TableHead>
            <TableHead className="text-right">{ano}</TableHead>
            <TableHead className="text-right">{ano - 1}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {b.linhas.map((l) => (
            <TableRow
              key={l.codigo}
              className={cn(
                "tabular-nums",
                l.tipo === "sintetica" && "font-semibold",
                nivel(l.codigo) === 1 && "bg-muted/50",
                l.virtual && "italic",
              )}
            >
              <TableCell className="py-1" style={{ paddingLeft: `${(nivel(l.codigo) - 1) * 12 + 8}px` }}>
                {!l.virtual && <span className="mr-2 text-muted-foreground">{l.codigo}</span>}
                {l.nome}
              </TableCell>
              <TableCell className="py-1 text-right">{fmtSaldoDC(l.atual, l.natureza)}</TableCell>
              <TableCell className="py-1 text-right">{fmtSaldoDC(l.anterior, l.natureza)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter className="tabular-nums">
          <TableRow>
            <TableCell className="py-1">Ativo total</TableCell>
            <TableCell className="py-1 text-right">{fmtSaldoDC(fromCents(b.atual.ativo), "D")}</TableCell>
            <TableCell className="py-1 text-right">{fmtSaldoDC(fromCents(b.anterior.ativo), "D")}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="py-1">Passivo + Patrimônio líquido</TableCell>
            <TableCell className="py-1 text-right">{fmtSaldoDC(fromCents(b.atual.passivoPl), "C")}</TableCell>
            <TableCell className="py-1 text-right">{fmtSaldoDC(fromCents(b.anterior.passivoPl), "C")}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="py-1" />
            <TableCell className={cn("py-1 text-right", !b.atual.fecha && "text-destructive")}>{fecha(b.atual)}</TableCell>
            <TableCell className={cn("py-1 text-right", !b.anterior.fecha && "text-destructive")}>{fecha(b.anterior)}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </RelatorioShell>
  );
}

export default function BalancoPage(props: PageProps<"/e/[id]/relatorios/balanco">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Carregando...</p>}>
      <Balanco {...props} />
    </Suspense>
  );
}
