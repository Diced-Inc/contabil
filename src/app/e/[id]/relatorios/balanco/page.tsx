import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtSaldoDC, fmtValor, fromCents, lerAno } from "@/lib/format";
import { balanco, type TotaisBalanco } from "@/lib/relatorios/balanco";
import { nivel } from "@/lib/relatorios/hierarquia";
import { Carregando } from "@/components/page-header";
import { getEmpresa } from "../../empresa";
import { RelatorioShell } from "../relatorio-shell";

const fecha = (t: TotaisBalanco) =>
  t.fecha ? "Balanço fecha" : `Não fecha (diferença ${fmtValor(fromCents(Math.abs(t.ativo + t.passivoPl)))})`;

async function Balanco({ params, searchParams }: PageProps<"/e/[id]/relatorios/balanco">) {
  await connection();
  const { id } = await params;
  const sp = await searchParams;
  const ano = lerAno(sp.ano);
  const empresa = await getEmpresa(id);
  const b = await balanco(id, ano);
  const base = `/e/${id}/relatorios/balanco`;

  return (
    <RelatorioShell
      titulo="Balanço patrimonial"
      empresa={empresa}
      periodoLabel={`31/12/${ano} e 31/12/${ano - 1}`}
      dataAssinatura={`${ano}-12-31`}
      filtros={
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-muted-foreground">Exercício</span>
          <div className="flex items-center gap-1 rounded-lg border bg-card p-1">
            <Link href={`${base}?ano=${ano - 1}`} aria-label="Ano anterior" className={buttonVariants({ variant: "ghost", size: "icon-sm" })}>
              <ChevronLeft />
            </Link>
            <span className="w-14 text-center text-base font-semibold tabular-nums">{ano}</span>
            <Link href={`${base}?ano=${ano + 1}`} aria-label="Próximo ano" className={buttonVariants({ variant: "ghost", size: "icon-sm" })}>
              <ChevronRight />
            </Link>
          </div>
        </div>
      }
    >
      <Table className="text-[13px]">
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
              key={l.chave}
              className={cn(
                l.tipo === "sintetica" && "font-semibold",
                !l.virtual && nivel(l.codigo) === 1 && "border-t-2 border-t-border bg-muted/40",
                l.virtual && "italic",
              )}
            >
              <TableCell className="py-1.5" style={{ paddingLeft: `${((l.virtual ? 3 : nivel(l.codigo)) - 1) * 16 + 12}px` }}>
                {l.codigo && <span className="mr-2 font-mono text-xs font-normal text-muted-foreground">{l.codigo}</span>}
                {l.nome}
              </TableCell>
              <TableCell className="py-1.5 text-right">{fmtSaldoDC(l.atual, l.natureza)}</TableCell>
              <TableCell className="py-1.5 text-right">{fmtSaldoDC(l.anterior, l.natureza)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter className="border-t-2 border-t-foreground/70 bg-transparent">
          <TableRow>
            <TableCell className="py-1.5">Ativo total</TableCell>
            <TableCell className="py-1.5 text-right">{fmtSaldoDC(fromCents(b.atual.ativo), "D")}</TableCell>
            <TableCell className="py-1.5 text-right">{fmtSaldoDC(fromCents(b.anterior.ativo), "D")}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="py-1.5">Passivo + Patrimônio líquido</TableCell>
            <TableCell className="py-1.5 text-right">{fmtSaldoDC(fromCents(b.atual.passivoPl), "C")}</TableCell>
            <TableCell className="py-1.5 text-right">{fmtSaldoDC(fromCents(b.anterior.passivoPl), "C")}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="py-1" />
            <TableCell className="py-2 text-right">
              <Badge variant={b.atual.fecha ? "success" : "danger"}>{fecha(b.atual)}</Badge>
            </TableCell>
            <TableCell className="py-2 text-right">
              <Badge variant={b.anterior.fecha ? "success" : "danger"}>{fecha(b.anterior)}</Badge>
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </RelatorioShell>
  );
}

export default function BalancoPage(props: PageProps<"/e/[id]/relatorios/balanco">) {
  return (
    <Suspense fallback={<Carregando />}>
      <Balanco {...props} />
    </Suspense>
  );
}
