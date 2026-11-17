"use client";

import { useActionState, useState, useTransition, type ReactNode } from "react";
import { CircleCheck, Copy, FileUp, MailPlus, Receipt, Send, TriangleAlert, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { convidarCliente, reenviarConvite, removerCliente, type EstadoConvite } from "@/actions/clientes";
import { Erro } from "@/app/login/senha-forms";
import { VerEmail } from "@/components/ver-email";
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

/** Estado de sucesso dentro do diálogo: o contador vê para quem foi, sem depender do toast. */
export function Sucesso({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <>
      <div className="flex flex-col items-center gap-3 py-2 text-center" role="status">
        <span className="flex size-12 items-center justify-center rounded-full bg-success-soft text-success ring-8 ring-success-soft/40">
          <CircleCheck className="size-6" />
        </span>
        <p className="text-base font-semibold text-foreground">{titulo}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{children}</p>
      </div>
      <DialogFooter>
        <DialogClose render={<Button />}>Concluído</DialogClose>
      </DialogFooter>
    </>
  );
}

function ConviteForm({ empresaId, empresa }: { empresaId: string; empresa: string }) {
  const [estado, enviar, pendente] = useActionState(convidarCliente.bind(null, empresaId), {});
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const quem = email.trim() || "o cliente";

  if (estado.ok && !estado.link) {
    return estado.aviso ? (
      <Sucesso titulo={`Acesso liberado para ${email}`}>
        Esse e-mail já tinha conta no portal. Ele já pode entrar e ver a {empresa}, sem precisar de convite.
      </Sucesso>
    ) : (
      <Sucesso titulo={`Convite enviado para ${email}`}>
        O link vale 24 horas. Quando o cliente criar a senha, ele aparece como <b className="font-medium text-foreground">Ativo</b> na lista.
      </Sucesso>
    );
  }
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
      <div className="rounded-lg border bg-muted/40 p-4 text-sm leading-relaxed text-foreground/90">
        <p>
          Vamos mandar um e-mail para <b className="font-semibold break-all text-foreground">{quem}</b> com um link para criar a senha e acessar
          o portal da <b className="font-semibold text-foreground">{empresa}</b>. Ele só vê esta empresa.
        </p>
        <ul className="mt-3 grid gap-1.5 text-muted-foreground">
          <li className="flex items-center gap-2">
            <FileUp className="size-4 shrink-0 text-primary" /> Pelo portal ele envia os extratos do mês.
          </li>
          <li className="flex items-center gap-2">
            <Receipt className="size-4 shrink-0 text-primary" /> E recebe as guias de imposto quando você concluir o mês.
          </li>
        </ul>
      </div>
      <Erro>{estado.erro}</Erro>
      <div className="grid gap-2">
        <Label htmlFor="cliente-email">E-mail do cliente</Label>
        <Input
          id="cliente-email"
          name="email"
          type="email"
          required
          placeholder="cliente@empresa.com.br"
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="cliente-nome">
          Nome <span className="font-normal text-muted-foreground">(opcional, usado na saudação)</span>
        </Label>
        <Input
          id="cliente-nome"
          name="nome"
          maxLength={80}
          placeholder="Ex.: Marcelo Barreira"
          autoComplete="off"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
        />
      </div>
      <DialogFooter className="items-center sm:justify-between">
        <VerEmail empresaId={empresaId} tipo="convite" dados={{ nome }} para={email.trim() || undefined} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <DialogClose render={<Button variant="outline" type="button" />}>Cancelar</DialogClose>
          <Button type="submit" disabled={pendente}>
            <Send />
            {pendente ? "Enviando..." : "Enviar convite"}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}

export function ConvidarClienteDialog({ empresaId, empresa }: { empresaId: string; empresa: string }) {
  const [aberta, setAberta] = useState(false);
  // key nova a cada abertura: o formulário volta limpo depois de um envio
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
          <DialogDescription>Dê acesso ao portal para o dono ou o responsável financeiro da empresa.</DialogDescription>
        </DialogHeader>
        <ConviteForm key={chave} empresaId={empresaId} empresa={empresa} />
      </DialogContent>
    </Dialog>
  );
}

export function ReenviarConviteDialog({ empresaId, membroId, email, nome }: { empresaId: string; membroId: string; email: string; nome: string | null }) {
  const [aberta, setAberta] = useState(false);
  const [estado, setEstado] = useState<EstadoConvite>({});
  const [pendente, iniciar] = useTransition();
  const reenviar = () => iniciar(async () => setEstado(await reenviarConvite(empresaId, membroId)));
  const enviado = estado.ok && !estado.aviso;
  return (
    <Dialog
      open={aberta}
      onOpenChange={(a) => {
        setAberta(a);
        setEstado({});
      }}
    >
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <MailPlus />
        Reenviar convite
      </DialogTrigger>
      <DialogContent>
        {enviado ? (
          <Sucesso titulo={`Convite reenviado para ${email}`}>O novo link vale 24 horas. O link anterior parou de funcionar.</Sucesso>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Reenviar o convite?</DialogTitle>
              <DialogDescription>
                Vamos mandar um novo e-mail para <b className="font-medium text-foreground">{email}</b> com outro link para criar a senha. O link
                anterior para de funcionar e o novo vale 24 horas.
              </DialogDescription>
            </DialogHeader>
            <Erro>{estado.erro}</Erro>
            <Aviso estado={estado} />
            <DialogFooter className="items-center sm:justify-between">
              {estado.aviso ? <span /> : <VerEmail empresaId={empresaId} tipo="convite" dados={{ nome: nome ?? undefined }} para={email} />}
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <DialogClose render={<Button variant="outline" />}>{estado.aviso ? "Fechar" : "Cancelar"}</DialogClose>
                {!estado.aviso && (
                  <Button disabled={pendente} onClick={reenviar}>
                    <Send />
                    {pendente ? "Enviando..." : "Reenviar convite"}
                  </Button>
                )}
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function RemoverClienteDialog({ empresaId, membroId, quem, empresa, ativo }: {
  empresaId: string; membroId: string; quem: string; empresa: string; ativo: boolean;
}) {
  const [aberta, setAberta] = useState(false);
  const [pendente, iniciar] = useTransition();
  const remover = () =>
    iniciar(async () => {
      const r = await removerCliente(empresaId, membroId);
      if (r.erro) return void toast.error(r.erro);
      toast.success(`Acesso de ${quem} removido.`);
      setAberta(false);
    });
  return (
    <Dialog open={aberta} onOpenChange={setAberta}>
      <DialogTrigger render={<Button variant="ghost" size="sm" className="text-muted-foreground hover:text-danger" />}>
        <Trash2 />
        Remover
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remover o acesso de {quem}?</DialogTitle>
          <DialogDescription>O que acontece:</DialogDescription>
        </DialogHeader>
        <ul className="grid list-disc gap-1.5 pl-5 text-sm text-muted-foreground marker:text-border">
          {ativo ? (
            <li>Deixa de ver a {empresa} no portal na hora.</li>
          ) : (
            <li>O convite pendente deixa de valer para esta empresa.</li>
          )}
          <li>Para de receber os e-mails de extrato e das guias.</li>
          <li>Os arquivos que ele já enviou continuam em Documentos.</li>
          <li>Dá para convidar de novo depois.</li>
        </ul>
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
