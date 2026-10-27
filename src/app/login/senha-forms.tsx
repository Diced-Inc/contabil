"use client";

import { useActionState } from "react";
import { CircleAlert, KeyRound, MailCheck, Send } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { enviarRecuperacao, redefinirSenha, type Resultado } from "./actions";

export function Erro({ children }: { children?: string }) {
  if (!children) return null;
  return (
    <Alert variant="destructive">
      <CircleAlert />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

/** Campos "Nova senha" + "Confirmar", usados aqui e no card de Configurações. */
export function CamposNovaSenha() {
  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor="nova">Nova senha</Label>
        <Input id="nova" name="nova" type="password" autoComplete="new-password" minLength={8} required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="confirmar">Confirmar</Label>
        <Input id="confirmar" name="confirmar" type="password" autoComplete="new-password" minLength={8} required />
      </div>
    </>
  );
}

export function RecuperarForm({ erroInicial }: { erroInicial?: string }) {
  const [estado, enviar, pendente] = useActionState<Resultado, FormData>(enviarRecuperacao, {});
  if (estado.ok) {
    return (
      <Alert>
        <MailCheck />
        <AlertDescription>Se o e-mail existir, enviamos um link.</AlertDescription>
      </Alert>
    );
  }
  return (
    <form action={enviar} className="grid gap-5">
      <Erro>{erroInicial}</Erro>
      <div className="grid gap-2">
        <Label htmlFor="email">E-mail</Label>
        <Input id="email" name="email" type="email" autoComplete="email" placeholder="voce@empresa.com.br" required />
      </div>
      <Button type="submit" size="lg" className="w-full" disabled={pendente}>
        <Send />
        Enviar link
      </Button>
    </form>
  );
}

export function RedefinirForm() {
  const [estado, enviar, pendente] = useActionState<Resultado, FormData>(redefinirSenha, {});
  return (
    <form action={enviar} className="grid gap-5">
      <Erro>{estado.erro}</Erro>
      <CamposNovaSenha />
      <Button type="submit" size="lg" className="w-full" disabled={pendente}>
        <KeyRound />
        Salvar nova senha
      </Button>
    </form>
  );
}
