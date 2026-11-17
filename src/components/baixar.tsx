"use client";

import { useTransition } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { baixarDocumento, baixarGuia } from "@/actions/ciclo";
import { Button } from "@/components/ui/button";

/** Baixa um documento recebido ou uma guia por URL assinada (5 min) criada no servidor. */
export function Baixar({ empresaId, documentoId, guiaId, rotulo = "Baixar", variant = "outline", size = "sm" }: {
  empresaId: string;
  documentoId?: string;
  /** Sem documentoId: baixa esta guia. */
  guiaId?: string;
  rotulo?: string;
  variant?: "outline" | "default" | "ghost";
  size?: "sm" | "default" | "icon-sm";
}) {
  const [pendente, iniciar] = useTransition();
  const baixar = () =>
    iniciar(async () => {
      const r = documentoId ? await baixarDocumento(empresaId, documentoId) : await baixarGuia(empresaId, guiaId!);
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
