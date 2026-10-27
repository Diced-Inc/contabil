"use client";

import { createContext, use, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "cn";
import { detalheConta } from "@/actions/relatorios";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtData, fmtSaldoDC, fmtValor } from "@/lib/format";
import { correr, semEstornos } from "@/lib/relatorios/movimentos";

type Alvo = { contaId: string; titulo: string; de: string; ate: string };
type Dados = Awaited<ReturnType<typeof detalheConta>>;

const Ctx = createContext<(a: Alvo) => void>(() => {});

/** Um painel de detalhe por página; as linhas abrem via ContaRow. */
export function ContaDetalheProvider({ empresaId, children }: { empresaId: string; children: ReactNode }) {
  const [alvo, setAlvo] = useState<Alvo | null>(null);
  const [dados, setDados] = useState<Dados | undefined>(undefined);
  const req = useRef(0);

  function abrir(a: Alvo) {
    const n = ++req.current;
    setAlvo(a);
    setDados(undefined);
    detalheConta(empresaId, a.contaId, a.de, a.ate).then(
      (d) => n === req.current && setDados(d),
      () => n === req.current && setDados(null),
    );
  }

  return (
    <Ctx value={abrir}>
      {children}
      <Sheet open={!!alvo} onOpenChange={(o) => !o && setAlvo(null)}>
        <SheetContent className="w-full gap-0 overflow-y-auto data-[side=right]:sm:max-w-[640px] print:hidden">
          {alvo && <Conteudo empresaId={empresaId} alvo={alvo} dados={dados} />}
        </SheetContent>
      </Sheet>
    </Ctx>
  );
}

function Conteudo({ empresaId, alvo, dados: bruto }: { empresaId: string; alvo: Alvo; dados: Dados | undefined }) {
  const [ocultar, setOcultar] = useState(true);
  const dados = bruto && ocultar ? { ...bruto, ...correr(semEstornos(bruto.movimentos), bruto.saldoAnterior) } : bruto;
  const razaoHref = `/e/${empresaId}/relatorios/razao?conta=${alvo.contaId}&de=${alvo.de}&ate=${alvo.ate}`;
  return (
    <>
      <SheetHeader className="border-b pr-12">
        <SheetTitle>{alvo.titulo}</SheetTitle>
        <SheetDescription>{fmtData(alvo.de)} a {fmtData(alvo.ate)}</SheetDescription>
        <label className="mt-1 flex w-fit cursor-pointer items-center gap-2 text-sm">
          <Checkbox checked={ocultar} onCheckedChange={setOcultar} />
          Ocultar estornos
        </label>
      </SheetHeader>
      <div className="flex-1 px-4 py-3">
        {dados === undefined ? (
          <div className="space-y-2" aria-label="Carregando">
            {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-7 animate-pulse rounded-md bg-muted" />)}
          </div>
        ) : dados === null ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Não foi possível carregar a conta.</p>
        ) : (
          <Table className="text-[13px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Data</TableHead>
                <TableHead className="w-12">Nº</TableHead>
                <TableHead>Histórico</TableHead>
                <TableHead>Contrap.</TableHead>
                <TableHead className="text-right">Débito</TableHead>
                <TableHead className="text-right">Crédito</TableHead>
                <TableHead className="text-right">Saldo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow className="bg-muted/40 font-semibold hover:bg-muted/40">
                <TableCell colSpan={6} className="py-1.5">Saldo anterior</TableCell>
                <TableCell className="py-1.5 text-right">{fmtSaldoDC(dados.saldoAnterior, dados.conta.natureza)}</TableCell>
              </TableRow>
              {dados.movimentos.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Nenhum movimento no período.</TableCell>
                </TableRow>
              ) : (
                dados.movimentos.map((m, i) => (
                  <TableRow key={`${m.lancamentoId}-${i}`}>
                    <TableCell className="py-1.5">{fmtData(m.data)}</TableCell>
                    <TableCell className="py-1.5">
                      <Link href={`/e/${empresaId}/lancamentos/${m.lancamentoId}`} className="text-primary underline-offset-2 hover:underline">
                        {m.numero}
                      </Link>
                    </TableCell>
                    <TableCell className="w-full max-w-0 truncate py-1.5" title={m.historico}>{m.historico}</TableCell>
                    <TableCell className="max-w-24 truncate py-1.5 font-mono text-xs" title={m.contrapartidas.map((c) => `${c.codigo} ${c.nome}`).join("\n")}>
                      {m.contrapartidas.map((c) => c.codigo).join(", ")}
                    </TableCell>
                    <TableCell className="py-1.5 text-right">{Number(m.debito) ? fmtValor(m.debito) : ""}</TableCell>
                    <TableCell className="py-1.5 text-right">{Number(m.credito) ? fmtValor(m.credito) : ""}</TableCell>
                    <TableCell className="py-1.5 text-right">{fmtSaldoDC(m.saldo, dados.conta.natureza)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
            <TableFooter className="border-t-2 border-t-foreground/70">
              <TableRow>
                <TableCell colSpan={6} className="py-1.5">Saldo final</TableCell>
                <TableCell className="py-1.5 text-right">{fmtSaldoDC(dados.saldoFinal, dados.conta.natureza)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        )}
      </div>
      <div className="border-t px-4 py-3">
        <Link href={razaoHref} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
          Abrir no Razão <ChevronRight className="size-4" />
        </Link>
      </div>
    </>
  );
}

/**
 * Linha de relatório que abre o detalhe da conta (só tela). Sem contaId é uma linha comum.
 * Célula com data-de/data-ate (ex.: coluna do ano anterior) abre aquele período no lugar do padrão.
 */
export function ContaRow({ contaId, titulo, de, ate, className, children }: {
  contaId?: string; titulo: string; de: string; ate: string; className?: string; children: ReactNode;
}) {
  const abrir = use(Ctx);
  if (!contaId) return <TableRow className={className}>{children}<TableCell className="w-6 p-0 print:hidden" /></TableRow>;

  const ir = (e: MouseEvent | KeyboardEvent) => {
    const cel = (e.target as HTMLElement).closest<HTMLElement>("[data-de]");
    abrir({ contaId, titulo, de: cel?.dataset.de ?? de, ate: cel?.dataset.ate ?? ate });
  };
  return (
    <TableRow
      tabIndex={0}
      className={cn("group cursor-pointer hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none", className)}
      onClick={ir}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), ir(e))}
    >
      {children}
      <TableCell className="w-6 p-0 pr-1 text-muted-foreground/50 group-hover:text-foreground print:hidden">
        <ChevronRight className="size-3.5" />
      </TableCell>
    </TableRow>
  );
}
