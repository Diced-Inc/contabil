"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { Copy, MailPlus, Send, TriangleAlert, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { convidarCliente, reenviarConvite, removerCliente, type EstadoConvite } from "@/actions/clientes";
import { Erro } from "@/app/login/senha-forms";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Aviso de convite não enviado e, quando houver, o link para copiar. */
function Aviso({ estado }: { estado: EstadoConvite }) {
  if (!estado.aviso) return null;
  return (
    <div className="grid gap-3">
      <Alert className="border-warning/25 bg-warning-soft text-warning *:data-[slot=alert-description]:text-warning/90">
        <TriangleAlert />
        <AlertDescription>{estado.aviso}</AlertDescription>
      </Alert>
      {estado.link && (
        <div className="flex gap-2">
          <Input readOnly value={estado.link} aria-label="Link do convite" className="font-mono text-xs" onFocus={(e) => e.target.select()} />
          <Button
            type="button"
            variant="outline"
            onClick={() => navigator.clipboard.writeText(estado.link!).then(() => toast.success("Link copiado."))}
          >
            <Copy />
            Copiar
          </Button>
        </div>
      )}
    </div>
  );
}

function ConviteForm({ empresaId, fechar }: { empresaId: string; fechar: (aberta: boolean) => void }) {
  const [estado, enviar, pendente] = useActionState(convidarCliente.bind(null, empresaId), {});
  useEffect(() => {
    if (estado.ok && !estado.aviso) {
      toast.success("Convite enviado por e-mail.");
      fechar(false);
    }
  }, [estado, fechar]);

  if (estado.aviso) {
    return (
      <>
        <Aviso estado={estado} />
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Fechar</DialogClose>
        </DialogFooter>
      </>
    );
  }
  return (
    <form action={enviar} className="grid gap-4">
      <Erro>{estado.erro}</Erro>
      <div className="grid gap-2">
        <Label htmlFor="cliente-nome">Nome</Label>
        <Input id="cliente-nome" name="nome" maxLength={80} placeholder="Ex.: Marcelo Barreira" autoComplete="off" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="cliente-email">E-mail</Label>
        <Input id="cliente-email" name="email" type="email" required placeholder="cliente@empresa.com.br" autoComplete="off" />
        <p className="text-xs text-muted-foreground">O cliente recebe um link para criar a senha e só vê esta empresa.</p>
      </div>
      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />}>Cancelar</DialogClose>
        <Button type="submit" disabled={pendente}>
          <Send />
          {pendente ? "Enviando..." : "Enviar convite"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function ConvidarClienteDialog({ empresaId }: { empresaId: string }) {
  const [aberta, setAberta] = useState(false);
  // key nova a cada abertura: o formulário volta limpo depois de um aviso
  const [chave, setChave] = useState(0);
  return (
    <Dialog
      open={aberta}
      onOpenChange={(a) => {
        setAberta(a);
        if (a) setChave((k) => k + 1);
      }}
    >
      <DialogTrigger render={<Button />}>
        <UserPlus />
        Convidar cliente
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convidar cliente</DialogTitle>
          <DialogDescription>Dê acesso ao portal para o dono ou responsável financeiro da empresa.</DialogDescription>
        </DialogHeader>
        <ConviteForm key={chave} empresaId={empresaId} fechar={setAberta} />
      </DialogContent>
    </Dialog>
  );
}

export function ReenviarConviteDialog({ empresaId, membroId, email }: { empresaId: string; membroId: string; email: string }) {
  const [aberta, setAberta] = useState(false);
  const [estado, setEstado] = useState<EstadoConvite>({});
  const [pendente, iniciar] = useTransition();
  const reenviar = () =>
    iniciar(async () => {
      const r = await reenviarConvite(empresaId, membroId);
      setEstado(r);
      if (r.ok && !r.aviso) {
        toast.success("Convite reenviado.");
        setAberta(false);
      }
    });
  return (
    <Dialog
      open={aberta}
      onOpenChange={(a) => {
        setAberta(a);
        setEstado({});
      }}
    >
      <DialogTrigger render={<Button variant="ghost" size="icon-sm" title="Reenviar convite" aria-label="Reenviar convite" />}>
        <MailPlus />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reenviar convite</DialogTitle>
          <DialogDescription>Um novo link de acesso vai para {email}. O link anterior deixa de valer.</DialogDescription>
        </DialogHeader>
        <Erro>{estado.erro}</Erro>
        <Aviso estado={estado} />
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{estado.aviso ? "Fechar" : "Cancelar"}</DialogClose>
          {!estado.aviso && (
            <Button disabled={pendente} onClick={reenviar}>
              <Send />
              {pendente ? "Enviando..." : "Reenviar"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RemoverClienteDialog({ empresaId, membroId, quem }: { empresaId: string; membroId: string; quem: string }) {
  const [aberta, setAberta] = useState(false);
  const [pendente, iniciar] = useTransition();
  const remover = () =>
    iniciar(async () => {
      const r = await removerCliente(empresaId, membroId);
      if (r.erro) return void toast.error(r.erro);
      toast.success("Acesso removido.");
      setAberta(false);
    });
  return (
    <Dialog open={aberta} onOpenChange={setAberta}>
      <DialogTrigger render={<Button variant="ghost" size="icon-sm" title="Remover acesso" aria-label="Remover acesso" />}>
        <Trash2 />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remover o acesso de {quem}?</DialogTitle>
          <DialogDescription>O cliente deixa de ver esta empresa no portal na hora. Dá para convidar de novo depois.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
          <Button variant="destructive" disabled={pendente} onClick={remover}>
            <Trash2 />
            {pendente ? "Removendo..." : "Remover acesso"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
