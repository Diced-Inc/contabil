import { Suspense, type ReactNode } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { LogOut } from "lucide-react";
import { sair } from "@/app/login/actions";
import { Avatar } from "@/components/avatar";
import { LogoWordmark } from "@/components/logo";
import { perfilDoUsuario, requireUser } from "@/supabase/server";

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

/** Barra do topo das telas do contador fora de uma empresa: logo, ações extras e usuário. */
export function Topo({ children }: { children?: ReactNode }) {
  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-6">
        <Link href="/">
          <LogoWordmark />
        </Link>
        <div className="flex items-center gap-3">
          {children}
          <Suspense>
            <Usuario />
          </Suspense>
        </div>
      </div>
    </header>
  );
}
