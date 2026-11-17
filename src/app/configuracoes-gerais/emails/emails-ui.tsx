"use client";

import { startTransition, useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Clock, Copy, Inbox, MailCheck, MailPlus, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { alternar, remover, removerPendente, salvarEndereco, type EstadoEndereco } from "@/actions/email-escritorio";
import { Sucesso } from "@/app/e/[id]/clientes/clientes-dialogs";
import { selectCls } from "@/app/e/[id]/bancos/mapeamento-csv";
import { Erro } from "@/app/login/senha-forms";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { CatchAll, Destino, Endereco } from "@/lib/email-routing";

type Pendente = { local: string; destino: string; nome: string | null };

/** Enquanto algo espera confirmação, recarrega os dados a cada 15 s (só com a aba visível). */
export function AtualizarSozinho() {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === "visible" && router.refresh(), 15_000);
    return () => clearInterval(t);
  }, [router]);
  return null;
}

const OUTRO = "outro";

function EnderecoForm({ dominio, destinos, atual, aoSalvar }: {
  dominio: string;
  destinos: Destino[];
  atual?: Endereco;
  aoSalvar: (e: EstadoEndereco) => void;
}) {
  const [estado, salvar, salvando] = useActionState(async (prev: EstadoEndereco, form: FormData) => {
    const r = await salvarEndereco(atual?.id ?? null, prev, form);
    if (r.ok) aoSalvar(r);
    return r;
  }, {});
  // ao editar, só destinos confirmados (o Cloudflare recusa os outros)
  const opcoes = atual ? destinos.filter((d) => d.verificado || atual.destinos.includes(d.email)) : destinos;
  const inicial = atual?.destinos[0] ?? opcoes.find((d) => d.verificado)?.email ?? (opcoes[0]?.email || OUTRO);
  const [escolha, setEscolha] = useState(inicial);
  const [outro, setOutro] = useState("");
  const outroAtivo = escolha === OUTRO;

  return (
    <form
      // onSubmit em vez de action: o React não limpa os campos quando volta erro
      onSubmit={(e) => {
        e.preventDefault();
        const dados = new FormData(e.currentTarget);
        startTransition(() => salvar(dados));
      }}
      className="grid gap-4"
    >
      <Erro>{estado.erro}</Erro>
      <div className="grid gap-2">
        <Label htmlFor="email-local">Endereço</Label>
        <InputGroup className="h-9 bg-card">
          <InputGroupInput
            id="email-local"
            name="local"
            required
            maxLength={40}
            defaultValue={atual?.local}
            placeholder="contato"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
          />
          <InputGroupAddon align="inline-end" className="text-foreground/70">@{dominio}</InputGroupAddon>
        </InputGroup>
        <p className="text-xs text-muted-foreground">Só letras sem acento, números, ponto ou hífen. Ex.: contato, financeiro, david.</p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="email-destino">Entregar no e-mail</Label>
        <select id="email-destino" className={selectCls} value={escolha} onChange={(e) => setEscolha(e.target.value)}>
          {opcoes.map((d) => (
            <option key={d.id} value={d.email}>
              {d.email}
              {d.verificado ? "" : " (aguardando confirmação)"}
            </option>
          ))}
          {!atual && <option value={OUTRO}>Usar outro e-mail…</option>}
        </select>
        {outroAtivo && (
          <Input
            name="destino"
            type="email"
            required
            value={outro}
            onChange={(e) => setOutro(e.target.value)}
            placeholder="seuemail@gmail.com"
            aria-label="Outro e-mail"
            autoComplete="off"
          />
        )}
        {!outroAtivo && <input type="hidden" name="destino" value={escolha} />}
        {outroAtivo && (
          <p className="text-xs text-muted-foreground">
            O Cloudflare manda um e-mail de confirmação para esse endereço. O redirecionamento só começa depois que alguém clicar no link.
          </p>
        )}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="email-nome">
          Apelido <span className="font-normal text-muted-foreground">(opcional, só para você reconhecer)</span>
        </Label>
        <Input id="email-nome" name="nome" maxLength={80} defaultValue={atual?.nome} placeholder="Ex.: Atendimento" autoComplete="off" />
      </div>
      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />}>Cancelar</DialogClose>
        <Button type="submit" disabled={salvando}>
          {atual ? <Check /> : <Plus />}
          {salvando ? "Salvando..." : atual ? "Salvar" : "Criar endereço"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Resultado do salvamento dentro do próprio diálogo. */
function Resultado({ estado, editando }: { estado: EstadoEndereco; editando: boolean }) {
  if (estado.aguarda) {
    const confirmacao = estado.aguarda === "confirmacao";
    return (
      <>
        <div className="flex flex-col items-center gap-3 py-2 text-center" role="status">
          <span className="flex size-12 items-center justify-center rounded-lg bg-warning-soft text-warning">
            {confirmacao ? <MailCheck className="size-6" /> : <Clock className="size-6" />}
          </span>
          <p className="text-base font-semibold text-foreground">{confirmacao ? "Falta confirmar o e-mail" : "Endereço guardado"}</p>
          {confirmacao ? (
            <p className="max-w-sm text-sm text-muted-foreground">
              Mandamos um e-mail do Cloudflare para <b className="font-medium break-all text-foreground">{estado.destino}</b>. Clique no link de
              confirmação e volte aqui; a lista atualiza sozinha. Se não achar, olhe no spam.
            </p>
          ) : (
            <p className="max-w-sm text-sm text-muted-foreground">
              O token do Cloudflare ainda não tem permissão para criar endereços. Assim que for liberada, ele é criado sozinho.
            </p>
          )}
          <p className="max-w-sm text-sm text-muted-foreground">
            <b className="font-medium text-foreground">{estado.endereco}</b> aparece na lista como pendente até lá.
          </p>
        </div>
        <DialogFooter>
          <DialogClose render={<Button />}>Entendi</DialogClose>
        </DialogFooter>
      </>
    );
  }
  return (
    <Sucesso titulo={editando ? "Endereço atualizado" : `${estado.endereco} criado`}>
      Tudo que chegar em {estado.endereco} vai para {estado.destino}.
    </Sucesso>
  );
}

function EnderecoDialog({ dominio, destinos, atual, gatilho }: { dominio: string; destinos: Destino[]; atual?: Endereco; gatilho: React.ReactElement }) {
  const [aberta, setAberta] = useState(false);
  const [chave, setChave] = useState(0);
  const [salvo, setSalvo] = useState<EstadoEndereco | null>(null);
  return (
    <Dialog
      open={aberta}
      onOpenChange={(a) => {
        setAberta(a);
        if (a) {
          setChave((k) => k + 1);
          setSalvo(null);
        }
      }}
    >
      <DialogTrigger render={gatilho} />
      <DialogContent>
        {salvo ? (
          <Resultado estado={salvo} editando={!!atual} />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{atual ? "Editar endereço" : "Novo endereço"}</DialogTitle>
              <DialogDescription>
                {atual ? "Mude o endereço ou para onde os e-mails vão." : `Crie um endereço @${dominio} e escolha em qual e-mail as mensagens chegam.`}
              </DialogDescription>
            </DialogHeader>
            <EnderecoForm key={chave} dominio={dominio} destinos={destinos} atual={atual} aoSalvar={setSalvo} />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function NovoEnderecoDialog({ dominio, destinos }: { dominio: string; destinos: Destino[] }) {
  return (
    <EnderecoDialog
      dominio={dominio}
      destinos={destinos}
      gatilho={
        <Button>
          <MailPlus />
          Novo endereço
        </Button>
      }
    />
  );
}

function RemoverDialog({ endereco }: { endereco: Endereco }) {
  const [aberta, setAberta] = useState(false);
  const [pendente, iniciar] = useTransition();
  const confirmar = () =>
    iniciar(async () => {
      const r = await remover(endereco.id);
      if (r.erro) return void toast.error(r.erro);
      toast.success(`${endereco.endereco} removido.`);
      setAberta(false);
    });
  return (
    <Dialog open={aberta} onOpenChange={setAberta}>
      <DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Remover ${endereco.endereco}`} title="Remover" className="text-muted-foreground hover:text-danger" />}>
        <Trash2 />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remover {endereco.endereco}?</DialogTitle>
          <DialogDescription>
            Quem escrever para esse endereço depois disso não vai conseguir entregar a mensagem. Os e-mails que já chegaram continuam na sua caixa.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
          <Button variant="destructive" disabled={pendente} onClick={confirmar}>
            <Trash2 />
            {pendente ? "Removendo..." : "Remover endereço"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Ativo({ endereco }: { endereco: Endereco }) {
  const [ativo, setAtivo] = useState(endereco.ativo);
  const [pendente, iniciar] = useTransition();
  const mudar = (v: boolean) =>
    iniciar(async () => {
      setAtivo(v);
      const r = await alternar(endereco.id, v);
      if (r.erro) {
        setAtivo(!v);
        return void toast.error(r.erro);
      }
      toast.success(v ? `${endereco.endereco} voltou a receber.` : `${endereco.endereco} pausado.`);
    });
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
      <Switch checked={ativo} disabled={pendente} onCheckedChange={mudar} aria-label={`Receber e-mails em ${endereco.endereco}`} />
      <span className="w-12">{ativo ? "Ligado" : "Pausado"}</span>
    </label>
  );
}

function Linha({ icone, titulo, apelido, destino, children, apagado }: {
  icone: React.ReactNode; titulo: string; apelido?: string | null; destino: React.ReactNode; children: React.ReactNode; apagado?: boolean;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">{icone}</span>
      <div className={cn("min-w-0 flex-1", apagado && "opacity-60")}>
        <p className="flex flex-wrap items-center gap-x-2 text-sm">
          <b className="font-semibold break-all text-foreground">{titulo}</b>
          {apelido && <span className="text-muted-foreground">{apelido}</span>}
        </p>
        <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
          <ArrowRight className="size-3.5 shrink-0" />
          <span className="break-all">{destino}</span>
        </p>
      </div>
      <div className="flex items-center gap-1">{children}</div>
    </li>
  );
}

function textoCatchAll(c: CatchAll) {
  if (!c.ativo || c.acao === "descartar") return "E-mails para endereços que não estão nesta lista são recusados.";
  if (c.acao === "encaminhar") return `E-mails para endereços que não estão nesta lista vão para ${c.destinos.join(", ")}.`;
  return "E-mails para endereços que não estão nesta lista são tratados por uma automação do Cloudflare.";
}

function CancelarPendente({ local, endereco }: { local: string; endereco: string }) {
  const [pendente, iniciar] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`Cancelar ${endereco}`}
      title="Cancelar"
      disabled={pendente}
      className="text-muted-foreground hover:text-danger"
      onClick={() =>
        iniciar(async () => {
          await removerPendente(local);
          toast.success(`${endereco} cancelado.`);
        })
      }
    >
      <X />
    </Button>
  );
}

export function EnderecosCard({ dominio, lista, pendentes, destinos, confirmados }: {
  dominio: string;
  /** null = sem permissão para ler as regras. */
  lista: { enderecos: Endereco[]; catchAll: CatchAll | null } | null;
  pendentes: Pendente[];
  destinos: Destino[];
  confirmados: string[];
}) {
  const enderecos = lista?.enderecos ?? [];
  const vazio = enderecos.length === 0 && pendentes.length === 0;
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="border-b py-4">
        <CardTitle>Endereços</CardTitle>
        <CardDescription>Cada endereço é um redirecionamento: não tem caixa própria, a mensagem cai direto no e-mail escolhido.</CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        {vazio ? (
          <div className="flex flex-col items-center px-6 py-10 text-center">
            <span className="mb-3 flex size-11 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Inbox className="size-5" />
            </span>
            <p className="text-sm font-semibold text-foreground">{lista ? "Nenhum endereço ainda" : "Não deu para carregar os endereços"}</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              {lista ? `Crie o primeiro, por exemplo contato@${dominio}.` : "Assim que a permissão for liberada eles aparecem aqui."}
            </p>
          </div>
        ) : (
          <ul className="divide-y">
            {enderecos.map((e) => (
              <Linha key={e.id} icone={<MailCheck className="size-4" />} titulo={e.endereco} apelido={e.nome} destino={e.destinos.join(", ")} apagado={!e.ativo}>
                <Ativo endereco={e} />
                <EnderecoDialog
                  dominio={dominio}
                  destinos={destinos}
                  atual={e}
                  gatilho={
                    <Button variant="ghost" size="icon-sm" aria-label={`Editar ${e.endereco}`} title="Editar" className="text-muted-foreground">
                      <Pencil />
                    </Button>
                  }
                />
                <RemoverDialog endereco={e} />
              </Linha>
            ))}
            {pendentes.map((p) => {
              const endereco = `${p.local}@${dominio}`;
              const motivo = confirmados.includes(p.destino) ? "criado assim que a permissão do Cloudflare for liberada" : `criado quando ${p.destino} confirmar`;
              return (
                <Linha
                  key={p.local}
                  icone={<Clock className="size-4" />}
                  titulo={endereco}
                  apelido={p.nome}
                  destino={
                    <>
                      {p.destino} <Badge variant="warning" className="ml-1">Pendente</Badge>
                      <span className="sr-only">, {motivo}</span>
                    </>
                  }
                >
                  <span className="hidden text-xs text-muted-foreground md:inline">Será {motivo}</span>
                  <CancelarPendente local={p.local} endereco={endereco} />
                </Linha>
              );
            })}
          </ul>
        )}
      </CardContent>
      {lista?.catchAll && <CardFooter className="border-t py-3 text-xs text-muted-foreground">{textoCatchAll(lista.catchAll)}</CardFooter>}
    </Card>
  );
}

function JaConfirmei() {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  return (
    <Button variant="outline" size="sm" disabled={pendente} onClick={() => iniciar(() => router.refresh())}>
      <RefreshCw className={cn(pendente && "animate-spin")} />
      Já confirmei
    </Button>
  );
}

export function DestinosCard({ destinos }: { destinos: Destino[] }) {
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="border-b py-4">
        <CardTitle>E-mails que recebem</CardTitle>
        <CardDescription>Para receber redirecionamentos, cada e-mail precisa clicar uma vez no link de confirmação que o Cloudflare manda.</CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        <ul className="divide-y">
          {destinos.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3">
              <span className="min-w-0 flex-1 text-sm break-all text-foreground">{d.email}</span>
              {d.verificado ? (
                <Badge variant="success">
                  <Check />
                  Confirmado
                </Badge>
              ) : (
                <>
                  <Badge variant="warning">
                    <Clock />
                    Aguardando confirmação
                  </Badge>
                  <JaConfirmei />
                </>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function Copiar({ valor, rotulo }: { valor: string; rotulo: string }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      aria-label={`Copiar ${rotulo}`}
      onClick={() => navigator.clipboard.writeText(valor).then(() => toast.success(`${rotulo} copiado.`))}
    >
      <Copy />
      Copiar
    </Button>
  );
}

function Campo({ rotulo, valor, copiar = true }: { rotulo: string; valor: React.ReactNode; copiar?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border bg-card px-3 py-2 text-sm">
      <span className="w-full shrink-0 text-xs text-muted-foreground sm:w-36 sm:text-sm">{rotulo}</span>
      <span className={cn("min-w-0 flex-1", copiar ? "font-medium break-all text-foreground" : "break-words text-muted-foreground italic")}>{valor}</span>
      {copiar && typeof valor === "string" && <Copiar valor={valor} rotulo={rotulo} />}
    </div>
  );
}

function Passo({ n, titulo, children }: { n: number; titulo: React.ReactNode; children?: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[1.75rem_1fr] gap-x-3">
      <span className="flex size-7 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground tabular-nums">{n}</span>
      <div className="min-w-0 pt-0.5">
        <p className="text-sm text-foreground">{titulo}</p>
        {children && <div className="mt-2.5 grid gap-1.5">{children}</div>}
      </div>
    </li>
  );
}

export function GuiaGmail({ exemplo }: { exemplo: string }) {
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="border-b py-4">
        <CardTitle>Responder como esses endereços pelo Gmail</CardTitle>
        <CardDescription>
          Faça uma vez para cada endereço. Depois, ao escrever ou responder no Gmail, é só escolher {exemplo} no campo &quot;De&quot;.
        </CardDescription>
      </CardHeader>
      <CardContent className="py-5">
        <ol className="grid gap-5">
          <Passo n={1} titulo={<>No Gmail do computador, clique na engrenagem e depois em <b>Ver todas as configurações</b>.</>} />
          <Passo n={2} titulo={<>Abra a aba <b>Contas e importação</b> e, em <b>Enviar e-mail como</b>, clique em <b>Adicionar outro endereço de e-mail</b>.</>} />
          <Passo n={3} titulo={<>Preencha e deixe marcado <b>Tratar como um alias</b>. Clique em <b>Próxima etapa</b>.</>}>
            <Campo rotulo="Nome" valor="Seu nome ou o nome do escritório" copiar={false} />
            <Campo rotulo="Endereço de e-mail" valor={exemplo} />
          </Passo>
          <Passo n={4} titulo={<>Preencha o servidor e clique em <b>Adicionar conta</b>.</>}>
            <Campo rotulo="Servidor SMTP" valor="smtp.resend.com" />
            <Campo rotulo="Porta" valor="465" />
            <Campo rotulo="Nome de usuário" valor="resend" />
            <Campo rotulo="Senha" valor="a chave SMTP que o Marcelo te passou" copiar={false} />
            <Campo rotulo="Segurança" valor="Conexão segura usando SSL" copiar={false} />
          </Passo>
          <Passo n={5} titulo="O Gmail manda um código de confirmação para o endereço. Ele chega neste mesmo Gmail, pelo redirecionamento. Copie o código, cole na janela e confirme." />
          <Passo
            n={6}
            titulo={<>Opcional: em <b>Contas e importação</b>, marque <b>Responder do mesmo endereço para o qual a mensagem foi enviada</b>. Assim a resposta sai pelo endereço do escritório sozinha.</>}
          />
        </ol>
      </CardContent>
    </Card>
  );
}
