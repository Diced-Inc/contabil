"use client";

import { useState, useTransition } from "react";
import { Calculator, CircleAlert, Lock, LockOpen, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { apurarAction, fecharMesAction, reabrirMesAction, reverterApuracaoAction } from "@/actions/fechamento";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { fmtCompetencia } from "@/lib/format";

export function MesBotao({ empresaId, competencia, fechado, motivo }: {
  empresaId: string;
  competencia: string;
  fechado: boolean;
  /** Por que a ação não é permitida (null = permitida). */
  motivo: string | null;
}) {
  const [pendente, iniciar] = useTransition();
  const executar = () =>
    iniciar(async () => {
      const r = await (fechado ? reabrirMesAction : fecharMesAction)(empresaId, competencia);
      if (r.erro) toast.error(r.erro);
      else toast.success(`${fmtCompetencia(competencia)} ${fechado ? "reaberto" : "fechado"}.`);
    });
  return (
    <Button
      size="sm"
      variant={fechado ? "outline" : "default"}
      disabled={!!motivo || pendente}
      title={motivo ?? undefined}
      onClick={executar}
    >
      {fechado ? <LockOpen /> : <Lock />}
      {fechado ? "Reabrir" : "Fechar"}
    </Button>
  );
}

export function ApuracaoBotao({ empresaId, ano, apurada, motivo }: {
  empresaId: string;
  ano: number;
  apurada: boolean;
  motivo: string | null;
}) {
  const [aberta, setAberta] = useState(false);
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();
  const confirmar = () =>
    iniciar(async () => {
      const r = await (apurada ? reverterApuracaoAction : apurarAction)(empresaId, ano);
      if (r.erro) return setErro(r.erro);
      toast.success(apurada ? `Apuração de ${ano} revertida.` : `Resultado de ${ano} apurado.`);
      setAberta(false);
    });
  const Icone = apurada ? Undo2 : Calculator;
  const rotulo = apurada ? "Reverter apuração" : `Apurar resultado de ${ano}`;
  return (
    <Dialog
      open={aberta}
      onOpenChange={(a) => {
        setAberta(a);
        setErro(undefined);
      }}
    >
      <DialogTrigger
        render={<Button variant={apurada ? "outline" : "default"} disabled={!!motivo} title={motivo ?? undefined} />}
      >
        <Icone />
        {rotulo}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{apurada ? `Reverter a apuração de ${ano}?` : `Apurar o resultado de ${ano}?`}</DialogTitle>
          <DialogDescription>
            {apurada
              ? `O lançamento de apuração será estornado em 31/12/${ano}. Depois disso os meses de ${ano} podem ser reabertos.`
              : `Será criado um lançamento em 31/12/${ano} zerando as contas de resultado contra Lucros ou Prejuízos acumulados.`}
          </DialogDescription>
        </DialogHeader>
        {erro && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription>{erro}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Voltar</DialogClose>
          <Button variant={apurada ? "destructive" : "default"} disabled={pendente} onClick={confirmar}>
            <Icone />
            {pendente ? "Processando..." : rotulo}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
