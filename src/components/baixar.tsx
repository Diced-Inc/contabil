"use client";

import { useTransition } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { baixarDas, baixarDocumento } from "@/actions/ciclo";
import { Button } from "@/components/ui/button";

/** Baixa um documento recebido ou a guia do DAS por URL assinada (5 min) criada no servidor. */
export function Baixar({ empresaId, documentoId, competencia, rotulo = "Baixar", variant = "outline", size = "sm" }: {
  empresaId: string;
  documentoId?: string;
  /** Sem documentoId: baixa a guia do DAS desta competência. */
  competencia?: string;
  rotulo?: string;
  variant?: "outline" | "default" | "ghost";
  size?: "sm" | "default" | "icon-sm";
}) {
  const [pendente, iniciar] = useTransition();
  const baixar = () =>
    iniciar(async () => {
      const r = documentoId ? await baixarDocumento(empresaId, documentoId) : await baixarDas(empresaId, competencia!);
      if ("erro" in r) toast.error(r.erro);
      else window.location.assign(r.url);
    });
  return (
    <Button variant={variant} size={size} onClick={baixar} disabled={pendente} title={size === "icon-sm" ? rotulo : undefined} aria-label={rotulo}>
      <Download />
      {size !== "icon-sm" && rotulo}
    </Button>
  );
}
