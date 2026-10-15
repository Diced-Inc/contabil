"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen, Building2, Calculator, ChevronDown, ChevronsUpDown, FileText, Landmark, LayoutDashboard, ListChecks,
  ListTree, Lock, LogOut, Receipt, Settings, Wand2, type LucideIcon,
} from "lucide-react";
import { cn } from "cn";
import { sair } from "@/app/login/actions";

const RELATORIOS = [
  ["balancete", "Balancete"],
  ["balanco", "Balanço patrimonial"],
  ["dre", "DRE"],
  ["diario", "Livro diário"],
  ["razao", "Razão"],
] as const;

type Item = [string, string, LucideIcon];
const OPERACAO: Item[] = [
  ["", "Resumo", LayoutDashboard],
  ["/conciliacao", "Conciliação", ListChecks],
  ["/bancos", "Bancos", Landmark],
  ["/lancamentos", "Lançamentos", BookOpen],
  ["/titulos", "Títulos", Receipt],
  ["/fechamento", "Fechamento", Lock],
];
const CADASTROS: Item[] = [
  ["/plano-de-contas", "Plano de contas", ListTree],
  ["/regras", "Regras", Wand2],
  ["/configuracoes", "Configurações", Settings],
];

const item =
  "group relative flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";
const ativo =
  "bg-accent font-medium text-accent-foreground hover:bg-accent hover:text-accent-foreground before:absolute before:inset-y-2 before:-left-3 before:w-[3px] before:rounded-r-full before:bg-primary";
const secao = "px-2.5 pt-5 pb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground/80 uppercase";

export function AppSidebar({ empresaId, empresaNome, pendentes, email }: {
  empresaId: string;
  empresaNome: string;
  pendentes: number;
  email: string;
}) {
  const pathname = usePathname();
  const base = `/e/${empresaId}`;
  const isAtivo = (href: string) => (href === base ? pathname === base : pathname.startsWith(href));
  const emRelatorio = pathname.startsWith(`${base}/relatorios`);
  const [aberto, setAberto] = useState(emRelatorio);
  const [emRelatorioAntes, setEmRelatorioAntes] = useState(emRelatorio);
  if (emRelatorio !== emRelatorioAntes) {
    setEmRelatorioAntes(emRelatorio);
    if (emRelatorio) setAberto(true);
  }

  const link = ([path, label, Icon]: Item) => {
    const href = base + path;
    const on = isAtivo(href);
    return (
      <Link key={href} href={href} aria-current={on ? "page" : undefined} className={cn(item, on && ativo)}>
        <Icon className={cn("size-4 shrink-0 text-muted-foreground group-hover:text-foreground", on && "text-primary group-hover:text-primary")} />
        <span className="flex-1 truncate">{label}</span>
        {path === "/conciliacao" && pendentes > 0 && (
          <span className="rounded-full bg-warning-soft px-1.5 py-px text-[11px] font-semibold text-warning ring-1 ring-warning/25 ring-inset tabular-nums">
            {pendentes}
          </span>
        )}
      </Link>
    );
  };

  return (
    <aside className="sticky top-0 flex h-svh w-56 shrink-0 xl:w-64 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="px-4 pt-4 pb-3">
        <Link href="/" className="flex items-center gap-2.5 px-1">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs">
            <Calculator className="size-4" />
          </span>
          <span className="text-[17px] font-semibold tracking-tight text-foreground">Contábil</span>
        </Link>
        <Link
          href="/"
          title={`${empresaNome}. Trocar empresa`}
          className="mt-4 flex items-center gap-2.5 rounded-lg border bg-card px-2.5 py-2 shadow-xs transition-colors hover:bg-muted"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Building2 className="size-4" />
          </span>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="line-clamp-2 text-sm font-medium break-words text-foreground">{empresaNome}</span>
            <span className="block text-xs text-muted-foreground">Trocar empresa</span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        <p className={cn(secao, "pt-2")}>Operação</p>
        <div className="space-y-0.5">{OPERACAO.map(link)}</div>

        <button
          type="button"
          onClick={() => setAberto((a) => !a)}
          aria-expanded={aberto}
          className={cn(secao, "flex w-full cursor-pointer items-center justify-between rounded-md hover:text-foreground")}
        >
          Relatórios
          <ChevronDown className={cn("size-3.5 transition-transform", !aberto && "-rotate-90")} />
        </button>
        {aberto && (
          <div className="space-y-0.5">
            {RELATORIOS.map(([slug, label]) => link([`/relatorios/${slug}`, label, FileText]))}
          </div>
        )}

        <p className={secao}>Cadastros</p>
        <div className="space-y-0.5">{CADASTROS.map(link)}</div>
      </nav>

      <div className="flex items-center gap-2.5 border-t px-4 py-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground uppercase">
          {email.slice(0, 1)}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-foreground" title={email}>{email}</span>
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
    </aside>
  );
}
