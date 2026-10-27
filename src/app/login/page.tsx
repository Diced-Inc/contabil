import { Suspense } from "react";
import Link from "next/link";
import { BookOpenCheck, Calculator, CircleAlert, FileSpreadsheet, ListChecks, LogIn } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
      <section className="relative hidden overflow-hidden bg-primary p-12 text-primary-foreground lg:flex lg:flex-col lg:justify-between">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.08] [background-image:linear-gradient(to_right,white_1px,transparent_1px),linear-gradient(to_bottom,white_1px,transparent_1px)] [background-size:40px_40px]"
        />
        <div aria-hidden className="pointer-events-none absolute -right-32 -bottom-32 size-[28rem] rounded-full bg-white/10 blur-3xl" />
        <div className="relative flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/25">
            <Calculator className="size-5" />
          </span>
          <span className="text-xl font-semibold tracking-tight">Contábil</span>
        </div>
        <div className="relative max-w-md">
          <h2 className="text-3xl leading-tight font-semibold tracking-tight">
            A contabilidade da sua empresa, do extrato ao balanço.
          </h2>
          <ul className="mt-8 space-y-5">
            {DESTAQUES.map(([Icon, titulo, texto]) => (
              <li key={titulo} className="flex gap-3.5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/12 ring-1 ring-white/20">
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
        <p className="relative text-xs text-white/60">Acesso restrito a usuários autorizados.</p>
      </section>

      <section className="flex items-center justify-center bg-muted/60 p-6 lg:bg-background">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Calculator className="size-5" />
            </span>
            <span className="text-xl font-semibold tracking-tight">Contábil</span>
          </div>
          <div className="rounded-2xl border bg-card p-8 shadow-card">
            <h1 className="text-2xl font-semibold tracking-tight">Entrar</h1>
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
