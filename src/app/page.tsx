import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { asc } from "drizzle-orm";
import { Building2, Calculator, ChevronRight, LogOut } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { NovaEmpresaDialog } from "@/components/empresa-form";
import { Carregando, EmptyState, PageHeader } from "@/components/page-header";
import { db } from "@/db";
import { empresas } from "@/db/schema";
import { fmtCnpj, PORTES, REGIMES } from "@/lib/format";
import { requireUser } from "@/supabase/server";
import { sair } from "./login/actions";

const REGIME_BADGE = { simples: "brand", mei: "success", presumido: "info", real: "violet" } as const;

function iniciais(nome: string) {
  const p = nome.split(/\s+/).filter((w) => w.length > 2);
  return ((p[0]?.[0] ?? nome[0] ?? "?") + (p[1]?.[0] ?? "")).toUpperCase();
}

async function Usuario() {
  await connection();
  const user = await requireUser();
  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-sm text-muted-foreground sm:inline">{user.email}</span>
      <span className="flex size-8 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground uppercase">
        {user.email?.slice(0, 1)}
      </span>
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

async function ListaEmpresas() {
  await connection();
  await requireUser();
  const lista = await db.select().from(empresas).orderBy(asc(empresas.razaoSocial));
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
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {lista.map((e) => (
        <Link
          key={e.id}
          href={`/e/${e.id}`}
          className="group flex items-center gap-4 rounded-xl border bg-card p-5 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent text-base font-semibold text-accent-foreground">
            {iniciais(e.razaoSocial)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="line-clamp-2 font-semibold leading-snug text-foreground">{e.razaoSocial}</span>
            <span className="mt-0.5 block text-sm text-muted-foreground tabular-nums">CNPJ {fmtCnpj(e.cnpj)}</span>
            <span className="mt-2 flex flex-wrap gap-1.5">
              <Badge variant={REGIME_BADGE[e.regimeTributario]}>{REGIMES[e.regimeTributario]}</Badge>
              {e.porte && <Badge variant="muted">{PORTES[e.porte]}</Badge>}
            </span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
        </Link>
      ))}
    </div>
  );
}

export default function Home() {
  return (
    <div className="flex min-h-svh flex-1 flex-col">
      <header className="border-b bg-card">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs">
              <Calculator className="size-4" />
            </span>
            <span className="text-[17px] font-semibold tracking-tight">Contábil</span>
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
