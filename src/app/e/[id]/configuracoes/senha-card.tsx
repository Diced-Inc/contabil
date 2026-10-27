"use client";

import { useActionState, useEffect } from "react";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";
import { trocarSenha, type Resultado } from "@/app/login/actions";
import { CamposNovaSenha, Erro } from "@/app/login/senha-forms";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SenhaCard() {
  const [estado, enviar, pendente] = useActionState<Resultado, FormData>(trocarSenha, {});
  useEffect(() => {
    if (!estado.ok) return;
    toast.success("Senha alterada.");
  }, [estado]);

  return (
    <Card className="mt-6">
      <CardHeader className="border-b">
        <CardTitle>Senha</CardTitle>
        <CardDescription>Troque a senha de acesso ao sistema.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={enviar} className="grid gap-5">
          <Erro>{estado.erro}</Erro>
          <div className="grid gap-2">
            <Label htmlFor="atual">Senha atual</Label>
            <Input id="atual" name="atual" type="password" autoComplete="current-password" required />
          </div>
          <CamposNovaSenha />
          <div>
            <Button type="submit" disabled={pendente}>
              <KeyRound />
              Trocar senha
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
