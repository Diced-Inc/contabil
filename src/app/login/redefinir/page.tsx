import { Suspense } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { createClient } from "@/supabase/server";
import { Casca } from "../casca";
import { COOKIE_RECUPERACAO } from "../recuperacao";
import { Erro, RedefinirForm } from "../senha-forms";

async function Conteudo({ searchParams }: Pick<PageProps<"/login/redefinir">, "searchParams">) {
  await connection();
  const convite = (await searchParams).convite === "1";
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const valido = !!data.user && (await cookies()).has(COOKIE_RECUPERACAO);
  return (
    <Casca
      titulo={convite ? "Defina sua senha" : "Nova senha"}
      descricao={
        convite
          ? "Bem-vindo! Crie uma senha com pelo menos 8 caracteres para acessar o portal."
          : "Escolha uma nova senha com pelo menos 8 caracteres."
      }
    >
      {valido ? (
        <RedefinirForm />
      ) : (
        <div className="grid gap-4">
          <Erro>Link inválido ou expirado.</Erro>
          <Link href="/login/recuperar" className="text-sm font-medium underline underline-offset-4">
            Pedir um novo link
          </Link>
        </div>
      )}
    </Casca>
  );
}

export default function RedefinirPage({ searchParams }: PageProps<"/login/redefinir">) {
  return (
    <Suspense
      fallback={
        <Casca titulo="Nova senha" descricao="Escolha uma nova senha com pelo menos 8 caracteres.">
          <p className="text-sm text-muted-foreground">Carregando...</p>
        </Casca>
      }
    >
      <Conteudo searchParams={searchParams} />
    </Suspense>
  );
}
