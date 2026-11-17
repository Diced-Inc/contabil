import { Suspense } from "react";
import Link from "next/link";
import { BookOpenCheck, CircleAlert, FileSpreadsheet, ListChecks, LogIn } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogoWordmark } from "@/components/logo";
import { entrar } from "./actions";

async function Erro({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const { erro } = await searchParams;
  if (typeof erro !== "string") return null;
  return (
    <Alert variant="destructive">
      <CircleAlert />
      <AlertDescription>{erro}</AlertDescription>
    </Alert>
  );
}

const DESTAQUES = [
  [ListChecks, "Conciliação bancária", "Importe o OFX e classifique com regras e IA."],
  [BookOpenCheck, "Partidas dobradas", "Lançamentos auditáveis, com estorno e histórico."],
  [FileSpreadsheet, "Relatórios contábeis", "Balancete, balanço, DRE, diário e razão."],
] as const;

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="grid min-h-svh flex-1 lg:grid-cols-[1.05fr_1fr]">
      <section className="hidden bg-primary p-12 text-primary-foreground lg:flex lg:flex-col lg:justify-between">
        <LogoWordmark size={36} inverso className="text-lg" />
        <div className="max-w-md">
          <h2 className="font-display text-[2rem] leading-tight font-semibold tracking-[-0.02em]">
            A contabilidade da sua empresa, do extrato ao balanço.
          </h2>
          <ul className="mt-8 space-y-5">
            {DESTAQUES.map(([Icon, titulo, texto]) => (
              <li key={titulo} className="flex gap-3.5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-white/10 ring-1 ring-white/25">
                  <Icon className="size-4" />
                </span>
                <span>
                  <span className="block font-medium">{titulo}</span>
                  <span className="block text-sm text-white/75">{texto}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-white/65">Acesso restrito a usuários autorizados.</p>
      </section>

      <section className="flex items-center justify-center bg-muted/60 p-6 lg:bg-background">
        <div className="w-full max-w-sm">
          <LogoWordmark size={36} className="mb-8 text-lg lg:hidden" />
          <div className="rounded-xl border bg-card p-8 shadow-card">
            <h1 className="font-display text-[1.625rem] leading-tight font-semibold tracking-[-0.02em]">Entrar</h1>
            <p className="mt-1 text-sm text-muted-foreground">Acesse com seu e-mail e senha.</p>
            <form action={entrar} className="mt-6 grid gap-5">
              <Suspense>
                <Erro searchParams={searchParams} />
              </Suspense>
              <div className="grid gap-2">
                <Label htmlFor="email">E-mail</Label>
                <Input id="email" name="email" type="email" autoComplete="email" placeholder="voce@empresa.com.br" required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="senha">Senha</Label>
                <Input id="senha" name="senha" type="password" autoComplete="current-password" required />
              </div>
              <Button type="submit" size="lg" className="mt-1 w-full">
                <LogIn />
                Entrar
              </Button>
            </form>
            <Link href="/login/recuperar" className="mt-4 block text-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
              Esqueci minha senha
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
