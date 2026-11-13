"use client";

import { useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Upload } from "lucide-react";
import { toast } from "sonner";
import { baixarDocumento, marcarProcessado } from "@/actions/ciclo";
import { Button } from "@/components/ui/button";
import { extensao } from "@/lib/ciclo";
import { ImportarOfxDialog, type Inicial } from "../bancos/importar-ofx-dialog";

type Conta = { id: string; nome: string; numero: string | null };

/** "Importar" (diálogo de Bancos com o arquivo já carregado) e "Marcar como processado". */
export function DocumentoAcoes({ empresaId, documento, contas }: {
  empresaId: string;
  documento: { id: string; nome: string; contaId: string | null; processado: boolean };
  contas: Conta[];
}) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const importavel = ["ofx", "csv", "pdf"].includes(extensao(documento.nome));

  // Estável entre renders: o diálogo baixa o arquivo uma vez ao abrir.
  const inicial = useMemo<Inicial>(
    () => ({
      contaId: documento.contaId,
      carregar: async () => {
        const r = await baixarDocumento(empresaId, documento.id);
        if ("erro" in r) throw new Error(r.erro);
        const resp = await fetch(r.url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return new File([await resp.blob()], documento.nome);
      },
    }),
    [empresaId, documento.id, documento.nome, documento.contaId],
  );

  const marcar = (importacaoId: string | null) =>
    iniciar(async () => {
      const r = await marcarProcessado(empresaId, documento.id, importacaoId);
      if ("erro" in r) toast.error(r.erro);
      else if (!importacaoId) {
        toast.success("Documento marcado como processado.");
        router.refresh();
      }
    });

  return (
    <>
      {importavel && (
        <ImportarOfxDialog
          empresaId={empresaId}
          contas={contas}
          inicial={inicial}
          onImportado={(ids) => marcar(ids[0])}
          gatilho={
            <Button
              size="sm"
              variant={documento.processado ? "outline" : "default"}
              disabled={contas.length === 0}
              title={contas.length === 0 ? "Cadastre a conta bancária em Bancos para importar." : "Abre a importação de extrato com este arquivo."}
            >
              <Upload />
              {documento.processado ? "Importar de novo" : "Importar"}
            </Button>
          }
        />
      )}
      {!documento.processado && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => marcar(null)}
          disabled={pendente}
          title="Use quando você já lançou este arquivo de outro jeito ou ele não precisa ser importado."
        >
          <Check />
          {pendente ? "Marcando..." : "Marcar como processado"}
        </Button>
      )}
    </>
  );
}
