"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRight, BookOpen, FileText, Landmark, LayoutDashboard, ListChecks, ListTree,
  Lock, LogOut, Receipt, Settings, Wand2, type LucideIcon,
} from "lucide-react";
import { cn } from "cn";
import { sair } from "@/app/login/actions";
import { Badge } from "@/components/ui/badge";

const RELATORIOS = [
  ["balancete", "Balancete"],
  ["balanco", "Balanço"],
  ["dre", "DRE"],
  ["diario", "Diário"],
  ["razao", "Razão"],
] as const;

const NAV: [string, string, LucideIcon][] = [
  ["", "Resumo", LayoutDashboard],
  ["/conciliacao", "Conciliação", ListChecks],
  ["/bancos", "Bancos", Landmark],
  ["/lancamentos", "Lançamentos", BookOpen],
  ["/titulos", "Títulos", Receipt],
  ["/plano-de-contas", "Plano de contas", ListTree],
  ["/regras", "Regras", Wand2],
  ["/fechamento", "Fechamento", Lock],
];

const item = "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";
const ativo = "bg-sidebar-accent font-medium text-sidebar-accent-foreground";

export function AppSidebar({ empresaId, empresaNome, pendentes }: { empresaId: string; empresaNome: string; pendentes: number }) {
  const pathname = usePathname();
  const base = `/e/${empresaId}`;
  const isAtivo = (href: string) => (href === base ? pathname === base : pathname.startsWith(href));

  return (
    <aside className="sticky top-0 flex h-svh w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="border-b p-3">
        <p className="truncate text-sm font-semibold" title={empresaNome}>{empresaNome}</p>
        <Link href="/" className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeftRight className="size-3" />
          Trocar empresa
        </Link>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {NAV.map(([path, label, Icon]) => {
          const href = base + path;
          return (
            <Link key={href} href={href} className={cn(item, isAtivo(href) && ativo)}>
              <Icon className="size-4" />
              <span className="flex-1">{label}</span>
              {path === "/conciliacao" && pendentes > 0 && <Badge>{pendentes}</Badge>}
            </Link>
          );
        })}
        <details open>
          <summary className={cn(item, "cursor-pointer list-none")}>
            <FileText className="size-4" />
            Relatórios
          </summary>
          <div className="ml-6 space-y-0.5 border-l pl-2">
            {RELATORIOS.map(([slug, label]) => {
              const href = `${base}/relatorios/${slug}`;
              return (
                <Link key={slug} href={href} className={cn(item, "py-1", isAtivo(href) && ativo)}>
                  {label}
                </Link>
              );
            })}
          </div>
        </details>
        <Link href={`${base}/configuracoes`} className={cn(item, isAtivo(`${base}/configuracoes`) && ativo)}>
          <Settings className="size-4" />
          Configurações
        </Link>
      </nav>
      <form action={sair} className="border-t p-2">
        <button type="submit" className={cn(item, "w-full")}>
          <LogOut className="size-4" />
          Sair
        </button>
      </form>
    </aside>
  );
}
