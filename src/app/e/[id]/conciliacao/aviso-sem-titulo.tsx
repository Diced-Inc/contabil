"use client";

import { HandCoins, Info, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { AVISOS_SEM_TITULO, type TipoSemTitulo } from "@/lib/sem-titulo";

const alertaCls = "border-warning/25 bg-warning-soft text-warning *:data-[slot=alert-description]:text-warning/90";
const TITULOS = { clientes: "Direto em Clientes, sem título", impostos: "Direto em imposto a recolher, sem a obrigação" } as const;

/**
 * Aviso de classificação direta em conta de título (Clientes, impostos a recolher, Fornecedores).
 * Clientes exige "Sei o que estou fazendo" (`ciente`); `qtd` > 1 no lote; `onBaixarTitulo` quando há título aberto compatível.
 */
export function AvisoSemTitulo({ tipos, ciente, onCiente, qtd = 1, onBaixarTitulo }: {
  tipos: TipoSemTitulo[]; ciente: boolean; onCiente: (v: boolean) => void; qtd?: number; onBaixarTitulo?: () => void;
}) {
  const lote = qtd > 1 ? `${qtd} transações selecionadas. ` : "";
  return (
    <>
      {tipos.map((t) =>
        t === "fornecedores" ? (
          <p key={t} className="flex gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            {lote}{AVISOS_SEM_TITULO.fornecedores.texto}
          </p>
        ) : (
          <Alert key={t} className={alertaCls}>
            <TriangleAlert />
            <AlertTitle>{TITULOS[t]}</AlertTitle>
            <AlertDescription className="grid gap-2">
              <p>{lote}{AVISOS_SEM_TITULO[t].texto}</p>
              {t === "clientes" && (
                <>
                  {onBaixarTitulo && (
                    <Button type="button" variant="outline" size="sm" className="w-fit" onClick={onBaixarTitulo}>
                      <HandCoins />
                      Baixar título
                    </Button>
                  )}
                  <label className="flex items-center gap-2 font-medium text-foreground">
                    <Checkbox checked={ciente} onCheckedChange={(c) => onCiente(!!c)} />
                    Sei o que estou fazendo
                  </label>
                </>
              )}
            </AlertDescription>
          </Alert>
        ),
      )}
    </>
  );
}
