"use client";

import { useActionState, useEffect, type ComponentProps, type ReactNode } from "react";
import { CircleAlert, Plus, Save } from "lucide-react";
import { toast } from "sonner";
import type { EstadoForm } from "@/actions/empresas";
import { criarEmpresa } from "@/actions/empresas";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmtCnpj, fmtCpf, PORTES, REGIMES, somenteDigitos } from "@/lib/format";

type Empresa = {
  razaoSocial: string;
  cnpj: string;
  regimeTributario: keyof typeof REGIMES;
  porte: keyof typeof PORTES | null;
  cidade: string | null;
  uf: string | null;
  responsavelNome: string | null;
  responsavelCpf: string | null;
  contadorNome: string | null;
  contadorCpf: string | null;
  contadorCrc: string | null;
};
const SELECT =
  "h-9 w-full cursor-pointer rounded-md border border-input bg-card px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type Acao = (prev: EstadoForm, form: FormData) => Promise<EstadoForm>;

function Campo({ label, name, className, ...props }: { label: string; name: string } & ComponentProps<typeof Input>) {
  return (
    <div className={`grid gap-2 ${className ?? ""}`}>
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} {...props} />
    </div>
  );
}

function CampoCpf({ name, valor }: { name: string; valor?: string | null }) {
  return (
    <Campo
      label="CPF"
      name={name}
      defaultValue={valor ? fmtCpf(valor) : undefined}
      placeholder="000.000.000-00"
      inputMode="numeric"
      onBlur={(e) => { e.currentTarget.value = fmtCpf(somenteDigitos(e.currentTarget.value)) || e.currentTarget.value; }}
    />
  );
}

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <fieldset className="grid gap-4 border-t pt-4 sm:grid-cols-2">
      <legend className="pr-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{titulo}</legend>
      {children}
    </fieldset>
  );
}

export function EmpresaForm({ action, empresa, rotulo }: { action: Acao; empresa?: Empresa; rotulo: string }) {
  const [estado, enviar, pendente] = useActionState(action, {});
  useEffect(() => {
    if (estado.ok) toast.success("Dados salvos.");
  }, [estado]);

  return (
    <form action={enviar} className="grid gap-5">
      {estado.erro && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>{estado.erro}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo label="Razão social" name="razaoSocial" className="sm:col-span-2" defaultValue={empresa?.razaoSocial} required minLength={2} />
        <Campo
          label="CNPJ"
          name="cnpj"
          defaultValue={empresa ? fmtCnpj(empresa.cnpj) : undefined}
          placeholder="00.000.000/0000-00"
          inputMode="numeric"
          required
        />
        <div className="grid gap-2">
          <Label htmlFor="regimeTributario">Regime tributário</Label>
          <select
            id="regimeTributario"
            name="regimeTributario"
            defaultValue={empresa?.regimeTributario ?? "simples"}
            className={SELECT}
          >
            {Object.entries(REGIMES).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="porte">Porte</Label>
          <select id="porte" name="porte" defaultValue={empresa?.porte ?? ""} className={SELECT}>
            <option value="">Não informado</option>
            {Object.entries(PORTES).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
      </div>
      <Secao titulo="Endereço">
        <Campo label="Cidade" name="cidade" defaultValue={empresa?.cidade ?? undefined} />
        <Campo label="UF" name="uf" defaultValue={empresa?.uf ?? undefined} maxLength={2} placeholder="CE" />
      </Secao>
      <Secao titulo="Responsável legal">
        <Campo label="Nome" name="responsavelNome" defaultValue={empresa?.responsavelNome ?? undefined} />
        <CampoCpf name="responsavelCpf" valor={empresa?.responsavelCpf} />
      </Secao>
      <Secao titulo="Contador responsável">
        <Campo label="Nome" name="contadorNome" className="sm:col-span-2" defaultValue={empresa?.contadorNome ?? undefined} />
        <CampoCpf name="contadorCpf" valor={empresa?.contadorCpf} />
        <Campo label="CRC" name="contadorCrc" defaultValue={empresa?.contadorCrc ?? undefined} placeholder="CE-015797/O" />
      </Secao>
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
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nova empresa</DialogTitle>
        </DialogHeader>
        <EmpresaForm action={criarEmpresa} rotulo="Criar empresa" />
      </DialogContent>
    </Dialog>
  );
}
