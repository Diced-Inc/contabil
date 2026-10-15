import { Suspense } from "react";
import { connection } from "next/server";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtData, fmtValor } from "@/lib/format";
import { getEmpresa } from "../empresa";
import { ContaBancariaDialog } from "./conta-bancaria-dialog";
import { ImportarOfxDialog } from "./importar-ofx-dialog";
import { listarContasAtivoAnaliticas, listarContasComSaldo, listarImportacoes } from "./queries";

// Server actions desta página rodam o pipeline de sugestão (IA).
export const maxDuration = 300;

const TZ = "America/Sao_Paulo";
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
      <div className="mb-4 flex justify-end gap-2">
        <ContaBancariaDialog empresaId={id} contas={opcoes} />
        <ImportarOfxDialog empresaId={id} contas={contas.filter((c) => c.ativa)} />
      </div>

      {contas.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma conta bancária cadastrada.</p>
      ) : (
        <Table className="text-sm">
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
            {contas.map((c) => (
              <TableRow key={c.id} className={cn(!c.ativa && "text-muted-foreground")}>
                <TableCell>
                  <div className="font-medium">
                    {c.nome}
                    {!c.ativa && <Badge variant="outline" className="ml-2">inativa</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {[c.banco, c.agencia && `ag. ${c.agencia}`, c.numero && `c/c ${c.numero}`].filter(Boolean).join(" · ") || "-"}
                  </div>
                </TableCell>
                <TableCell>
                  <span className="tabular-nums text-muted-foreground">{c.contaCodigo}</span> {c.contaNome}
                </TableCell>
                <TableCell>
                  {c.dataSaldo ? fmtData(c.dataSaldo) : traco}
                  {c.importadoEm && (
                    <div className="text-xs text-muted-foreground">importado {c.importadoEm.toLocaleDateString("pt-BR", { timeZone: TZ })}</div>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{moeda(c.saldoOfx)}</TableCell>
                <TableCell className="text-right tabular-nums">{moeda(c.saldoContabil)}</TableCell>
                <TableCell className="text-right tabular-nums">{moeda(c.pendentes)}</TableCell>
                <TableCell className="text-right tabular-nums">{moeda(c.ignoradas)}</TableCell>
                <TableCell className="text-right">
                  {c.diferenca === null ? traco : (
                    <span className={cn("tabular-nums", Number(c.diferenca) !== 0 && "font-semibold text-red-700")}>
                      {fmtValor(c.diferenca)}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <ContaBancariaDialog empresaId={id} contas={opcoes} conta={c} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {contas.map((c) => {
        const lista = imports.filter((i) => i.contaBancariaId === c.id);
        if (lista.length === 0) return null;
        return (
          <details key={c.id} className="mt-6">
            <summary className="cursor-pointer text-sm font-medium">
              Importações de {c.nome} ({lista.length})
            </summary>
            <Table className="mt-2 text-sm">
              <TableHeader>
                <TableRow>
                  <TableHead>Arquivo</TableHead>
                  <TableHead>Período</TableHead>
                  <TableHead className="text-right">Transações</TableHead>
                  <TableHead className="text-right">Novas</TableHead>
                  <TableHead>Importado em</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="max-w-64 truncate">{i.nomeArquivo}</TableCell>
                    <TableCell>
                      {i.periodoInicio ? fmtData(i.periodoInicio) : "?"} a {i.periodoFim ? fmtData(i.periodoFim) : "?"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{i.qtdTransacoes}</TableCell>
                    <TableCell className="text-right tabular-nums">{i.qtdNovas}</TableCell>
                    <TableCell>{i.createdAt.toLocaleString("pt-BR", { timeZone: TZ })}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </details>
        );
      })}
    </>
  );
}

export default function BancosPage(props: PageProps<"/e/[id]/bancos">) {
  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold">Bancos</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Conferência na data do saldo do último OFX: diferença = saldo OFX − saldo contábil − pendentes − ignoradas. Zero quando tudo está conciliado.
      </p>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Carregando...</p>}>
        <Bancos {...props} />
      </Suspense>
    </div>
  );
}
