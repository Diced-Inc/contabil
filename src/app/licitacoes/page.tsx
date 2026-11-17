import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import Link from "next/link";
import {
  ArrowLeft, Bell, BellOff, Building2, CalendarClock, ChevronLeft, ChevronRight, ExternalLink, Gavel, Globe, Search, SearchX, X,
} from "lucide-react";
import { cn } from "cn";
import { Carregando, EmptyState, FilterField, PageHeader, Toolbar } from "@/components/page-header";
import { Topo } from "@/components/topo";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { estadoSync } from "@/db/licitacoes";
import type { Licitacao } from "@/db/schema";
import { fmtValor } from "@/lib/format";
import { fmtDataHoraSP, MODALIDADES, prazoEncerramento, STATUS_SALVA, type StatusSalva } from "@/lib/licitacoes";
import { requireUser } from "@/supabase/server";
import {
  contarSalvas, lerFiltros, listarAbertas, listarBuscas, listarEmpresas, listarSalvas, opcoesFiltros, POR_PAGINA, type Filtros,
} from "./dados";
import { ArquivosBotao, AtualizarAgora, BuscaAcoes, BuscaDialog, RemoverSalva, SalvaControles, SalvarBotao } from "./licitacoes-ui";

// local: constante exportada de módulo "use client" chega no servidor como referência, não como string
const selectCls =
  "h-9 w-full cursor-pointer rounded-md border border-input bg-card px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export const metadata: Metadata = { title: "Licitações | DB Contador" };
// "Atualizar agora" roda a sincronização em after(), dentro do limite da página
export const maxDuration = 300;

const INTRO = "Contratações públicas com propostas abertas, direto do PNCP. A lista se atualiza todo dia às 7h30.";
const ABAS = [
  ["abertas", "Abertas"],
  ["salvas", "Acompanhamento"],
  ["alertas", "Alertas"],
] as const;
type Aba = (typeof ABAS)[number][0];
const PRAZOS = [[0, "Encerra hoje"], [3, "Até 3 dias"], [7, "Até 7 dias"], [15, "Até 15 dias"], [30, "Até 30 dias"]] as const;
const fmtBRL = (v: string) => `R$ ${fmtValor(v)}`;

function Prazo({ l, className }: { l: Licitacao; className?: string }) {
  const p = prazoEncerramento(l.encerramentoPropostas);
  return (
    <span className={cn("flex items-center gap-1.5 text-sm", p.urgente ? "font-semibold text-danger" : p.encerrada ? "text-muted-foreground" : "text-foreground", className)}>
      <CalendarClock className="size-4 shrink-0" />
      <span>
        {p.texto}
        {l.encerramentoPropostas && !p.urgente && <span className="font-normal text-muted-foreground"> · {fmtDataHoraSP(l.encerramentoPropostas)}</span>}
      </span>
    </span>
  );
}

function Links({ l }: { l: Licitacao }) {
  return (
    <>
      <a href={l.linkPncp} target="_blank" rel="noreferrer" className={buttonVariants({ size: "sm", variant: "outline" })}>
        <ExternalLink />
        Ver no PNCP
      </a>
      <ArquivosBotao licitacaoId={l.id} />
      {l.linkSistemaOrigem && (
        <a href={l.linkSistemaOrigem} target="_blank" rel="noreferrer" title="Plataforma onde a disputa acontece" className={buttonVariants({ size: "sm", variant: "ghost" })}>
          <Globe />
          Plataforma da disputa
        </a>
      )}
    </>
  );
}

function CartaoLicitacao({ l, salva }: { l: Licitacao; salva: boolean }) {
  return (
    <article className="rounded-xl border bg-card p-5 shadow-card transition-colors hover:border-primary/25">
      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="brand">{l.modalidadeNome}</Badge>
            {l.numeroCompra && <span className="text-xs text-muted-foreground tabular-nums">Nº {l.numeroCompra}</span>}
          </div>
          <h3 className="line-clamp-2 font-medium leading-snug text-foreground" title={l.objeto}>{l.objeto}</h3>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Building2 className="size-4 shrink-0" />
            <span className="truncate">
              {l.orgaoNome} · {l.municipio}/{l.uf}
            </span>
          </p>
        </div>
        <div className="flex shrink-0 flex-row items-end justify-between gap-1 md:w-56 md:flex-col md:items-end">
          <span className="text-xs text-muted-foreground">Valor estimado</span>
          <span className={cn("text-lg font-semibold tabular-nums", l.valorEstimado ? "text-foreground" : "text-sm font-normal text-muted-foreground")}>
            {l.valorEstimado ? fmtBRL(l.valorEstimado) : "Não informado"}
          </span>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <Prazo l={l} />
        <div className="flex flex-wrap items-center gap-2">
          <Links l={l} />
          <SalvarBotao licitacaoId={l.id} salva={salva} />
        </div>
      </div>
    </article>
  );
}

/** Mantém os filtros na URL ao trocar de página. */
function hrefPagina(f: Filtros, pagina: number) {
  const qs = new URLSearchParams();
  if (f.q) qs.set("q", f.q);
  f.ufs.forEach((u) => qs.append("uf", u));
  f.municipios.forEach((m) => qs.append("municipio", m));
  f.modalidades.forEach((m) => qs.append("modalidade", String(m)));
  if (f.valorMin !== null) qs.set("min", String(f.valorMin));
  if (f.valorMax !== null) qs.set("max", String(f.valorMax));
  if (f.prazoDias !== null) qs.set("prazo", String(f.prazoDias));
  if (f.ordem !== "encerramento") qs.set("ordem", f.ordem);
  if (pagina > 1) qs.set("pagina", String(pagina));
  return `/licitacoes?${qs}`;
}

async function Abertas({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const f = await lerFiltros(sp);
  const [{ itens, total }, opcoes, empresas] = await Promise.all([listarAbertas(f), opcoesFiltros(f.ufs), listarEmpresas()]);
  const ufAtual = f.ufs[0] ?? "";
  const municipioAtual = f.municipios[0] ?? "";
  const modalidadeAtual = f.modalidades[0];
  const filtrado = !!(f.q || f.ufs.length || f.municipios.length || f.modalidades.length || f.valorMin !== null || f.valorMax !== null || f.prazoDias !== null);
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const minTxt = f.valorMin !== null ? fmtValor(f.valorMin) : "";
  const maxTxt = f.valorMax !== null ? fmtValor(f.valorMax) : "";

  return (
    <>
      <Toolbar>
        <form className="contents">
          <FilterField label="Buscar" className="min-w-64 flex-[2]">
            <Input name="q" defaultValue={f.q} placeholder="Palavras no objeto ou no órgão. Ex.: limpeza, merenda" />
          </FilterField>
          <FilterField label="Estado">
            <select name="uf" defaultValue={ufAtual} className={cn(selectCls, "w-24")}>
              <option value="">Todos</option>
              {opcoes.ufs.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </FilterField>
          <FilterField label="Município" className="min-w-40 flex-1">
            <select name="municipio" defaultValue={municipioAtual} className={selectCls}>
              <option value="">Todos</option>
              {municipioAtual && !opcoes.municipios.includes(municipioAtual) && <option value={municipioAtual}>{municipioAtual}</option>}
              {opcoes.municipios.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </FilterField>
          <FilterField label="Modalidade" className="min-w-40 flex-1">
            <select name="modalidade" defaultValue={modalidadeAtual ?? ""} className={selectCls}>
              <option value="">Todas</option>
              {Object.entries(MODALIDADES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </FilterField>
          <FilterField label="Valor de (R$)">
            <Input name="min" defaultValue={minTxt} inputMode="decimal" placeholder="0,00" className="w-32" />
          </FilterField>
          <FilterField label="Até (R$)">
            <Input name="max" defaultValue={maxTxt} inputMode="decimal" placeholder="Sem limite" className="w-32" />
          </FilterField>
          <FilterField label="Prazo">
            <select name="prazo" defaultValue={f.prazoDias ?? ""} className={cn(selectCls, "w-36")}>
              <option value="">Qualquer</option>
              {PRAZOS.map(([d, r]) => <option key={d} value={d}>{r}</option>)}
            </select>
          </FilterField>
          <FilterField label="Ordenar por">
            <select name="ordem" defaultValue={f.ordem} className={cn(selectCls, "w-44")}>
              <option value="encerramento">Encerra primeiro</option>
              <option value="valor">Maior valor</option>
            </select>
          </FilterField>
          <Button type="submit">
            <Search />
            Buscar
          </Button>
          {filtrado && (
            <Link href="/licitacoes" className={buttonVariants({ variant: "ghost" })}>
              <X />
              Limpar
            </Link>
          )}
        </form>
      </Toolbar>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          <b className="font-semibold text-foreground tabular-nums">{total.toLocaleString("pt-BR")}</b>{" "}
          {total === 1 ? "licitação aberta" : "licitações abertas"}
          {filtrado ? " com esses filtros" : ""}
          {paginas > 1 && ` · página ${f.pagina} de ${paginas}`}
        </p>
        {filtrado && (
          <BuscaDialog
            gatilho="filtros"
            empresas={empresas}
            municipios={opcoes.municipios}
            inicial={{
              nome: f.q ? f.q.slice(0, 60) : "",
              termos: f.q,
              uf: ufAtual,
              municipio: municipioAtual,
              modalidade: modalidadeAtual,
              min: minTxt,
              max: maxTxt,
            }}
          />
        )}
      </div>

      {itens.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title={filtrado ? "Nenhuma licitação aberta com esses filtros" : "Nenhuma licitação baixada ainda"}
          hint={filtrado ? "Tente menos palavras, outro município ou tire o filtro de valor." : "Clique em Atualizar agora para buscar no PNCP."}
        />
      ) : (
        <div className="grid gap-3">
          {itens.map(({ l, salvaId }) => <CartaoLicitacao key={l.id} l={l} salva={!!salvaId} />)}
        </div>
      )}

      {paginas > 1 && (
        <nav className="mt-6 flex items-center justify-center gap-2" aria-label="Páginas">
          {f.pagina > 1 && (
            <Link href={hrefPagina(f, f.pagina - 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
              <ChevronLeft />
              Anterior
            </Link>
          )}
          <span className="px-2 text-sm text-muted-foreground tabular-nums">{f.pagina} / {paginas}</span>
          {f.pagina < paginas && (
            <Link href={hrefPagina(f, f.pagina + 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
              Próxima
              <ChevronRight />
            </Link>
          )}
        </nav>
      )}
    </>
  );
}

const COLUNAS: { titulo: string; status: StatusSalva[] }[] = [
  { titulo: "Interesse", status: ["interesse"] },
  { titulo: "Analisando", status: ["analisando"] },
  { titulo: "Proposta enviada", status: ["proposta_enviada"] },
  { titulo: "Resultado", status: ["ganha", "perdida", "descartada"] },
];

async function Salvas() {
  const [salvas, empresas] = await Promise.all([listarSalvas(), listarEmpresas()]);
  if (!salvas.length) {
    return (
      <EmptyState
        icon={Gavel}
        title="Nenhuma licitação em acompanhamento"
        hint="Na aba Abertas, clique em Salvar nas que podem servir para algum cliente. Elas aparecem aqui, separadas por etapa."
        action={<Link href="/licitacoes" className={buttonVariants()}>Ver licitações abertas</Link>}
      />
    );
  }
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {COLUNAS.map((c) => {
        const itens = salvas.filter((x) => c.status.includes(x.s.status));
        return (
          <section key={c.titulo} className="flex min-w-0 flex-col rounded-xl border bg-muted/40 p-3">
            <h2 className="mb-3 flex items-center justify-between px-1 text-sm font-semibold text-foreground">
              {c.titulo}
              <span className="rounded-full bg-card px-2 py-px text-xs font-medium text-muted-foreground ring-1 ring-border tabular-nums">{itens.length}</span>
            </h2>
            <div className="grid gap-3">
              {itens.length === 0 && <p className="px-1 pb-2 text-xs text-muted-foreground">Nada nesta etapa.</p>}
              {itens.map(({ s, l, empresa }) => (
                <article key={s.id} className="min-w-0 rounded-lg border bg-card p-3 shadow-xs">
                  <div className="mb-1.5 flex items-start justify-between gap-2">
                    <div className="flex flex-wrap gap-1">
                      <Badge variant="muted">{l.modalidadeNome}</Badge>
                      {c.status.length > 1 && <Badge variant={STATUS_SALVA[s.status].badge}>{STATUS_SALVA[s.status].rotulo}</Badge>}
                      {l.situacaoId !== 1 && <Badge variant="warning">{l.situacaoNome}</Badge>}
                    </div>
                    <RemoverSalva licitacaoId={l.id} />
                  </div>
                  <h3 className="line-clamp-3 text-sm font-medium leading-snug text-foreground" title={l.objeto}>{l.objeto}</h3>
                  <p className="mt-1 truncate text-xs text-muted-foreground" title={l.orgaoNome}>{l.orgaoNome} · {l.municipio}/{l.uf}</p>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs">
                    <Prazo l={l} className="text-xs" />
                    {l.valorEstimado && <span className="shrink-0 font-semibold tabular-nums">{fmtBRL(l.valorEstimado)}</span>}
                  </div>
                  {empresa && <p className="mt-2 truncate text-xs font-medium text-primary">Para {empresa}</p>}
                  <div className="mt-3 border-t pt-3">
                    <SalvaControles id={s.id} status={s.status} empresaId={s.empresaId} nota={s.nota} empresas={empresas} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <a href={l.linkPncp} target="_blank" rel="noreferrer" className={buttonVariants({ size: "sm", variant: "outline" })}>
                      <ExternalLink />
                      PNCP
                    </a>
                    <ArquivosBotao licitacaoId={l.id} />
                  </div>
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Criterios({ b }: { b: Awaited<ReturnType<typeof listarBuscas>>[number]["b"] }) {
  const chips = [
    ...b.termos.map((t) => `"${t}"`),
    ...b.ufs,
    ...b.municipios,
    ...b.modalidades.map((m) => MODALIDADES[m] ?? `Modalidade ${m}`),
    b.valorMin && `a partir de ${fmtBRL(b.valorMin)}`,
    b.valorMax && `até ${fmtBRL(b.valorMax)}`,
  ].filter((x): x is string => !!x);
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((c) => <Badge key={c} variant="muted">{c}</Badge>)}
    </div>
  );
}

async function Alertas() {
  const [buscas, empresas, { municipios }] = await Promise.all([listarBuscas(), listarEmpresas(), opcoesFiltros([])]);
  const nova = <BuscaDialog empresas={empresas} municipios={municipios} />;
  if (!buscas.length) {
    return (
      <EmptyState
        icon={Bell}
        title="Nenhuma busca salva"
        hint="Salve uma busca (palavras, cidade, valor) e receba por e-mail, todo dia, as licitações novas que baterem com ela."
        action={nova}
      />
    );
  }
  return (
    <>
      <div className="mb-4 flex justify-end">{nova}</div>
      <div className="grid gap-3">
        {buscas.map(({ b, empresa, abertas }) => (
          <article key={b.id} className={cn("rounded-xl border bg-card p-5 shadow-card", !b.ativa && "opacity-75")}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-2">
                <h3 className="flex items-center gap-2 font-semibold text-foreground">
                  {b.ativa ? <Bell className="size-4 text-primary" /> : <BellOff className="size-4 text-muted-foreground" />}
                  {b.nome}
                </h3>
                <Criterios b={b} />
                <p className="text-xs text-muted-foreground">
                  {empresa ? <>Para <b className="font-medium text-foreground">{empresa}</b> · </> : null}
                  {b.ultimoEnvio ? `Último e-mail em ${fmtDataHoraSP(b.ultimoEnvio)}` : "Nenhum e-mail enviado ainda"}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Link href={`/licitacoes?alerta=${b.id}`} className={buttonVariants({ size: "sm", variant: "outline" })}>
                  <Search />
                  {abertas === 1 ? "1 aberta agora" : `${abertas.toLocaleString("pt-BR")} abertas agora`}
                </Link>
                <BuscaDialog
                  gatilho="editar"
                  empresas={empresas}
                  municipios={municipios}
                  inicial={{
                    id: b.id,
                    nome: b.nome,
                    termos: b.termos.join(", "),
                    uf: b.ufs[0],
                    municipio: b.municipios[0],
                    modalidade: b.modalidades[0],
                    min: b.valorMin ? fmtValor(b.valorMin) : "",
                    max: b.valorMax ? fmtValor(b.valorMax) : "",
                    empresaId: b.empresaId,
                  }}
                />
                <BuscaAcoes id={b.id} ativa={b.ativa} />
              </div>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

async function Conteudo({ searchParams }: { searchParams: PageProps<"/licitacoes">["searchParams"] }) {
  await connection();
  await requireUser();
  const sp = await searchParams;
  const aba: Aba = ABAS.some(([k]) => k === sp.aba) ? (sp.aba as Aba) : "abertas";
  const [estado, nSalvas] = await Promise.all([estadoSync(), contarSalvas()]);

  return (
    <>
      <PageHeader
        title="Licitações"
        description={
          <>
            {INTRO}
            {estado.concluido && <> Última atualização: {fmtDataHoraSP(estado.concluido)}.</>}
          </>
        }
        actions={<AtualizarAgora rodando={estado.rodando} />}
      />
      {estado.erro && !estado.rodando && (
        <Alert className="mb-4 border-warning/25 bg-warning-soft text-warning *:data-[slot=alert-description]:text-warning/90">
          <AlertDescription>
            A última atualização parou no meio porque o PNCP não respondeu ({estado.erro}). A próxima continua de onde parou.
          </AlertDescription>
        </Alert>
      )}
      <nav className="mb-5 flex gap-1 border-b" aria-label="Seções">
        {ABAS.map(([k, rotulo]) => (
          <Link
            key={k}
            href={k === "abertas" ? "/licitacoes" : `/licitacoes?aba=${k}`}
            aria-current={aba === k ? "page" : undefined}
            className={cn(
              "-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              aba === k ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {rotulo}
            {k === "salvas" && nSalvas > 0 && (
              <span className="rounded-full bg-accent px-1.5 py-px text-[11px] font-semibold text-accent-foreground tabular-nums">{nSalvas}</span>
            )}
          </Link>
        ))}
      </nav>
      {aba === "abertas" && <Abertas sp={sp} />}
      {aba === "salvas" && <Salvas />}
      {aba === "alertas" && <Alertas />}
    </>
  );
}

export default function LicitacoesPage({ searchParams }: PageProps<"/licitacoes">) {
  return (
    <div className="flex min-h-svh flex-1 flex-col">
      <Topo />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <Link href="/" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="size-4" />
          Empresas
        </Link>
        <Suspense
          fallback={
            <>
              <PageHeader title="Licitações" description={INTRO} />
              <Carregando />
            </>
          }
        >
          <Conteudo searchParams={searchParams} />
        </Suspense>
      </main>
    </div>
  );
}
