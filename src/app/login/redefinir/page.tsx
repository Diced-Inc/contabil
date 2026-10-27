import { Suspense } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { createClient } from "@/supabase/server";
import { Casca } from "../casca";
import { COOKIE_RECUPERACAO } from "../recuperacao";
import { Erro, RedefinirForm } from "../senha-forms";

async function Conteudo() {
  await connection();
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user || !(await cookies()).has(COOKIE_RECUPERACAO)) {
    return (
      <div className="grid gap-4">
        <Erro>Link inválido ou expirado.</Erro>
        <Link href="/login/recuperar" className="text-sm font-medium underline underline-offset-4">
          Pedir um novo link
        </Link>
      </div>
    );
  }
  return <RedefinirForm />;
}

export default function RedefinirPage() {
  return (
    <Casca titulo="Nova senha" descricao="Escolha uma nova senha com pelo menos 8 caracteres.">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Carregando...</p>}>
        <Conteudo />
      </Suspense>
    </Casca>
  );
}
