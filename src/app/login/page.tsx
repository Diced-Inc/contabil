import { Suspense } from "react";
import { CircleAlert, LogIn } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Entrar</CardTitle>
          <CardDescription>Acesse com seu e-mail e senha.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={entrar} className="grid gap-4">
            <Suspense>
              <Erro searchParams={searchParams} />
            </Suspense>
            <div className="grid gap-2">
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="senha">Senha</Label>
              <Input id="senha" name="senha" type="password" autoComplete="current-password" required />
            </div>
            <Button type="submit" className="w-full">
              <LogIn />
              Entrar
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
