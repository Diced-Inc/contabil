import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { LogoWordmark } from "@/components/logo";
import { MenuUsuario } from "./menu-usuario";

/** Barra do portal do cliente: marca, empresa atual (quando há) e menu da conta. */
export function Topo({ empresa, usuario }: {
  empresa?: { id: string; nome: string; logoUrl: string | null };
  usuario: { nome: string; email: string; avatarUrl: string | null; avatarLogo?: boolean };
}) {
  return (
    <header className="sticky top-0 z-30 border-b bg-card/90 backdrop-blur supports-backdrop-filter:bg-card/75">
      <div className="mx-auto flex h-16 w-full max-w-5xl items-center gap-4 px-6">
        <Link href="/portal" className="shrink-0">
          <LogoWordmark />
        </Link>
        {empresa && (
          <>
            <span aria-hidden className="hidden h-6 w-px bg-border sm:block" />
            <Link href={`/portal/${empresa.id}`} className="hidden min-w-0 items-center gap-2.5 sm:flex">
              <Avatar url={empresa.logoUrl} texto={empresa.nome} className="rounded-md" />
              <span className="truncate text-sm font-medium text-foreground">{empresa.nome}</span>
            </Link>
          </>
        )}
        <div className="ml-auto">
          <MenuUsuario {...usuario} />
        </div>
      </div>
    </header>
  );
}

export function Rodape() {
  return (
    <footer className="mx-auto w-full max-w-5xl px-6 pt-4 pb-8 text-xs text-muted-foreground">
      Portal do cliente · DB Contador. Dúvidas? Fale com seu contador.
    </footer>
  );
}
