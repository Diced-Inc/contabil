import { Suspense } from "react";
import Link from "next/link";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtData, fmtValor } from "@/lib/format";
import type { TipoTitulo } from "@/lib/titulos";
import { getEmpresa } from "../empresa";
import { listarContasAnaliticas } from "../lancamentos/queries";
import { listarTitulos, PREFIXO_RESULTADO } from "./queries";
import { CancelarTituloDialog, TituloDialog } from "./titulo-dialog";

const ABAS: Record<TipoTitulo, string> = { receber: "A receber", pagar: "A pagar" };
const STATUS = {
  aberto: <Badge variant="secondary">aberto</Badge>,
  baixado: <Badge>baixado</Badge>,
  cancelado: <Badge variant="outline">cancelado</Badge>,
} as const;

async function Titulos({ params, searchParams }: PageProps<"/e/[id]/titulos">) {
  const { id } = await params;
  const sp = await searchParams;
  const tipo: TipoTitulo = sp.tipo === "pagar" ? "pagar" : "receber";
  await getEmpresa(id);
  const [lista, todas] = await Promise.all([listarTitulos(id, tipo), listarContasAnaliticas(id)]);
  const contas = todas.filter((c) => c.codigo.startsWith(PREFIXO_RESULTADO[tipo]));
  const lanc = (lid: string | null, numero: number | null) =>
    lid && (
      <Link href={`/e/${id}/lancamentos/${lid}`} className="tabular-nums underline-offset-4 hover:underline">
        nº {numero}
      </Link>
    );

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-2">
        <nav className="inline-flex rounded-lg bg-muted p-[3px] text-sm">
          {(Object.keys(ABAS) as TipoTitulo[]).map((t) => (
            <Link
              key={t}
              href={`/e/${id}/titulos?tipo=${t}`}
              className={cn(
                "rounded-md px-3 py-1 text-muted-foreground",
                t === tipo && "bg-background font-medium text-foreground shadow-sm",
              )}
            >
              {ABAS[t]}
            </Link>
          ))}
        </nav>
        <TituloDialog key={tipo} empresaId={id} tipo={tipo} contas={contas} />
      </div>
      {lista.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum título {ABAS[tipo].toLowerCase()}.</p>
      ) : (
        <Table className="text-sm">
          <TableHeader>
            <TableRow>
              <TableHead>Contraparte</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead>Documento</TableHead>
              <TableHead>Competência</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Lançamento</TableHead>
              <TableHead>Baixa</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lista.map((t) => (
              <TableRow key={t.id} className={cn(t.status === "cancelado" && "text-muted-foreground")}>
                <TableCell className="font-medium">{t.contraparte}</TableCell>
                <TableCell className="max-w-64 truncate">{t.descricao}</TableCell>
                <TableCell>{t.documento}</TableCell>
                <TableCell className="tabular-nums">{fmtData(t.competencia)}</TableCell>
                <TableCell className="tabular-nums">{t.vencimento && fmtData(t.vencimento)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtValor(t.valor)}</TableCell>
                <TableCell>{STATUS[t.status]}</TableCell>
                <TableCell>{lanc(t.lancamentoId, t.lancamentoNumero)}</TableCell>
                <TableCell>{lanc(t.baixaLancamentoId, t.baixaNumero)}</TableCell>
                <TableCell>{t.status === "aberto" && <CancelarTituloDialog empresaId={id} titulo={t} />}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}

export default function TitulosPage(props: PageProps<"/e/[id]/titulos">) {
  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold">Títulos</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Contas a receber e a pagar. A baixa é feita na conciliação, ao casar com a transação do extrato.
      </p>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Carregando...</p>}>
        <Titulos {...props} />
      </Suspense>
    </div>
  );
}
