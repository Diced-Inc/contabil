import { Suspense } from "react";
import { connection } from "next/server";
import { Wand2 } from "lucide-react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Carregando, EmptyState, PageHeader, TablePanel } from "@/components/page-header";
import { SINAIS, TIPOS_MATCH } from "@/lib/classificacao/regras";
import { getEmpresa } from "../empresa";
import { listarContasAnaliticas } from "../lancamentos/queries";
import { listarRegras } from "./queries";
import { AplicarRegrasButton, ExcluirRegraDialog, RegraDialog } from "./regra-dialog";

// Server actions desta página rodam o pipeline de sugestão (IA).
export const maxDuration = 300;

async function Regras({ params }: PageProps<"/e/[id]/regras">) {
  await connection();
  const { id } = await params;
  await getEmpresa(id);
  const [lista, contas] = await Promise.all([listarRegras(id), listarContasAnaliticas(id)]);

  return (
    <>
      <PageHeader
        title="Regras"
        description={DESCRICAO}
        actions={
          <>
            <AplicarRegrasButton empresaId={id} />
            <RegraDialog empresaId={id} contas={contas} />
          </>
        }
      />
      {lista.length === 0 ? (
        <EmptyState
          icon={Wand2}
          title="Nenhuma regra cadastrada"
          hint="Regras classificam automaticamente as transações importadas pelo memo e pelo sinal."
          action={<RegraDialog empresaId={id} contas={contas} />}
        />
      ) : (
        <TablePanel>
          <Table>
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
                  <TableCell className="max-w-56 truncate"><code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{r.padrao}</code></TableCell>
                  <TableCell>
                    <Badge variant={r.sinal === "entrada" ? "success" : r.sinal === "saida" ? "danger" : "muted"}>{SINAIS[r.sinal]}</Badge>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs text-muted-foreground">{r.contaCodigo}</span> {r.contaNome}
                  </TableCell>
                  <TableCell>{r.ativa ? <Badge variant="success">Ativa</Badge> : <Badge variant="muted">Inativa</Badge>}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <RegraDialog empresaId={id} contas={contas} regra={r} />
                    <ExcluirRegraDialog empresaId={id} regra={r} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TablePanel>
      )}
    </>
  );
}

const DESCRICAO = "Sugerem a conta das transações importadas. A regra de menor prioridade que casar vence.";

export default function RegrasPage(props: PageProps<"/e/[id]/regras">) {
  return (
    <Suspense fallback={<><PageHeader title="Regras" description={DESCRICAO} /><Carregando /></>}>
      <Regras {...props} />
    </Suspense>
  );
}
