import { Suspense } from "react";
import { connection } from "next/server";
import { z } from "zod";
import { ContaSelect } from "@/components/conta-select";
import { DataRange, lerPeriodo } from "@/components/data-range";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtData, fmtSaldoDC, fmtValor } from "@/lib/format";
import { razao } from "@/lib/relatorios/razao";
import { Carregando } from "@/components/page-header";
import { getEmpresa } from "../../empresa";
import { listarContasAnaliticas } from "../../lancamentos/queries";
import { RelatorioShell } from "../relatorio-shell";

async function Razao({ params, searchParams }: PageProps<"/e/[id]/relatorios/razao">) {
  await connection();
  const { id } = await params;
  const sp = await searchParams;
  const empresa = await getEmpresa(id);
  const { de, ate } = lerPeriodo(sp, "mes");
  const contaId = typeof sp.conta === "string" && z.uuid().safeParse(sp.conta).success ? sp.conta : null;
  const [contas, r] = await Promise.all([listarContasAnaliticas(id), contaId ? razao(id, contaId, de, ate) : null]);

  return (
    <RelatorioShell
      titulo={r ? `Razão: ${r.conta.codigo} ${r.conta.nome}` : "Razão"}
      empresa={empresa}
      periodoLabel={`${fmtData(de)} a ${fmtData(ate)}`}
      filtros={
        <DataRange path={`/e/${id}/relatorios/razao`} sp={sp} de={de} ate={ate} proprios={["conta"]}>
          <div className="grid w-80 gap-1">
            <Label htmlFor="conta" className="text-xs text-muted-foreground">Conta</Label>
            <ContaSelect id="conta" name="conta" contas={contas} defaultValue={contaId} />
          </div>
        </DataRange>
      }
    >
      {!r ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Escolha uma conta e o período e clique em Aplicar.</p>
      ) : (
        <Table className="text-[13px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">Data</TableHead>
              <TableHead className="w-14">Nº</TableHead>
              <TableHead>Histórico</TableHead>
              <TableHead>Contrapartida</TableHead>
              <TableHead className="text-right">Débito</TableHead>
              <TableHead className="text-right">Crédito</TableHead>
              <TableHead className="text-right">Saldo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow className="bg-muted/40 font-semibold hover:bg-muted/40">
              <TableCell colSpan={6} className="py-1">Saldo anterior</TableCell>
              <TableCell className="py-1.5 text-right">{fmtSaldoDC(r.saldoAnterior, r.conta.natureza)}</TableCell>
            </TableRow>
            {r.movimentos.map((m, i) => (
              <TableRow key={`${m.lancamentoId}-${i}`}>
                <TableCell className="py-1.5">{fmtData(m.data)}</TableCell>
                <TableCell className="py-1.5">{m.numero}</TableCell>
                <TableCell className="py-1.5 whitespace-normal">{m.historico}</TableCell>
                <TableCell className="py-1.5">{m.contrapartidas}</TableCell>
                <TableCell className="py-1.5 text-right">{Number(m.debito) ? fmtValor(m.debito) : ""}</TableCell>
                <TableCell className="py-1.5 text-right">{Number(m.credito) ? fmtValor(m.credito) : ""}</TableCell>
                <TableCell className="py-1.5 text-right">{fmtSaldoDC(m.saldo, r.conta.natureza)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter className="border-t-2 border-t-foreground/70">
            <TableRow>
              <TableCell colSpan={6} className="py-1">Saldo final</TableCell>
              <TableCell className="py-1.5 text-right">{fmtSaldoDC(r.saldoFinal, r.conta.natureza)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      )}
    </RelatorioShell>
  );
}

export default function RazaoPage(props: PageProps<"/e/[id]/relatorios/razao">) {
  return (
    <Suspense fallback={<Carregando />}>
      <Razao {...props} />
    </Suspense>
  );
}
