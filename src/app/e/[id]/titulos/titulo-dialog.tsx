"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { Ban, CircleAlert, Plus, Save } from "lucide-react";
import { toast } from "sonner";
import type { EstadoForm } from "@/actions/empresas";
import { cancelarTituloAction, criarTituloAction } from "@/actions/titulos";
import { ContaSelect, type ContaOpcao } from "@/components/conta-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmtValor } from "@/lib/format";
import type { TipoTitulo } from "@/lib/titulos";
import type { TituloLinha } from "./queries";

function Erro({ msg }: { msg?: string }) {
  if (!msg) return null;
  return (
    <Alert variant="destructive">
      <CircleAlert />
      <AlertDescription>{msg}</AlertDescription>
    </Alert>
  );
}

function Form({ empresaId, tipo, contas, setAberta }: {
  empresaId: string;
  tipo: TipoTitulo;
  contas: ContaOpcao[];
  setAberta: (aberta: boolean) => void;
}) {
  const [estado, enviar, pendente] = useActionState<EstadoForm, FormData>(criarTituloAction.bind(null, empresaId), {});
  useEffect(() => {
    if (estado.ok) {
      toast.success("Título criado.");
      setAberta(false);
    }
  }, [estado, setAberta]);

  return (
    <form action={enviar} className="grid gap-4">
      <Erro msg={estado.erro} />
      <input type="hidden" name="tipo" value={tipo} />
      <div className="grid gap-2">
        <Label htmlFor="contraparte">{tipo === "receber" ? "Cliente" : "Fornecedor"}</Label>
        <Input id="contraparte" name="contraparte" required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="descricao">Descrição</Label>
        <Input id="descricao" name="descricao" required />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-2">
          <Label htmlFor="documento">Documento</Label>
          <Input id="documento" name="documento" placeholder="Nº da nota" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="valor">Valor</Label>
          <Input id="valor" name="valor" inputMode="decimal" placeholder="0,00" required />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-2">
          <Label htmlFor="competencia">Competência</Label>
          <Input id="competencia" name="competencia" type="date" required />
          <p className="text-xs text-muted-foreground">Data do fato (ex.: emissão da nota).</p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="vencimento">Vencimento</Label>
          <Input id="vencimento" name="vencimento" type="date" />
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="contaResultadoId">{tipo === "receber" ? "Conta de receita" : "Conta de custo ou despesa"}</Label>
        <ContaSelect id="contaResultadoId" name="contaResultadoId" contas={contas} />
      </div>
      <Button type="submit" disabled={pendente}>
        <Save />
        {pendente ? "Salvando..." : "Salvar"}
      </Button>
    </form>
  );
}

export function TituloDialog({ empresaId, tipo, contas }: { empresaId: string; tipo: TipoTitulo; contas: ContaOpcao[] }) {
  const [aberta, setAberta] = useState(false);
  return (
    <Dialog open={aberta} onOpenChange={setAberta}>
      <DialogTrigger render={<Button variant="outline" />}>
        <Plus />
        Novo título
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tipo === "receber" ? "Novo título a receber" : "Novo título a pagar"}</DialogTitle>
          <DialogDescription>Gera o lançamento de competência na data informada.</DialogDescription>
        </DialogHeader>
        <Form empresaId={empresaId} tipo={tipo} contas={contas} setAberta={setAberta} />
      </DialogContent>
    </Dialog>
  );
}

export function CancelarTituloDialog({ empresaId, titulo }: { empresaId: string; titulo: TituloLinha }) {
  const [aberta, setAberta] = useState(false);
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();
  const cancelar = () =>
    iniciar(async () => {
      const r = await cancelarTituloAction(empresaId, titulo.id);
      if (r.erro) return setErro(r.erro);
      toast.success("Título cancelado.");
      setAberta(false);
    });
  return (
    <Dialog
      open={aberta}
      onOpenChange={(a) => {
        setAberta(a);
        setErro(undefined);
      }}
    >
      <DialogTrigger render={<Button variant="ghost" size="icon-sm" title="Cancelar título" aria-label="Cancelar título" />}>
        <Ban />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancelar o título de {titulo.contraparte}?</DialogTitle>
          <DialogDescription>
            O lançamento de competência ({fmtValor(titulo.valor)}) será estornado com a data de hoje.
          </DialogDescription>
        </DialogHeader>
        <Erro msg={erro} />
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Voltar</DialogClose>
          <Button variant="destructive" disabled={pendente} onClick={cancelar}>
            <Ban />
            {pendente ? "Cancelando..." : "Cancelar título"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
