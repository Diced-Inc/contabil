"use client";

import { createContext, use, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { detalheLancamento } from "@/actions/relatorios";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cents, fmtCompetencia, fmtData, fmtValor, fromCents } from "@/lib/format";

type Dados = Awaited<ReturnType<typeof detalheLancamento>>;
const ORIGENS = { manual: "Manual", conciliacao: "Conciliação", apuracao: "Apuração", estorno: "Estorno" } as const;
const ORIGEM_BADGE = { manual: "muted", conciliacao: "info", apuracao: "violet", estorno: "warning" } as const;

const Ctx = createContext<(id: string) => void>(() => {});

/** Painel do lançamento (só tela); as linhas do Razão abrem via LinhaLancamento. */
export function LancamentoProvider({ empresaId, children }: { empresaId: string; children: ReactNode }) {
  const [alvo, setAlvo] = useState<string | null>(null);
  const [dados, setDados] = useState<Dados | undefined>(undefined);
  const req = useRef(0);

  function abrir(id: string) {
    const n = ++req.current;
    setAlvo(id);
    setDados(undefined);
    detalheLancamento(empresaId, id).then(
      (d) => n === req.current && setDados(d),
      () => n === req.current && setDados(null),
    );
  }

  return (
    <Ctx value={abrir}>
      {children}
      <Sheet open={!!alvo} onOpenChange={(o) => !o && setAlvo(null)}>
        <SheetContent className="w-full gap-0 overflow-y-auto data-[side=right]:sm:max-w-[560px] print:hidden">
          {alvo && <Conteudo empresaId={empresaId} id={alvo} dados={dados} />}
        </SheetContent>
      </Sheet>
    </Ctx>
  );
}

function Conteudo({ empresaId, id, dados }: { empresaId: string; id: string; dados: Dados | undefined }) {
  const base = `/e/${empresaId}/lancamentos`;
  if (dados === undefined)
    return (
      <div className="space-y-2 p-4" aria-label="Carregando">
        <SheetTitle className="sr-only">Carregando lançamento</SheetTitle>
        {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-7 animate-pulse rounded-md bg-muted" />)}
      </div>
    );
  if (dados === null)
    return (
      <div className="p-4">
        <SheetTitle className="sr-only">Lançamento</SheetTitle>
        <p className="py-10 text-center text-sm text-muted-foreground">Não foi possível carregar o lançamento.</p>
      </div>
    );
  const l = dados;
  const totalD = l.partidas.reduce((s, p) => s + cents(p.debito), 0);
  const totalC = l.partidas.reduce((s, p) => s + cents(p.credito), 0);
  return (
    <>
      <SheetHeader className="border-b pr-12">
        <SheetTitle className="flex flex-wrap items-center gap-2">
          Lançamento nº {l.numero}
          <Badge variant={ORIGEM_BADGE[l.origem]}>{ORIGENS[l.origem]}</Badge>
          {l.status === "estornado" ? <Badge variant="muted" className="line-through">Estornado</Badge> : <Badge variant="success">Aprovado</Badge>}
        </SheetTitle>
        <SheetDescription>{fmtData(l.data)} · competência {fmtCompetencia(l.competencia)}</SheetDescription>
      </SheetHeader>
      <div className="flex-1 space-y-4 px-4 py-3 text-sm">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 [&_dd]:mt-0.5 [&_dd]:font-medium [&_dt]:text-xs [&_dt]:text-muted-foreground">
          <div className="col-span-full"><dt>Histórico</dt><dd>{l.historico}</dd></div>
          <div><dt>Documento</dt><dd>{l.documento ?? "-"}</dd></div>
          <div><dt>Pagamento</dt><dd>{l.dataPagamento ? fmtData(l.dataPagamento) : "-"}</dd></div>
          {l.original && (
            <div><dt>Estorno de</dt><dd><Link href={`${base}/${l.original.id}`} className="text-primary hover:underline">Lançamento {l.original.numero}</Link></dd></div>
          )}
          {l.estorno && (
            <div><dt>Estornado por</dt><dd><Link href={`${base}/${l.estorno.id}`} className="text-primary hover:underline">Lançamento {l.estorno.numero}</Link></dd></div>
          )}
        </dl>
        <Table className="text-[13px]">
          <TableHeader>
            <TableRow>
              <TableHead>Conta</TableHead>
              <TableHead className="text-right">Débito</TableHead>
              <TableHead className="text-right">Crédito</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {l.partidas.map((p, i) => (
              <TableRow key={i}>
                <TableCell className="py-1.5 whitespace-normal">
                  <span className="mr-2 font-mono text-xs text-muted-foreground">{p.codigo}</span>{p.nome}
                </TableCell>
                <TableCell className="py-1.5 text-right">{Number(p.debito) ? fmtValor(p.debito) : ""}</TableCell>
                <TableCell className="py-1.5 text-right">{Number(p.credito) ? fmtValor(p.credito) : ""}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="py-1.5">Total</TableCell>
              <TableCell className="py-1.5 text-right">{fmtValor(fromCents(totalD))}</TableCell>
              <TableCell className="py-1.5 text-right">{fmtValor(fromCents(totalC))}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
      <div className="border-t px-4 py-3">
        <Link href={`${base}/${id}`} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
          Abrir lançamento <ChevronRight className="size-4" />
        </Link>
      </div>
    </>
  );
}

/** Linha do Razão que abre o lançamento no painel; clique em link dentro da linha navega normalmente. */
export function LinhaLancamento({ id, children }: { id: string; children: ReactNode }) {
  const abrir = use(Ctx);
  return (
    <TableRow
      tabIndex={0}
      className="group cursor-pointer break-inside-avoid hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
      onClick={(e) => !(e.target as HTMLElement).closest("a") && abrir(id)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && (e.preventDefault(), abrir(id))}
    >
      {children}
      <TableCell className="w-6 p-0 pr-1 text-muted-foreground/50 group-hover:text-foreground print:hidden">
        <ChevronRight className="size-3.5" />
      </TableCell>
    </TableRow>
  );
}
