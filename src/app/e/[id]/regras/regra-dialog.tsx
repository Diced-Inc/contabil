"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { CircleAlert, Pencil, Play, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { EstadoForm } from "@/actions/empresas";
import { aplicarRegrasPendentes, atualizarRegra, criarRegra, excluirRegra } from "@/actions/regras";
import { ContaSelect, type ContaOpcao } from "@/components/conta-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SINAIS, TIPOS_MATCH } from "@/lib/classificacao/regras";
import type { RegraLinha } from "./queries";

const selectCls =
  "h-9 w-full cursor-pointer rounded-md border border-input bg-card px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function Erro({ msg }: { msg?: string }) {
  if (!msg) return null;
  return (
    <Alert variant="destructive">
      <CircleAlert />
      <AlertDescription>{msg}</AlertDescription>
    </Alert>
  );
}

function Form({ action, contas, regra, setAberta }: {
  action: (prev: EstadoForm, form: FormData) => Promise<EstadoForm>;
  contas: ContaOpcao[];
  regra?: RegraLinha;
  setAberta: (aberta: boolean) => void;
}) {
  const [estado, enviar, pendente] = useActionState(action, {});
  useEffect(() => {
    if (estado.ok) {
      toast.success("Regra salva.");
      setAberta(false);
    }
  }, [estado, setAberta]);

  return (
    <form action={enviar} className="grid gap-4">
      <Erro msg={estado.erro} />
      <div className="grid gap-2">
        <Label htmlFor="nome">Nome</Label>
        <Input id="nome" name="nome" defaultValue={regra?.nome} required />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-2">
          <Label htmlFor="tipoMatch">Tipo</Label>
          <select id="tipoMatch" name="tipoMatch" defaultValue={regra?.tipoMatch ?? "memo_contem"} className={selectCls}>
            {Object.entries(TIPOS_MATCH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="sinal">Sinal</Label>
          <select id="sinal" name="sinal" defaultValue={regra?.sinal ?? "qualquer"} className={selectCls}>
            {Object.entries(SINAIS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="padrao">Padrão</Label>
        <Input id="padrao" name="padrao" defaultValue={regra?.padrao} required />
        <p className="text-xs text-muted-foreground">
          Texto contido no memo, CPF/CNPJ (qualquer formatação) ou valor (ex.: 1.500,00), conforme o tipo.
        </p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="contaId">Conta</Label>
        <ContaSelect id="contaId" name="contaId" contas={contas} defaultValue={regra?.contaId} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="historicoTemplate">Histórico</Label>
        <Input id="historicoTemplate" name="historicoTemplate" defaultValue={regra?.historicoTemplate ?? "{memo}"} required />
        <p className="text-xs text-muted-foreground">Aceita {"{memo}"}, {"{valor}"} e {"{data}"}.</p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="prioridade">Prioridade</Label>
        <Input id="prioridade" name="prioridade" type="number" min={0} step={1} defaultValue={regra?.prioridade ?? 100} required />
        <p className="text-xs text-muted-foreground">Menor número é avaliado primeiro; a primeira regra que casa vence.</p>
      </div>
      {regra && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="ativa" defaultChecked={regra.ativa} className="size-4" />
          Regra ativa
        </label>
      )}
      <Button type="submit" disabled={pendente}>
        <Save />
        {pendente ? "Salvando..." : "Salvar"}
      </Button>
    </form>
  );
}

/** Sem `regra`: botão "Nova regra". Com `regra`: ícone de edição. */
export function RegraDialog({ empresaId, contas, regra }: { empresaId: string; contas: ContaOpcao[]; regra?: RegraLinha }) {
  const [aberta, setAberta] = useState(false);
  return (
    <Dialog open={aberta} onOpenChange={setAberta}>
      {regra ? (
        <DialogTrigger render={<Button variant="ghost" size="icon-sm" title="Editar" aria-label="Editar" />}>
          <Pencil />
        </DialogTrigger>
      ) : (
        <DialogTrigger render={<Button />}>
          <Plus />
          Nova regra
        </DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{regra ? `Editar ${regra.nome}` : "Nova regra"}</DialogTitle>
        </DialogHeader>
        <Form
          action={regra ? atualizarRegra.bind(null, empresaId, regra.id) : criarRegra.bind(null, empresaId)}
          contas={contas}
          regra={regra}
          setAberta={setAberta}
        />
      </DialogContent>
    </Dialog>
  );
}

export function ExcluirRegraDialog({ empresaId, regra }: { empresaId: string; regra: RegraLinha }) {
  const [aberta, setAberta] = useState(false);
  const [erro, setErro] = useState<string>();
  const [pendente, iniciar] = useTransition();
  const excluir = () =>
    iniciar(async () => {
      const r = await excluirRegra(empresaId, regra.id);
      if (r.erro) return setErro(r.erro);
      toast.success("Regra excluída.");
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
      <DialogTrigger render={<Button variant="ghost" size="icon-sm" title="Excluir" aria-label="Excluir" />}>
        <Trash2 />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Excluir a regra {regra.nome}?</DialogTitle>
          <DialogDescription>Sugestões já feitas por esta regra continuam nas transações.</DialogDescription>
        </DialogHeader>
        <Erro msg={erro} />
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
          <Button variant="destructive" disabled={pendente} onClick={excluir}>
            <Trash2 />
            {pendente ? "Excluindo..." : "Excluir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AplicarRegrasButton({ empresaId }: { empresaId: string }) {
  const [pendente, iniciar] = useTransition();
  const aplicar = () =>
    iniciar(async () => {
      const r = await aplicarRegrasPendentes(empresaId);
      if (r.erro) {
        toast.error(r.erro);
        return;
      }
      const n = (r.regras ?? 0) + (r.transferencias ?? 0) + (r.ia ?? 0);
      toast.success(`${n} ${n === 1 ? "transação recebeu" : "transações receberam"} sugestão.`);
      if (r.erros?.length) toast.warning(`Falhas na sugestão: ${r.erros.join("; ")}`);
    });
  return (
    <Button variant="outline" disabled={pendente} onClick={aplicar}>
      <Play />
      {pendente ? "Aplicando..." : "Aplicar às pendentes"}
    </Button>
  );
}
