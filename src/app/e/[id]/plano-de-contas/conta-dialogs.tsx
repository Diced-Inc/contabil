"use client";

import { useActionState, useEffect, useState } from "react";
import { CircleAlert, Pencil, Plus, Save } from "lucide-react";
import { toast } from "sonner";
import type { EstadoForm } from "@/actions/empresas";
import { atualizarConta, criarConta } from "@/actions/plano";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GRUPOS_DRE, NATUREZAS, PAPEIS } from "@/lib/format";

export type ContaLinha = {
  id: string;
  codigo: string;
  nome: string;
  natureza: "D" | "C";
  tipo: "sintetica" | "analitica";
  grupoDre: keyof typeof GRUPOS_DRE | null;
  papel: keyof typeof PAPEIS | null;
  ativa: boolean;
};
type Acao = (prev: EstadoForm, form: FormData) => Promise<EstadoForm>;

const selectCls =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function Opcoes({ mapa, vazio }: { mapa: Record<string, string>; vazio?: string }) {
  return (
    <>
      {vazio && <option value="">{vazio}</option>}
      {Object.entries(mapa).map(([v, l]) => (
        <option key={v} value={v}>{l}</option>
      ))}
    </>
  );
}

function ContaForm({ action, setAberta, conta, codigoSugerido, analitica }: {
  action: Acao;
  setAberta: (aberta: boolean) => void;
  conta?: ContaLinha;
  codigoSugerido?: string;
  analitica: boolean;
}) {
  const [estado, enviar, pendente] = useActionState(action, {});
  useEffect(() => {
    if (estado.ok) {
      toast.success("Conta salva.");
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
      {!conta && (
        <div className="grid gap-2">
          <Label htmlFor="codigo">Código</Label>
          <Input id="codigo" name="codigo" defaultValue={codigoSugerido} required />
        </div>
      )}
      <div className="grid gap-2">
        <Label htmlFor="nome">Nome</Label>
        <Input id="nome" name="nome" defaultValue={conta?.nome} required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="natureza">Natureza</Label>
        <select id="natureza" name="natureza" defaultValue={conta?.natureza ?? "D"} className={selectCls}>
          <Opcoes mapa={NATUREZAS} />
        </select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="grupoDre">Grupo DRE</Label>
        <select id="grupoDre" name="grupoDre" defaultValue={conta?.grupoDre ?? ""} className={selectCls}>
          <Opcoes mapa={GRUPOS_DRE} vazio="Nenhum" />
        </select>
      </div>
      {analitica && (
        <div className="grid gap-2">
          <Label htmlFor="papel">Papel</Label>
          <select id="papel" name="papel" defaultValue={conta?.papel ?? ""} className={selectCls}>
            <Opcoes mapa={PAPEIS} vazio="Nenhum" />
          </select>
        </div>
      )}
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

export function ContaAcoes({ empresaId, conta, codigoSugerido }: { empresaId: string; conta: ContaLinha; codigoSugerido: string }) {
  const [novaAberta, setNovaAberta] = useState(false);
  const [editAberta, setEditAberta] = useState(false);
  return (
    <div className="flex justify-end gap-1">
      <Dialog open={novaAberta} onOpenChange={setNovaAberta}>
        <DialogTrigger render={<Button variant="ghost" size="icon-sm" title="Nova subconta" aria-label="Nova subconta" />}>
          <Plus />
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova subconta de {conta.codigo} {conta.nome}</DialogTitle>
          </DialogHeader>
          <ContaForm
            action={criarConta.bind(null, empresaId, conta.id)}
            setAberta={setNovaAberta}
            codigoSugerido={codigoSugerido}
            analitica
          />
        </DialogContent>
      </Dialog>
      <Dialog open={editAberta} onOpenChange={setEditAberta}>
        <DialogTrigger render={<Button variant="ghost" size="icon-sm" title="Editar" aria-label="Editar" />}>
          <Pencil />
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar {conta.codigo} {conta.nome}</DialogTitle>
          </DialogHeader>
          <ContaForm
            action={atualizarConta.bind(null, empresaId, conta.id)}
            setAberta={setEditAberta}
            conta={conta}
            analitica={conta.tipo === "analitica"}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
