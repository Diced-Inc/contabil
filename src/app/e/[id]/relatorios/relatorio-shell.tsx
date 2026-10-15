import type { ReactNode } from "react";
import { PageHeader } from "@/components/page-header";
import { fmtCnpj, fmtCpf, fmtDataExtenso } from "@/lib/format";
import { Imprimir } from "./imprimir";

type Empresa = {
  razaoSocial: string;
  cnpj: string;
  cidade: string | null;
  uf: string | null;
  responsavelNome: string | null;
  responsavelCpf: string | null;
  contadorNome: string | null;
  contadorCpf: string | null;
  contadorCrc: string | null;
};

const emitidoEm = () =>
  new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

const detalhe = "text-xs text-muted-foreground print:text-black";

function Assinatura({ nome, children }: { nome: string | null; children: ReactNode }) {
  return (
    <div className="w-[260px] max-w-full">
      <div className="border-t border-foreground print:border-black" />
      {nome ? (
        <>
          <p className="mt-1.5 text-sm font-medium uppercase">{nome}</p>
          <div className={detalhe}>{children}</div>
        </>
      ) : (
        <p className="mt-1.5 text-xs text-muted-foreground italic print:hidden">Cadastre em Configurações</p>
      )}
    </div>
  );
}

/** Local e data por extenso + linhas de assinatura do responsável legal e do contador. */
function Assinaturas({ empresa, data }: { empresa: Empresa; data: string }) {
  const { contadorCrc: crc, uf } = empresa;
  // CRC completo ("CE-015797/O") já traz a UF; só o número ("015797") recebe a UF da empresa.
  const registro = crc && (/^[A-Z]{2}-/i.test(crc) || !uf ? `Reg. no CRC sob o No. ${crc}` : `Reg. no CRC - ${uf} sob o No. ${crc}`);
  return (
    <footer className="mt-12 break-inside-avoid px-8 pb-8 print:px-0 print:pb-0">
      <p className="text-sm">
        {empresa.cidade && `${empresa.cidade.toUpperCase()}, `}
        {fmtDataExtenso(data)}
      </p>
      <div className="mt-16 flex flex-wrap justify-between gap-x-12 gap-y-10">
        <Assinatura nome={empresa.responsavelNome}>
          {empresa.responsavelCpf && <p>CPF: {fmtCpf(empresa.responsavelCpf)}</p>}
        </Assinatura>
        <Assinatura nome={empresa.contadorNome}>
          {registro && <p>{registro}</p>}
          {empresa.contadorCpf && <p>CPF: {fmtCpf(empresa.contadorCpf)}</p>}
        </Assinatura>
      </div>
    </footer>
  );
}

/** Página de relatório: título + Imprimir, filtros, e a "folha" com cabeçalho de demonstração e assinaturas. Renderizar dentro do Suspense. */
export function RelatorioShell({ titulo, empresa, periodoLabel, dataAssinatura, filtros, children }: {
  titulo: string;
  empresa: Empresa;
  periodoLabel: string;
  /** Fim do período, "YYYY-MM-DD": data do local/data acima das assinaturas. */
  dataAssinatura: string;
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
        <Assinaturas empresa={empresa} data={dataAssinatura} />
      </article>
    </div>
  );
}
