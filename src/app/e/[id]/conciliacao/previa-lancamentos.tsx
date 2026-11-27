"use client";

import { CalendarX2, Eye } from "lucide-react";
import { cn } from "cn";
import type { ContaOpcao } from "@/components/conta-select";
import { fmtCompetencia, fmtData, fmtValor, primeiroDiaDoMes } from "@/lib/format";
import type { LancPrevia } from "@/lib/operacoes";

/** Monta a prévia sem quebrar a tela: erro de validação (soma, conta faltando) vira a mensagem no lugar das partidas. */
export function montarPrevia(fn: () => LancPrevia[]): LancPrevia[] | string {
  try {
    return fn();
  } catch (e) {
    return (e as Error).message;
  }
}

/**
 * Prévia D/C exata do que será lançado (as mesmas funções puras que o servidor usa). `fechados`: competências
 * "YYYY-MM-01" fechadas, para avisar antes de enviar. `extra`: linhas a mais (lote: "+N lançamentos iguais").
 */
export function PreviaLancamentos({ previa, contas, fechados = [], extra }: {
  previa: LancPrevia[] | string; contas: ContaOpcao[]; fechados?: string[]; extra?: string;
}) {
  const porId = new Map(contas.map((c) => [c.id, c]));
  const varios = typeof previa !== "string" && previa.length > 1;
  return (
    <section className="grid gap-2" aria-label="Prévia do lançamento">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Eye className="size-3.5" />
        {varios ? `Prévia: ${(previa as LancPrevia[]).length} lançamentos` : "Prévia do lançamento"}
      </p>
      {typeof previa === "string" ? (
        <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">{previa}</p>
      ) : (
        previa.map((l, i) => {
          const fechado = fechados.includes(primeiroDiaDoMes(l.data));
          return (
            <div key={i} className={cn("overflow-hidden rounded-lg border text-sm", fechado && "border-danger/40")}>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 bg-muted/50 px-3 py-1.5 text-xs">
                <span className="font-medium tabular-nums">{fmtData(l.data)}</span>
                <span className="text-muted-foreground">competência {fmtCompetencia(l.competencia)}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground" title={l.historico}>{l.historico}</span>
              </div>
              <div className="divide-y">
                {l.partidas.map((p, k) => {
                  const c = porId.get(p.contaId);
                  const d = !!p.debito && Number(p.debito) > 0;
                  return (
                    <div key={k} className={cn("flex items-center gap-3 px-3 py-1.5", !d && "pl-7")}>
                      <span className={cn("w-4 text-xs font-semibold", d ? "text-foreground" : "text-muted-foreground")}>{d ? "D" : "C"}</span>
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-mono text-xs text-muted-foreground">{c?.codigo ?? "?"}</span> {c?.nome ?? "Conta"}
                      </span>
                      <span className="tabular-nums">{fmtValor(d ? p.debito! : p.credito!)}</span>
                    </div>
                  );
                })}
              </div>
              {fechado && (
                <p className="flex items-center gap-1.5 border-t bg-danger-soft px-3 py-1.5 text-xs text-danger">
                  <CalendarX2 className="size-3.5" />
                  Mês {fmtCompetencia(l.data)} fechado: reabra-o em Fechamento antes de aprovar.
                </p>
              )}
            </div>
          );
        })
      )}
      {extra && <p className="text-xs text-muted-foreground">{extra}</p>}
    </section>
  );
}
