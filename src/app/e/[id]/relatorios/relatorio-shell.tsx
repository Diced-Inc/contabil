import type { ReactNode } from "react";
import { fmtCnpj } from "@/lib/format";
import { Imprimir } from "./imprimir";

const emitidoEm = () =>
  new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

/** Cabeçalho de relatório (empresa, CNPJ, período, emissão) + botão Imprimir. Renderizar dentro do Suspense. */
export function RelatorioShell({ titulo, empresa, periodoLabel, filtros, children }: {
  titulo: string;
  empresa: { razaoSocial: string; cnpj: string };
  periodoLabel: string;
  filtros?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="print:p-0">
      {filtros && <div className="no-print mb-4">{filtros}</div>}
      <header className="mb-4 flex items-start justify-between gap-4 border-b pb-3">
        <div>
          <h1 className="text-xl font-semibold">{titulo}</h1>
          <p className="text-sm font-medium">{empresa.razaoSocial}</p>
          <p className="text-xs text-muted-foreground">CNPJ {fmtCnpj(empresa.cnpj)}</p>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <p>Período: {periodoLabel}</p>
          <p>Emitido em {emitidoEm()}</p>
          <div className="mt-2">
            <Imprimir />
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
