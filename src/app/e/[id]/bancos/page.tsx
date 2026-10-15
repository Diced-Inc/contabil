import { Suspense } from "react";
import { connection } from "next/server";
import { ChevronRight, FileUp, Landmark } from "lucide-react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Carregando, EmptyState, PageHeader, TablePanel } from "@/components/page-header";
import { fmtData, fmtValor } from "@/lib/format";
import { getEmpresa } from "../empresa";
import { ContaBancariaDialog } from "./conta-bancaria-dialog";
import { ImportarOfxDialog } from "./importar-ofx-dialog";
import { listarContasAtivoAnaliticas, listarContasComSaldo, listarImportacoes } from "./queries";

// Server actions desta página rodam o pipeline de sugestão (IA).
export const maxDuration = 300;

const TZ = "America/Sao_Paulo";
const DESCRICAO =
  "Conferência na data do saldo do último OFX: diferença = saldo OFX − saldo contábil − pendentes − ignoradas. Zero quando tudo está conciliado.";
const traco = <span className="text-muted-foreground">-</span>;
const moeda = (v: string | null) => (v === null ? traco : fmtValor(v));

async function Bancos({ params }: PageProps<"/e/[id]/bancos">) {
  await connection();
  const { id } = await params;
  await getEmpresa(id);
  const [contas, opcoes, imports] = await Promise.all([
    listarContasComSaldo(id),
    listarContasAtivoAnaliticas(id),
    listarImportacoes(id),
  ]);

  return (
    <>
      <PageHeader
        title="Bancos"
        description={DESCRICAO}
        actions={
          <>
            <ContaBancariaDialog empresaId={id} contas={opcoes} />
            <ImportarOfxDialog empresaId={id} contas={contas.filter((c) => c.ativa)} />
          </>
        }
      />

      {contas.length === 0 ? (
        <EmptyState
          icon={Landmark}
          title="Nenhuma conta bancária cadastrada"
          hint="Cadastre a conta e vincule-a a uma conta contábil do Ativo para importar extratos."
          action={<ContaBancariaDialog empresaId={id} contas={opcoes} />}
        />
      ) : (
        <TablePanel>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Conta</TableHead>
                <TableHead>Conta contábil</TableHead>
                <TableHead>Saldo em</TableHead>
                <TableHead className="text-right">Saldo OFX</TableHead>
                <TableHead className="text-right">Saldo contábil</TableHead>
                <TableHead className="text-right">Pendentes</TableHead>
                <TableHead className="text-right">Ignoradas</TableHead>
                <TableHead className="text-right">Diferença</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {contas.map((c) => {
                const diverge = c.diferenca !== null && Number(c.diferenca) !== 0;
                return (
                  <TableRow key={c.id} className={cn(!c.ativa && "text-muted-foreground")}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                          <Landmark className="size-4" />
                        </span>
                        <div>
                          <div className="font-medium text-foreground">
                            {c.nome}
                            {!c.ativa && <Badge variant="muted" className="ml-2">inativa</Badge>}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {[c.banco, c.agencia && `ag. ${c.agencia}`, c.numero && `c/c ${c.numero}`].filter(Boolean).join(" · ") || "-"}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-56 whitespace-normal">
                      <div className="font-mono text-xs text-muted-foreground">{c.contaCodigo}</div>
                      <div className="leading-snug">{c.contaNome}</div>
                    </TableCell>
                    <TableCell>
                      {c.dataSaldo ? fmtData(c.dataSaldo) : traco}
                      {c.importadoEm && (
                        <div className="text-xs text-muted-foreground">
                          importado {c.importadoEm.toLocaleDateString("pt-BR", { timeZone: TZ })}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium">{moeda(c.saldoOfx)}</TableCell>
                    <TableCell className="text-right">{moeda(c.saldoContabil)}</TableCell>
                    <TableCell className="text-right">{moeda(c.pendentes)}</TableCell>
                    <TableCell className="text-right">{moeda(c.ignoradas)}</TableCell>
                    <TableCell className="text-right">
                      {c.diferenca === null ? traco : diverge ? (
                        <Badge variant="danger" className="tabular-nums">{fmtValor(c.diferenca)}</Badge>
                      ) : (
                        <Badge variant="success" className="tabular-nums">{fmtValor(c.diferenca)}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <ContaBancariaDialog empresaId={id} contas={opcoes} conta={c} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TablePanel>
      )}

      {contas.some((c) => imports.some((i) => i.contaBancariaId === c.id)) && (
        <h2 className="mt-8 mb-3 text-sm font-semibold text-foreground">Histórico de importações</h2>
      )}
      <div className="space-y-3">
        {contas.map((c) => {
          const lista = imports.filter((i) => i.contaBancariaId === c.id);
          if (lista.length === 0) return null;
          return (
            <details key={c.id} className="group overflow-hidden rounded-xl border bg-card shadow-card">
              <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-3.5 text-sm hover:bg-muted/40">
                <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
                <FileUp className="size-4 text-muted-foreground" />
                <span className="font-medium">{c.nome}</span>
                <Badge variant="muted">{lista.length} {lista.length === 1 ? "arquivo" : "arquivos"}</Badge>
              </summary>
              <div className="border-t">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-5">Arquivo</TableHead>
                      <TableHead>Período</TableHead>
                      <TableHead className="text-right">Transações</TableHead>
                      <TableHead className="text-right">Novas</TableHead>
                      <TableHead className="pr-5">Importado em</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lista.map((i) => (
                      <TableRow key={i.id}>
                        <TableCell className="max-w-64 truncate pl-5 font-medium">{i.nomeArquivo}</TableCell>
                        <TableCell>
                          {i.periodoInicio ? fmtData(i.periodoInicio) : "?"} a {i.periodoFim ? fmtData(i.periodoFim) : "?"}
                        </TableCell>
                        <TableCell className="text-right">{i.qtdTransacoes}</TableCell>
                        <TableCell className="text-right">{i.qtdNovas}</TableCell>
                        <TableCell className="pr-5 text-muted-foreground">{i.createdAt.toLocaleString("pt-BR", { timeZone: TZ })}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </details>
          );
        })}
      </div>
    </>
  );
}

export default function BancosPage(props: PageProps<"/e/[id]/bancos">) {
  return (
    <Suspense fallback={<><PageHeader title="Bancos" description={DESCRICAO} /><Carregando /></>}>
      <Bancos {...props} />
    </Suspense>
  );
}
