"use client";

import { useState, useTransition } from "react";
import { CalendarCheck2, Play, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { encerrarCiclo, iniciarProcessamento, reabrirCiclo } from "@/actions/ciclo";
import { Erro } from "@/app/login/senha-forms";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MOTIVOS_ENCERRAMENTO, nomeCompetencia, tituloCompetencia, type MotivoEncerramento } from "@/lib/ciclo";

/** "Começar processamento": o cliente vê "Em processamento" no portal. Não manda e-mail. */
export function ProcessarBotao({ empresaId, competencia, variant = "default" }: {
  empresaId: string; competencia: string; variant?: "default" | "outline";
}) {
  const [pendente, iniciar] = useTransition();
  const executar = () =>
    iniciar(async () => {
      const r = await iniciarProcessamento(empresaId, competencia);
      if ("erro" in r) toast.error(r.erro);
      else toast.success("Mês em processamento. O cliente já vê isso no portal.");
    });
  return (
    <Button variant={variant} onClick={executar} disabled={pendente} title="O cliente passa a ver “Em processamento” no portal. Nenhum e-mail sai.">
      <Play />
      {pendente ? "Começando..." : "Começar processamento"}
    </Button>
  );
}

export function ReabrirBotao({ empresaId, competencia }: { empresaId: string; competencia: string }) {
  const [pendente, iniciar] = useTransition();
  const executar = () =>
    iniciar(async () => {
      const r = await reabrirCiclo(empresaId, competencia);
      if ("erro" in r) toast.error(r.erro);
      else toast.success("Mês reaberto. As guias em aberto voltaram a não enviadas: corrija e envie de novo.");
    });
  return (
    <Button
      variant="outline"
      onClick={executar}
      disabled={pendente}
      title="Volta o mês para em processamento. As guias em aberto saem do portal até você enviar de novo; as pagas continuam pagas."
    >
      <RotateCcw />
      Reabrir
    </Button>
  );
}

/** "Encerrar mês sem guias": motivo + anotação interna. Não manda e-mail; o mês sai das pendências e os lembretes param. */
export function EncerrarDialog({ empresaId, competencia }: { empresaId: string; competencia: string }) {
  const [aberta, setAberta] = useState(false);
  const [motivo, setMotivo] = useState<MotivoEncerramento | null>(null);
  const [observacao, setObservacao] = useState("");
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();
  const confirmar = () =>
    iniciar(async () => {
      if (!motivo) return setErro("Escolha o motivo.");
      const r = await encerrarCiclo(empresaId, competencia, { motivo, observacao });
      if ("erro" in r) return setErro(r.erro);
      toast.success(`${tituloCompetencia(competencia)} encerrado.`);
      setAberta(false);
    });
  return (
    <Dialog
      open={aberta}
      onOpenChange={(a) => {
        if (pendente) return;
        setAberta(a);
        if (a) {
          setMotivo(null);
          setObservacao("");
          setErro(undefined);
        }
      }}
    >
      <DialogTrigger render={<Button variant="outline" />}>
        <CalendarCheck2 />
        Encerrar mês sem guias
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Encerrar {nomeCompetencia(competencia)} sem guias</DialogTitle>
          <DialogDescription>O mês sai das pendências e o cliente para de receber lembretes. Nenhum e-mail é enviado.</DialogDescription>
        </DialogHeader>
        <Erro>{erro}</Erro>
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm leading-none font-medium">Motivo</legend>
          {(Object.keys(MOTIVOS_ENCERRAMENTO) as MotivoEncerramento[]).map((m) => (
            <label
              key={m}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors hover:bg-muted/50",
                motivo === m && "border-primary bg-accent/50",
              )}
            >
              <input
                type="radio"
                name="encerrar-motivo"
                value={m}
                checked={motivo === m}
                onChange={() => (setMotivo(m), setErro(undefined))}
                className="size-4 accent-primary"
              />
              {MOTIVOS_ENCERRAMENTO[m].rotulo}
            </label>
          ))}
        </fieldset>
        <div className="grid gap-2">
          <Label htmlFor="encerrar-obs">
            Observação <span className="font-normal text-muted-foreground">(opcional, o cliente não vê)</span>
          </Label>
          <Textarea id="encerrar-obs" value={observacao} onChange={(e) => setObservacao(e.target.value)} maxLength={1000} rows={2} />
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />} disabled={pendente}>
            Cancelar
          </DialogClose>
          <Button onClick={confirmar} disabled={pendente}>
            <CalendarCheck2 />
            {pendente ? "Encerrando..." : "Encerrar mês"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
