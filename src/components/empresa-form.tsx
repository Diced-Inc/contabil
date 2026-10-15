"use client";

import { useActionState, useEffect } from "react";
import { CircleAlert, Plus, Save } from "lucide-react";
import { toast } from "sonner";
import type { EstadoForm } from "@/actions/empresas";
import { criarEmpresa } from "@/actions/empresas";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmtCnpj, REGIMES } from "@/lib/format";

type Empresa = { razaoSocial: string; cnpj: string; regimeTributario: "simples" | "presumido" | "real" };
type Acao = (prev: EstadoForm, form: FormData) => Promise<EstadoForm>;

export function EmpresaForm({ action, empresa, rotulo }: { action: Acao; empresa?: Empresa; rotulo: string }) {
  const [estado, enviar, pendente] = useActionState(action, {});
  useEffect(() => {
    if (estado.ok) toast.success("Dados salvos.");
  }, [estado]);

  return (
    <form action={enviar} className="grid gap-4">
      {estado.erro && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>{estado.erro}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-2">
        <Label htmlFor="razaoSocial">Razão social</Label>
        <Input id="razaoSocial" name="razaoSocial" defaultValue={empresa?.razaoSocial} required minLength={2} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="cnpj">CNPJ</Label>
        <Input
          id="cnpj"
          name="cnpj"
          defaultValue={empresa ? fmtCnpj(empresa.cnpj) : undefined}
          placeholder="00.000.000/0000-00"
          inputMode="numeric"
          required
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="regimeTributario">Regime tributário</Label>
        <select
          id="regimeTributario"
          name="regimeTributario"
          defaultValue={empresa?.regimeTributario ?? "simples"}
          className="h-9 w-full cursor-pointer rounded-md border border-input bg-card px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {Object.entries(REGIMES).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      </div>
      <Button type="submit" disabled={pendente}>
        <Save />
        {pendente ? "Salvando..." : rotulo}
      </Button>
    </form>
  );
}

export function NovaEmpresaDialog() {
  return (
    <Dialog>
      <DialogTrigger render={<Button />}>
        <Plus />
        Nova empresa
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova empresa</DialogTitle>
        </DialogHeader>
        <EmpresaForm action={criarEmpresa} rotulo="Criar empresa" />
      </DialogContent>
    </Dialog>
  );
}
