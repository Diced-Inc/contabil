import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { Receipt } from "lucide-react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Carregando, EmptyState, PageHeader, TablePanel } from "@/components/page-header";
import { fmtData, fmtValor } from "@/lib/format";
import type { TipoTitulo } from "@/lib/titulos";
import { getEmpresa } from "../empresa";
import { listarContasAnaliticas } from "../lancamentos/queries";
import { listarTitulos, PREFIXO_RESULTADO } from "./queries";
import { CancelarTituloDialog, TituloDialog } from "./titulo-dialog";

const ABAS: Record<TipoTitulo, string> = { receber: "A receber", pagar: "A pagar" };
const STATUS = {
  aberto: <Badge variant="warning">Aberto</Badge>,
  baixado: <Badge variant="success">Baixado</Badge>,
  cancelado: <Badge variant="muted" className="line-through">Cancelado</Badge>,
} as const;

async function Titulos({ params, searchParams }: PageProps<"/e/[id]/titulos">) {
  await connection();
  const { id } = await params;
  const sp = await searchParams;
  const tipo: TipoTitulo = sp.tipo === "pagar" ? "pagar" : "receber";
  await getEmpresa(id);
  const [lista, todas] = await Promise.all([listarTitulos(id, tipo), listarContasAnaliticas(id)]);
  const contas = todas.filter((c) => c.codigo.startsWith(PREFIXO_RESULTADO[tipo]));
  const lanc = (lid: string | null, numero: number | null) =>
    lid && (
      <Link href={`/e/${id}/lancamentos/${lid}`} className="font-medium text-primary underline-offset-4 hover:underline">
        nº {numero}
      </Link>
    );

  return (
    <>
      <PageHeader
        title="Títulos"
        description={DESCRICAO}
        actions={<TituloDialog key={tipo} empresaId={id} tipo={tipo} contas={contas} />}
      />
      <div className="mb-4">
        <nav className="inline-flex rounded-lg border bg-muted p-[3px] text-sm">
          {(Object.keys(ABAS) as TipoTitulo[]).map((t) => (
            <Link
              key={t}
              href={`/e/${id}/titulos?tipo=${t}`}
              className={cn(
                "inline-flex h-8 items-center rounded-md px-3 font-medium text-muted-foreground transition-colors hover:text-foreground",
                t === tipo && "bg-card text-foreground shadow-xs",
              )}
            >
              {ABAS[t]}
            </Link>
          ))}
        </nav>
      </div>
      {lista.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={`Nenhum título ${ABAS[tipo].toLowerCase()}`}
          hint="A baixa acontece na conciliação, ao casar o título com a transação do extrato."
          action={<TituloDialog key={`vazio-${tipo}`} empresaId={id} tipo={tipo} contas={contas} />}
        />
      ) : (
        <TablePanel>
          <Table>
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
                  <TableCell className="text-muted-foreground">{fmtData(t.competencia)}</TableCell>
                  <TableCell>{t.vencimento && fmtData(t.vencimento)}</TableCell>
                  <TableCell className="text-right font-medium">{fmtValor(t.valor)}</TableCell>
                  <TableCell>{STATUS[t.status]}</TableCell>
                  <TableCell>{lanc(t.lancamentoId, t.lancamentoNumero)}</TableCell>
                  <TableCell>{lanc(t.baixaLancamentoId, t.baixaNumero)}</TableCell>
                  <TableCell>{t.status === "aberto" && <CancelarTituloDialog empresaId={id} titulo={t} />}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TablePanel>
      )}
    </>
  );
}

const DESCRICAO = "Contas a receber e a pagar. A baixa é feita na conciliação, ao casar com a transação do extrato.";

export default function TitulosPage(props: PageProps<"/e/[id]/titulos">) {
  return (
    <Suspense fallback={<><PageHeader title="Títulos" description={DESCRICAO} /><Carregando /></>}>
      <Titulos {...props} />
    </Suspense>
  );
}
