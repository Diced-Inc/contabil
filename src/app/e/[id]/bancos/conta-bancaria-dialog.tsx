"use client";

import { useActionState, useEffect, useState } from "react";
import { CircleAlert, Pencil, Plus, Save } from "lucide-react";
import { toast } from "sonner";
import type { EstadoForm } from "@/actions/empresas";
import { atualizarContaBancaria, criarContaBancaria } from "@/actions/bancos";
import { ContaSelect, type ContaOpcao } from "@/components/conta-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type ContaBancariaLinha = {
  id: string;
  nome: string;
  banco: string | null;
  agencia: string | null;
  numero: string | null;
  ofxBankid: string;
  ofxAcctid: string;
  contaContabilId: string;
  ativa: boolean;
};

function Campo({ id, label, valor, required }: { id: string; label: string; valor?: string | null; required?: boolean }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={id} defaultValue={valor ?? ""} required={required} />
    </div>
  );
}

function Form({ action, contas, conta, setAberta }: {
  action: (prev: EstadoForm, form: FormData) => Promise<EstadoForm>;
  contas: ContaOpcao[];
  conta?: ContaBancariaLinha;
  setAberta: (aberta: boolean) => void;
}) {
  const [estado, enviar, pendente] = useActionState(action, {});
  useEffect(() => {
    if (estado.ok) {
      toast.success("Conta bancária salva.");
      setAberta(false);
    }
  }, [estado, setAberta]);

  return (
    <form action={enviar} className="grid gap-4">
      {estado.erro && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>{estado.erro}</AlertDescription>
        </Alert>
      )}
      <Campo id="nome" label="Nome" valor={conta?.nome} required />
      <div className="grid grid-cols-3 gap-3">
        <Campo id="banco" label="Banco" valor={conta?.banco} />
        <Campo id="agencia" label="Agência" valor={conta?.agencia} />
        <Campo id="numero" label="Número" valor={conta?.numero} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Campo id="ofxBankid" label="BANKID (OFX)" valor={conta?.ofxBankid} required />
        <Campo id="ofxAcctid" label="ACCTID (OFX)" valor={conta?.ofxAcctid} required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="contaContabilId">Conta contábil</Label>
        <ContaSelect id="contaContabilId" name="contaContabilId" contas={contas} defaultValue={conta?.contaContabilId} />
      </div>
      {conta && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="ativa" defaultChecked={conta.ativa} className="size-4" />
          Conta ativa
        </label>
      )}
      <Button type="submit" disabled={pendente}>
        <Save />
        {pendente ? "Salvando..." : "Salvar"}
      </Button>
    </form>
  );
}

/** Sem `conta`: botão "Nova conta". Com `conta`: ícone de edição. */
export function ContaBancariaDialog({ empresaId, contas, conta }: {
  empresaId: string;
  contas: ContaOpcao[];
  conta?: ContaBancariaLinha;
}) {
  const [aberta, setAberta] = useState(false);
  return (
    <Dialog open={aberta} onOpenChange={setAberta}>
      {conta ? (
        <DialogTrigger render={<Button variant="ghost" size="icon-sm" title="Editar" aria-label="Editar" />}>
          <Pencil />
        </DialogTrigger>
      ) : (
        <DialogTrigger render={<Button variant="outline" />}>
          <Plus />
          Nova conta
        </DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{conta ? `Editar ${conta.nome}` : "Nova conta bancária"}</DialogTitle>
        </DialogHeader>
        <Form
          action={conta ? atualizarContaBancaria.bind(null, empresaId, conta.id) : criarContaBancaria.bind(null, empresaId)}
          contas={contas}
          conta={conta}
          setAberta={setAberta}
        />
      </DialogContent>
    </Dialog>
  );
}
