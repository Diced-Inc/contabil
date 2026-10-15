import { Suspense } from "react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SINAIS, TIPOS_MATCH } from "@/lib/classificacao/regras";
import { getEmpresa } from "../empresa";
import { listarContasAnaliticas } from "../lancamentos/queries";
import { listarRegras } from "./queries";
import { AplicarRegrasButton, ExcluirRegraDialog, RegraDialog } from "./regra-dialog";

async function Regras({ params }: PageProps<"/e/[id]/regras">) {
  const { id } = await params;
  await getEmpresa(id);
  const [lista, contas] = await Promise.all([listarRegras(id), listarContasAnaliticas(id)]);

  return (
    <>
      <div className="mb-4 flex justify-end gap-2">
        <AplicarRegrasButton empresaId={id} />
        <RegraDialog empresaId={id} contas={contas} />
      </div>
      {lista.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma regra cadastrada.</p>
      ) : (
        <Table className="text-sm">
          <TableHeader>
            <TableRow>
              <TableHead className="text-right">Prioridade</TableHead>
              <TableHead>Nome</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Padrão</TableHead>
              <TableHead>Sinal</TableHead>
              <TableHead>Conta</TableHead>
              <TableHead>Ativa</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lista.map((r) => (
              <TableRow key={r.id} className={cn(!r.ativa && "text-muted-foreground")}>
                <TableCell className="text-right tabular-nums">{r.prioridade}</TableCell>
                <TableCell className="font-medium">{r.nome}</TableCell>
                <TableCell>{TIPOS_MATCH[r.tipoMatch]}</TableCell>
                <TableCell className="max-w-56 truncate font-mono text-xs">{r.padrao}</TableCell>
                <TableCell>{SINAIS[r.sinal]}</TableCell>
                <TableCell>
                  <span className="tabular-nums text-muted-foreground">{r.contaCodigo}</span> {r.contaNome}
                </TableCell>
                <TableCell>{r.ativa ? "Sim" : <Badge variant="outline">inativa</Badge>}</TableCell>
                <TableCell className="whitespace-nowrap">
                  <RegraDialog empresaId={id} contas={contas} regra={r} />
                  <ExcluirRegraDialog empresaId={id} regra={r} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}

export default function RegrasPage(props: PageProps<"/e/[id]/regras">) {
  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold">Regras</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Sugerem a conta das transações importadas. A regra de menor prioridade que casar vence.
      </p>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Carregando...</p>}>
        <Regras {...props} />
      </Suspense>
    </div>
  );
}
