import type { ReactNode } from "react";
import { PageHeader } from "@/components/page-header";
import { fmtCnpj } from "@/lib/format";
import { Imprimir } from "./imprimir";

const emitidoEm = () =>
  new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

/** Página de relatório: título + Imprimir, filtros, e a "folha" com cabeçalho de demonstração. Renderizar dentro do Suspense. */
export function RelatorioShell({ titulo, empresa, periodoLabel, filtros, children }: {
  titulo: string;
  empresa: { razaoSocial: string; cnpj: string };
  periodoLabel: string;
  filtros?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="print:p-0">
      <PageHeader className="no-print" title={titulo} description={`${empresa.razaoSocial} · ${periodoLabel}`} actions={<Imprimir />} />
      {filtros && <div className="no-print mb-4 rounded-xl border bg-card p-3 shadow-card">{filtros}</div>}
      <article className="print-flat overflow-hidden rounded-xl border bg-card shadow-card">
        <header className="flex items-end justify-between gap-6 border-b-2 border-foreground/80 px-8 pt-7 pb-4 print:px-0 print:pt-0">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">{titulo}</p>
            <p className="mt-1.5 text-lg font-semibold tracking-tight">{empresa.razaoSocial}</p>
            <p className="text-sm text-muted-foreground tabular-nums">CNPJ {fmtCnpj(empresa.cnpj)}</p>
          </div>
          <dl className="shrink-0 text-right text-xs text-muted-foreground tabular-nums">
            <dt className="sr-only">Período</dt>
            <dd className="text-sm font-medium text-foreground">{periodoLabel}</dd>
            <dt className="sr-only">Emissão</dt>
            <dd className="mt-0.5">Emitido em {emitidoEm()}</dd>
          </dl>
        </header>
        <div className="px-4 pt-2 pb-6 print:px-0">{children}</div>
      </article>
    </div>
  );
}
