"use client";

import { startTransition, useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, BookmarkCheck, BookmarkPlus, Check, FileText, Loader2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import {
  alternarBusca, alternarSalva, arquivosDaLicitacao, atualizarAgora, atualizarSalva, removerBusca, salvarBusca, type EstadoBusca,
} from "@/actions/licitacoes";
import { Erro } from "@/app/login/senha-forms";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { MODALIDADES, STATUS_SALVA, UFS, type StatusSalva } from "@/lib/licitacoes";
import type { ArquivoPncp } from "@/lib/pncp";

const selectCls =
  "h-9 w-full cursor-pointer rounded-md border border-input bg-card px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type Empresa = { id: string; nome: string };

/** "Atualizar agora": dispara a sincronização e recarrega a lista a cada 10 s enquanto ela roda. */
export function AtualizarAgora({ rodando }: { rodando: boolean }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [acompanhando, setAcompanhando] = useState(false);
  const ativo = rodando || acompanhando;
  useEffect(() => {
    if (!ativo) return;
    const t = setInterval(() => document.visibilityState === "visible" && router.refresh(), 10_000);
    // depois do fim (rodando=false) para sozinho; teto de 4 min para não ficar recarregando à toa
    const fim = setTimeout(() => setAcompanhando(false), 240_000);
    return () => {
      clearInterval(t);
      clearTimeout(fim);
    };
  }, [ativo, router]);
  const [rodandoAntes, setRodandoAntes] = useState(rodando);
  if (rodando !== rodandoAntes) {
    setRodandoAntes(rodando);
    if (!rodando) setAcompanhando(false);
  }
  return (
    <Button
      variant="outline"
      disabled={pendente || rodando}
      onClick={() =>
        iniciar(async () => {
          const r = await atualizarAgora();
          (r.ok ? toast.success : toast.info)(r.mensagem);
          if (r.ok) {
            setAcompanhando(true);
            setTimeout(() => router.refresh(), 1500);
          }
        })
      }
    >
      <RefreshCw className={cn(ativo && "animate-spin")} />
      {rodando ? "Atualizando..." : "Atualizar agora"}
    </Button>
  );
}

export function SalvarBotao({ licitacaoId, salva }: { licitacaoId: string; salva: boolean }) {
  const [pendente, iniciar] = useTransition();
  const [otimista, setOtimista] = useState(salva);
  const [salvaAntes, setSalvaAntes] = useState(salva);
  if (salva !== salvaAntes) {
    setSalvaAntes(salva);
    setOtimista(salva);
  }
  return (
    <Button
      size="sm"
      variant={otimista ? "secondary" : "default"}
      disabled={pendente}
      aria-pressed={otimista}
      title={otimista ? "Tirar do acompanhamento" : "Salvar para acompanhar"}
      onClick={() =>
        iniciar(async () => {
          const novo = !otimista;
          setOtimista(novo);
          const r = await alternarSalva(licitacaoId, novo);
          if (r.erro) {
            setOtimista(!novo);
            toast.error(r.erro);
          } else if (novo) toast.success("Salva no acompanhamento.");
        })
      }
    >
      {otimista ? <BookmarkCheck /> : <BookmarkPlus />}
      {otimista ? "Salva" : "Salvar"}
    </Button>
  );
}

/** Lista o edital e anexos do PNCP quando abre (não fica no banco). */
export function ArquivosBotao({ licitacaoId }: { licitacaoId: string }) {
  const [estado, setEstado] = useState<{ arquivos?: ArquivoPncp[]; erro?: string } | null>(null);
  const [pendente, iniciar] = useTransition();
  return (
    <Popover
      onOpenChange={(aberto) => {
        if (aberto && !estado?.arquivos) iniciar(async () => setEstado(await arquivosDaLicitacao(licitacaoId)));
      }}
    >
      <PopoverTrigger render={<Button size="sm" variant="outline" />}>
        <FileText />
        Edital e arquivos
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <p className="px-1 text-xs font-medium text-muted-foreground">Documentos publicados no PNCP</p>
        {pendente || !estado ? (
          <p className="flex items-center gap-2 px-1 py-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Buscando no PNCP...
          </p>
        ) : estado.erro ? (
          <p className="px-1 py-2 text-sm text-danger">{estado.erro}</p>
        ) : !estado.arquivos?.length ? (
          <p className="px-1 py-2 text-sm text-muted-foreground">Nenhum arquivo publicado ainda. Veja no site do órgão.</p>
        ) : (
          <ul className="max-h-72 space-y-0.5 overflow-y-auto">
            {estado.arquivos.map((a) => (
              <li key={a.url}>
                <a
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-start gap-2 rounded-md px-1.5 py-1.5 text-sm hover:bg-muted"
                >
                  <FileText className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span className="min-w-0">
                    <span className="line-clamp-2 font-medium break-words text-foreground">{a.titulo || "Arquivo"}</span>
                    <span className="block text-xs text-muted-foreground">{a.tipoDocumentoNome}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Etapa, empresa e nota de uma licitação salva; salva ao mudar (nota: 1 s depois de parar de digitar ou ao sair do campo). */
export function SalvaControles({ id, status, empresaId, nota, empresas }: {
  id: string; status: StatusSalva; empresaId: string | null; nota: string | null; empresas: Empresa[];
}) {
  const [pendente, iniciar] = useTransition();
  const [texto, setTexto] = useState(nota ?? "");
  const [salvo, setSalvo] = useState(nota ?? "");
  const salvar = (dados: Parameters<typeof atualizarSalva>[1]) =>
    iniciar(async () => {
      const r = await atualizarSalva(id, dados);
      if (r.erro) toast.error(r.erro);
    });
  const salvarNota = () => {
    if (texto === salvo) return;
    setSalvo(texto);
    salvar({ nota: texto });
  };
  // a nota vai junto antes de mudar etapa/empresa: a mudança remonta o cartão em outra coluna
  const mudar = (dados: Parameters<typeof atualizarSalva>[1]) => {
    if (texto !== salvo) setSalvo(texto);
    salvar(texto !== salvo ? { ...dados, nota: texto } : dados);
  };
  useEffect(() => {
    if (texto === salvo) return;
    const t = setTimeout(salvarNota, 1000);
    return () => clearTimeout(t);
  });
  return (
    <div className={cn("grid gap-2 transition-opacity", pendente && "opacity-70")}>
      <div className="grid gap-2">
        <select
          aria-label="Etapa"
          className={cn(selectCls, "h-8 min-w-0 text-xs")}
          defaultValue={status}
          onChange={(e) => mudar({ status: e.target.value as StatusSalva })}
        >
          {Object.entries(STATUS_SALVA).map(([k, v]) => (
            <option key={k} value={k}>{v.rotulo}</option>
          ))}
        </select>
        <select
          aria-label="Empresa cliente"
          className={cn(selectCls, "h-8 min-w-0 text-xs")}
          defaultValue={empresaId ?? ""}
          onChange={(e) => mudar({ empresaId: e.target.value })}
        >
          <option value="">Sem empresa</option>
          {empresas.map((e) => (
            <option key={e.id} value={e.id}>{e.nome}</option>
          ))}
        </select>
      </div>
      <Textarea
        aria-label="Anotações"
        placeholder="Anotações: documentos que faltam, contato, valor da proposta..."
        className="min-h-14 text-xs md:text-xs"
        value={texto}
        maxLength={4000}
        onChange={(e) => setTexto(e.target.value)}
        onBlur={salvarNota}
      />
    </div>
  );
}

export function RemoverSalva({ licitacaoId }: { licitacaoId: string }) {
  const [pendente, iniciar] = useTransition();
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label="Tirar do acompanhamento"
      title="Tirar do acompanhamento"
      disabled={pendente}
      onClick={() => iniciar(async () => void (await alternarSalva(licitacaoId, false)))}
    >
      <Trash2 />
    </Button>
  );
}

export type BuscaInicial = {
  id?: string; nome?: string; termos?: string; uf?: string; municipio?: string; modalidade?: number;
  min?: string; max?: string; empresaId?: string | null;
};

function BuscaForm({ inicial, empresas, municipios, aoSalvar }: {
  inicial: BuscaInicial; empresas: Empresa[]; municipios: string[]; aoSalvar: () => void;
}) {
  const [estado, salvar, salvando] = useActionState(async (prev: EstadoBusca, form: FormData) => {
    const r = await salvarBusca(inicial.id ?? null, prev, form);
    if (r.ok) aoSalvar();
    return r;
  }, {});
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const dados = new FormData(e.currentTarget);
        startTransition(() => salvar(dados));
      }}
      className="grid gap-4"
    >
      <Erro>{estado.erro}</Erro>
      <div className="grid gap-2">
        <Label htmlFor="busca-nome">Nome da busca</Label>
        <Input id="busca-nome" name="nome" required maxLength={80} defaultValue={inicial.nome} placeholder="Ex.: Limpeza para a Silva & Filhos" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="busca-termos">Palavras</Label>
        <Input id="busca-termos" name="termos" defaultValue={inicial.termos} placeholder="Ex.: limpeza, material de higiene, copeiragem" />
        <p className="text-xs text-muted-foreground">Separe por vírgula. Basta uma aparecer no objeto ou no órgão. Acentos não importam.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="busca-uf">Estado</Label>
          <select id="busca-uf" name="uf" defaultValue={inicial.uf ?? ""} className={selectCls}>
            <option value="">Todos sincronizados</option>
            {UFS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="busca-municipio">Município</Label>
          <select id="busca-municipio" name="municipio" defaultValue={inicial.municipio ?? ""} className={selectCls}>
            <option value="">Todos</option>
            {inicial.municipio && !municipios.includes(inicial.municipio) && <option value={inicial.municipio}>{inicial.municipio}</option>}
            {municipios.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="busca-modalidade">Modalidade</Label>
          <select id="busca-modalidade" name="modalidade" defaultValue={inicial.modalidade ?? ""} className={selectCls}>
            <option value="">Todas</option>
            {Object.entries(MODALIDADES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="busca-empresa">Para qual cliente</Label>
          <select id="busca-empresa" name="empresaId" defaultValue={inicial.empresaId ?? ""} className={selectCls}>
            <option value="">Nenhum em especial</option>
            {empresas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="busca-min">Valor mínimo (R$)</Label>
          <Input id="busca-min" name="min" inputMode="decimal" defaultValue={inicial.min} placeholder="0,00" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="busca-max">Valor máximo (R$)</Label>
          <Input id="busca-max" name="max" inputMode="decimal" defaultValue={inicial.max} placeholder="Sem limite" />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Todo dia, depois da atualização das 7h30, chega um e-mail para os contadores com as licitações novas desta busca. Sem novas, nada é enviado.
      </p>
      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />}>Cancelar</DialogClose>
        <Button type="submit" disabled={salvando}>
          {inicial.id ? <Check /> : <Bell />}
          {salvando ? "Salvando..." : inicial.id ? "Salvar" : "Criar alerta"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function BuscaDialog({ inicial = {}, empresas, municipios, gatilho }: {
  inicial?: BuscaInicial; empresas: Empresa[]; municipios: string[]; gatilho?: "novo" | "filtros" | "editar";
}) {
  const [aberta, setAberta] = useState(false);
  const [chave, setChave] = useState(0);
  const botao =
    gatilho === "editar" ? (
      <Button size="icon-sm" variant="ghost" aria-label="Editar busca" title="Editar busca" />
    ) : gatilho === "filtros" ? (
      <Button variant="ghost" />
    ) : (
      <Button />
    );
  return (
    <Dialog
      open={aberta}
      onOpenChange={(a) => {
        setAberta(a);
        if (a) setChave((k) => k + 1);
      }}
    >
      <DialogTrigger render={botao}>
        {gatilho === "editar" ? <Pencil /> : gatilho === "filtros" ? <><Bell />Criar alerta com estes filtros</> : <><Plus />Nova busca</>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{inicial.id ? "Editar busca" : "Nova busca com alerta"}</DialogTitle>
          <DialogDescription>Escolha o que interessa. As licitações novas que baterem chegam por e-mail.</DialogDescription>
        </DialogHeader>
        <BuscaForm
          key={chave}
          inicial={inicial}
          empresas={empresas}
          municipios={municipios}
          aoSalvar={() => {
            setAberta(false);
            toast.success(inicial.id ? "Busca atualizada." : "Alerta criado.");
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

export function BuscaAcoes({ id, ativa }: { id: string; ativa: boolean }) {
  const [pendente, iniciar] = useTransition();
  return (
    <div className="flex items-center gap-1">
      <label className="mr-1 flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
        <Switch checked={ativa} disabled={pendente} onCheckedChange={(v) => iniciar(() => alternarBusca(id, v))} aria-label="Alerta por e-mail" />
        {ativa ? "E-mail ligado" : "E-mail desligado"}
      </label>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Excluir busca"
        title="Excluir busca"
        disabled={pendente}
        onClick={() => confirm("Excluir esta busca? O alerta para de chegar.") && iniciar(() => removerBusca(id))}
      >
        <Trash2 />
      </Button>
    </div>
  );
}
