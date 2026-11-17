import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { LogoWordmark } from "@/components/logo";

/** Moldura simples das páginas de recuperação de senha. */
export function Casca({ titulo, descricao, children }: { titulo: string; descricao: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-svh flex-1 items-center justify-center bg-muted/60 p-6">
      <div className="w-full max-w-sm">
        <LogoWordmark size={36} className="mb-8 text-lg" />
        <div className="rounded-xl border bg-card p-8 shadow-card">
          <h1 className="font-display text-[1.625rem] leading-tight font-semibold tracking-[-0.02em]">{titulo}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{descricao}</p>
          <div className="mt-6">{children}</div>
        </div>
        <Link href="/login" className="mt-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />
          Voltar para o login
        </Link>
      </div>
    </main>
  );
}
