"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { desfazerConciliacao } from "@/actions/conciliacao";
import { CircleAlert, Undo2 } from "lucide-react";
import type { EstadoForm } from "@/actions/empresas";
import { estornar } from "@/actions/lancamentos";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { hoje } from "@/lib/format";

export function EstornarDialog({ empresaId, lancamentoId, numero }: { empresaId: string; lancamentoId: string; numero: number }) {
  const [aberta, setAberta] = useState(false);
  const [estado, enviar, pendente] = useActionState<EstadoForm, FormData>(estornar.bind(null, empresaId, lancamentoId), {});
  return (
    <Dialog open={aberta} onOpenChange={setAberta}>
      <DialogTrigger render={<Button variant="outline" />}>
        <Undo2 />
        Estornar
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Estornar lançamento {numero}</DialogTitle>
          <DialogDescription>Cria um lançamento com as partidas invertidas na data escolhida e marca este como estornado.</DialogDescription>
        </DialogHeader>
        <form action={enviar} className="grid gap-4">
          {estado.erro && (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertDescription>{estado.erro}</AlertDescription>
            </Alert>
          )}
          <div className="grid gap-2">
            <Label htmlFor="data-estorno">Data do estorno</Label>
            <Input id="data-estorno" name="data" type="date" required defaultValue={hoje()} />
          </div>
          <Button type="submit" variant="destructive" disabled={pendente}>
            <Undo2 />
            {pendente ? "Estornando..." : "Confirmar estorno"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DesfazerConciliacaoDialog({ empresaId, transacaoId, numero }: { empresaId: string; transacaoId: string; numero: number }) {
  const router = useRouter();
  const [aberta, setAberta] = useState(false);
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();
  const desfazer = () =>
    iniciar(async () => {
      const r = await desfazerConciliacao(empresaId, transacaoId);
      if (r.erro) return setErro(r.erro);
      toast.success("Conciliação desfeita.");
      setAberta(false);
      router.refresh();
    });
  return (
    <Dialog open={aberta} onOpenChange={(a) => { setAberta(a); setErro(undefined); }}>
      <DialogTrigger render={<Button variant="outline" />}>
        <Undo2 />
        Desfazer conciliação
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Desfazer a conciliação do lançamento {numero}?</DialogTitle>
          <DialogDescription>
            O lançamento é estornado com a data de hoje, a(s) transação(ões) voltam para pendente e o título baixado, se houver, volta a aberto.
          </DialogDescription>
        </DialogHeader>
        {erro && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription>{erro}</AlertDescription>
          </Alert>
        )}
        <Button variant="destructive" disabled={pendente} onClick={desfazer}>
          <Undo2 />
          {pendente ? "Desfazendo..." : "Desfazer conciliação"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
