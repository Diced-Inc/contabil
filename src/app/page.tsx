import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { and, asc, count, eq, isNotNull, isNull, or } from "drizzle-orm";
import { Building2, ChevronRight, Inbox, LogOut } from "lucide-react";
import { cn } from "cn";
import { LogoWordmark } from "@/components/logo";
import { Badge } from "@/components/ui/badge";
import { NovaEmpresaDialog } from "@/components/empresa-form";
import { Carregando, EmptyState, PageHeader } from "@/components/page-header";
import { db } from "@/db";
import { ciclosMensais, documentosRecebidos, empresas, membros, type CicloMensal } from "@/db/schema";
import { competenciaAtual, situacaoDas, tituloCompetencia, STATUS_CICLO, textoSituacaoDas, type SituacaoDas, type StatusCiclo } from "@/lib/ciclo";
import { fmtCnpj, hoje, PORTES, REGIMES } from "@/lib/format";
import { logoDaEmpresa, perfilDoUsuario, requireUser } from "@/supabase/server";
import { Avatar } from "@/components/avatar";
import { sair } from "./login/actions";

const REGIME_BADGE = { simples: "brand", mei: "success", presumido: "info", real: "violet" } as const;

function iniciais(nome: string) {
  const p = nome.split(/\s+/).filter((w) => w.length > 2);
  return ((p[0]?.[0] ?? nome[0] ?? "?") + (p[1]?.[0] ?? "")).toUpperCase();
}

async function Usuario() {
  await connection();
  const user = await requireUser();
  const { nome, avatarUrl } = await perfilDoUsuario(user);
  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-sm text-muted-foreground sm:inline">{nome || user.email}</span>
      <Avatar url={avatarUrl} texto={nome || (user.email ?? "")} />
      <form action={sair}>
        <button
          type="submit"
          aria-label="Sair"
          title="Sair"
          className="flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <LogOut className="size-4" />
        </button>
      </form>
    </div>
  );
}

type Painel = { status: StatusCiclo | null; novos: number; das: SituacaoDas | null };

/**
 * Situação do ciclo por empresa na competência atual. Sem ciclo: "aguardando extrato" só se há cliente com acesso.
 * DAS: o mais antigo ainda em aberto (de qualquer mês); senão, o da competência atual se pago.
 */
async function paineis(competencia: string, hj: string) {
  const [ciclos, novos, clientes] = await Promise.all([
    db
      .select()
      .from(ciclosMensais)
      .where(or(eq(ciclosMensais.competencia, competencia), eq(ciclosMensais.status, "das_enviado")))
      .orderBy(asc(ciclosMensais.dasVencimento)),
    db
      .select({ empresaId: documentosRecebidos.empresaId, n: count() })
      .from(documentosRecebidos)
      .where(isNull(documentosRecebidos.processadoEm))
      .groupBy(documentosRecebidos.empresaId),
    db
      .select({ empresaId: membros.empresaId })
      .from(membros)
      .where(and(isNotNull(membros.userId), isNotNull(membros.aceitoEm)))
      .groupBy(membros.empresaId),
  ]);
  const comCliente = new Set(clientes.map((c) => c.empresaId));
  const porEmpresa = Map.groupBy(ciclos, (c: CicloMensal) => c.empresaId);
  return (empresaId: string): Painel => {
    const cs = porEmpresa.get(empresaId) ?? [];
    const atual = cs.find((c) => c.competencia === competencia);
    const aberto = cs.find((c) => c.status === "das_enviado");
    return {
      status: atual?.status ?? (comCliente.has(empresaId) ? "aguardando_extrato" : null),
      novos: novos.find((n) => n.empresaId === empresaId)?.n ?? 0,
      das: situacaoDas(aberto ?? atual ?? { status: "aguardando_extrato", dasVencimento: null }, hj),
    };
  };
}

const DAS_COR = { pago: "text-success", vencido: "text-danger font-semibold", aberto: "text-warning" } as const;

function Resumo({ itens, competencia }: { itens: Painel[]; competencia: string }) {
  const contar = (f: (p: Painel) => boolean) => itens.filter(f).length;
  const partes: [number, string, string][] = [
    [contar((p) => p.status === "aguardando_extrato"), "aguardando extrato", "bg-warning"],
    [contar((p) => p.novos > 0), "com documentos novos", "bg-info"],
    [contar((p) => p.das?.tipo === "aberto"), "DAS em aberto", "bg-primary"],
    [contar((p) => p.das?.tipo === "vencido"), "vencidos", "bg-danger"],
  ];
  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border bg-card px-4 py-3 text-sm shadow-card">
      <span className="font-medium text-foreground">{tituloCompetencia(competencia)}</span>
      {partes.map(([n, rotulo, cor]) => (
        <span key={rotulo} className={cn("flex items-center gap-2", n === 0 ? "text-muted-foreground" : "text-foreground")}>
          <span className={cn("size-2 rounded-full", n === 0 ? "bg-border" : cor)} />
          <b className="font-semibold tabular-nums">{n}</b> {rotulo}
        </span>
      ))}
    </div>
  );
}

async function ListaEmpresas() {
  await connection();
  await requireUser();
  const hj = hoje();
  const competencia = competenciaAtual(hj);
  const [lista, painelDe] = await Promise.all([db.select().from(empresas).orderBy(asc(empresas.razaoSocial)), paineis(competencia, hj)]);
  const logos = await Promise.all(lista.map(logoDaEmpresa));
  const itens = lista.map((e) => painelDe(e.id));
  if (lista.length === 0) {
    return (
      <EmptyState
        icon={Building2}
        title="Nenhuma empresa cadastrada"
        hint="Cadastre a primeira empresa para importar extratos e começar a conciliar."
        action={<NovaEmpresaDialog />}
      />
    );
  }
  return (
    <>
      <Resumo itens={itens} competencia={competencia} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {lista.map((e, i) => (
          <Link
            key={e.id}
            href={`/e/${e.id}`}
            className="group flex items-center gap-4 rounded-xl border bg-card p-5 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {logos[i] ? (
              <Avatar url={logos[i]} texto="" className="size-12 rounded-xl" />
            ) : (
              <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent text-base font-semibold text-accent-foreground">
                {iniciais(e.razaoSocial)}
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 font-semibold leading-snug text-foreground">{e.razaoSocial}</span>
              <span className="mt-0.5 block text-sm text-muted-foreground tabular-nums">CNPJ {fmtCnpj(e.cnpj)}</span>
              <span className="mt-2 flex flex-wrap gap-1.5">
                <Badge variant={REGIME_BADGE[e.regimeTributario]}>{REGIMES[e.regimeTributario]}</Badge>
                {e.porte && <Badge variant="muted">{PORTES[e.porte]}</Badge>}
              </span>
              {(itens[i].status || itens[i].novos > 0 || itens[i].das) && (
                <span className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t pt-3 text-xs">
                  {itens[i].status && <Badge variant={STATUS_CICLO[itens[i].status].badge}>{STATUS_CICLO[itens[i].status].rotulo}</Badge>}
                  {itens[i].novos > 0 && (
                    <span className="flex items-center gap-1 font-medium text-info">
                      <Inbox className="size-3.5" />
                      {itens[i].novos} {itens[i].novos === 1 ? "documento novo" : "documentos novos"}
                    </span>
                  )}
                  {itens[i].das && (
                    <span className={DAS_COR[itens[i].das.tipo]}>
                      {itens[i].das.tipo === "pago" ? "DAS pago" : `DAS ${textoSituacaoDas(itens[i].das).toLowerCase()}`}
                    </span>
                  )}
                </span>
              )}
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
          </Link>
        ))}
      </div>
    </>
  );
}

export default function Home() {
  return (
    <div className="flex min-h-svh flex-1 flex-col">
      <header className="border-b bg-card">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
          <Link href="/">
            <LogoWordmark />
          </Link>
          <Suspense>
            <Usuario />
          </Suspense>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <PageHeader
          title="Empresas"
          description="Escolha a empresa para trabalhar. Cada uma tem seu plano de contas, bancos e lançamentos."
          actions={<NovaEmpresaDialog />}
        />
        <Suspense fallback={<Carregando />}>
          <ListaEmpresas />
        </Suspense>
      </main>
    </div>
  );
}
