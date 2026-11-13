"use client";

import { useState, useTransition } from "react";
import { BadgeCheck, CircleAlert, RotateCcw, Send } from "lucide-react";
import { toast } from "sonner";
import { concluirCiclo, marcarDasPago, prepararDas, reabrirCiclo } from "@/actions/ciclo";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { nomeCompetencia } from "@/lib/ciclo";
import { createClient } from "@/supabase/client";

/** "Concluir mês e enviar DAS": envia o PDF da guia direto ao Storage e conclui o ciclo. */
export function ConcluirDasDialog({ empresaId, competencia, vencimentoSugerido }: {
  empresaId: string;
  competencia: string;
  vencimentoSugerido: string;
}) {
  const [aberta, setAberta] = useState(false);
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();

  const enviar = (form: FormData) =>
    iniciar(async () => {
      setErro(undefined);
      const pdf = form.get("guia");
      if (!(pdf instanceof File) || pdf.size === 0) return setErro("Selecione o PDF da guia.");
      if (!pdf.name.toLowerCase().endsWith(".pdf")) return setErro("A guia precisa ser um PDF.");
      if (pdf.size > 10 * 1024 * 1024) return setErro("PDF maior que 10 MB.");
      const p = await prepararDas(empresaId, competencia);
      if ("erro" in p) return setErro(p.erro);
      const [envio] = p.envios;
      const up = await createClient()
        .storage.from("documentos")
        .uploadToSignedUrl(envio.path, envio.token, new File([pdf], pdf.name, { type: "application/pdf" }));
      if (up.error) return setErro(`Falha no envio do PDF: ${up.error.message}`);
      const r = await concluirCiclo(empresaId, competencia, {
        path: envio.path,
        valor: String(form.get("valor") ?? ""),
        vencimento: String(form.get("vencimento") ?? ""),
        observacao: String(form.get("observacao") ?? ""),
      });
      if ("erro" in r) return setErro(r.erro);
      const { enviados, total, naoConfigurado } = r.emails;
      if (total === 0) toast.warning("Mês concluído. A empresa não tem cliente com acesso ao portal: avise por outro canal.");
      else if (naoConfigurado) toast.warning("Mês concluído. E-mail não configurado (RESEND_API_KEY): avise o cliente por outro canal.");
      else if (enviados < total) toast.warning(`Mês concluído, mas ${total - enviados} de ${total} e-mails falharam.`);
      else toast.success(`Mês concluído. DAS enviado para ${total === 1 ? "o cliente" : `${total} clientes`}.`);
      setAberta(false);
    });

  return (
    <Dialog open={aberta} onOpenChange={(a) => !pendente && (setAberta(a), setErro(undefined))}>
      <DialogTrigger render={<Button />}>
        <Send />
        Concluir mês e enviar DAS
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Concluir {nomeCompetencia(competencia)}</DialogTitle>
          <DialogDescription>O cliente recebe um e-mail e vê a guia no portal, com valor e vencimento.</DialogDescription>
        </DialogHeader>
        <form action={enviar} className="grid gap-4">
          {erro && (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertDescription>{erro}</AlertDescription>
            </Alert>
          )}
          <div className="grid gap-2">
            <Label htmlFor="das-guia">PDF da guia (PGDAS)</Label>
            <Input id="das-guia" name="guia" type="file" accept=".pdf,application/pdf" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="das-valor">Valor (R$)</Label>
              <Input id="das-valor" name="valor" inputMode="decimal" placeholder="0,00" required autoComplete="off" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="das-vencimento">Vencimento</Label>
              <Input id="das-vencimento" name="vencimento" type="date" defaultValue={vencimentoSugerido} required />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="das-obs">Observação (opcional)</Label>
            <Textarea id="das-obs" name="observacao" maxLength={1000} placeholder="Aparece só para o contador." />
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>Cancelar</DialogClose>
            <Button type="submit" disabled={pendente}>
              <Send />
              {pendente ? "Enviando..." : "Concluir e enviar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CicloBotao({ empresaId, competencia, acao }: { empresaId: string; competencia: string; acao: "reabrir" | "pago" }) {
  const [pendente, iniciar] = useTransition();
  const executar = () =>
    iniciar(async () => {
      const r = await (acao === "reabrir" ? reabrirCiclo : marcarDasPago)(empresaId, competencia);
      if ("erro" in r) toast.error(r.erro);
      else toast.success(acao === "reabrir" ? "Ciclo reaberto." : "DAS marcado como pago.");
    });
  return (
    <Button variant="outline" onClick={executar} disabled={pendente}>
      {acao === "reabrir" ? <RotateCcw /> : <BadgeCheck />}
      {acao === "reabrir" ? "Reabrir" : "Marcar DAS como pago"}
    </Button>
  );
}
