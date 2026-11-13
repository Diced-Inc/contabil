import { Suspense } from "react";
import { connection } from "next/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { perfilDoUsuario, requireSessao } from "@/supabase/server";
import { PerfilForm } from "./perfil-form";

async function Conteudo() {
  await connection();
  const user = await requireSessao();
  const { nome, avatarUrl } = await perfilDoUsuario(user);
  return <PerfilForm nome={nome} email={user.email ?? ""} avatarUrl={avatarUrl} />;
}

export function PerfilCard({ className = "mt-6" }: { className?: string }) {
  return (
    <Card className={className}>
      <CardHeader className="border-b">
        <CardTitle>Seu perfil</CardTitle>
        <CardDescription>Foto e nome exibidos no sistema.</CardDescription>
      </CardHeader>
      <CardContent>
        <Suspense fallback={<p className="text-sm text-muted-foreground">Carregando...</p>}>
          <Conteudo />
        </Suspense>
      </CardContent>
    </Card>
  );
}
