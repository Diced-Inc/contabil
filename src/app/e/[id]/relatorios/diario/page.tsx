import { Suspense } from "react";
import { connection } from "next/server";
import { DataRange, lerPeriodo } from "@/components/data-range";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtData, fmtValor } from "@/lib/format";
import { diario } from "@/lib/relatorios/diario";
import { Carregando } from "@/components/page-header";
import { getEmpresa } from "../../empresa";
import { RelatorioShell } from "../relatorio-shell";

async function Diario({ params, searchParams }: PageProps<"/e/[id]/relatorios/diario">) {
  await connection();
  const { id } = await params;
  const sp = await searchParams;
  const empresa = await getEmpresa(id);
  const { de, ate } = lerPeriodo(sp, "mes");
  const lancs = await diario(id, de, ate);

  return (
    <RelatorioShell
      titulo="Livro diário"
      empresa={empresa}
      periodoLabel={`${fmtData(de)} a ${fmtData(ate)}`}
      dataAssinatura={ate}
      filtros={<DataRange path={`/e/${id}/relatorios/diario`} sp={sp} de={de} ate={ate} />}
    >
      {lancs.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Nenhum lançamento no período.</p>
      ) : (
        <Table className="text-[13px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">Data</TableHead>
              <TableHead>Conta</TableHead>
              <TableHead className="w-28 text-right">Débito</TableHead>
              <TableHead className="w-28 text-right">Crédito</TableHead>
            </TableRow>
          </TableHeader>
          {lancs.map((l) => (
            <TableBody key={l.id} className="break-inside-avoid border-b">
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableCell className="py-1.5 font-semibold">{fmtData(l.data)}</TableCell>
                <TableCell colSpan={3} className="py-1.5 whitespace-normal">
                  <span className="font-semibold">Lançamento nº {l.numero}</span>
                  {l.status === "estornado" && <span className="ml-2 text-muted-foreground">(estornado)</span>}
                  {" - "}
                  {l.historico}
                  {l.documento && <span className="text-muted-foreground"> (doc. {l.documento})</span>}
                </TableCell>
              </TableRow>
              {l.partidas.map((p) => (
                <TableRow key={p.id} className="tabular-nums">
                  <TableCell className="py-1" />
                  <TableCell className="py-1">
                    <span className="mr-2 font-mono text-xs text-muted-foreground">{p.conta.codigo}</span>
                    {p.conta.nome}
                  </TableCell>
                  <TableCell className="py-1 text-right">{Number(p.debito) ? fmtValor(p.debito) : ""}</TableCell>
                  <TableCell className="py-1 text-right">{Number(p.credito) ? fmtValor(p.credito) : ""}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          ))}
        </Table>
      )}
    </RelatorioShell>
  );
}

export default function DiarioPage(props: PageProps<"/e/[id]/relatorios/diario">) {
  return (
    <Suspense fallback={<Carregando />}>
      <Diario {...props} />
    </Suspense>
  );
}
