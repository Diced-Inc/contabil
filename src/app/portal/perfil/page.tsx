import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PerfilCard } from "@/app/e/[id]/configuracoes/perfil-card";
import { SenhaCard } from "@/app/e/[id]/configuracoes/senha-card";
import { papelDe, perfilDoUsuario, requireSessao, requireUser } from "@/supabase/server";
import { Rodape, Topo } from "../topo";

async function Barra() {
  await connection();
  const user = await requireSessao();
  if ((await papelDe(user.id, user.email)) === null) await requireUser(); // sem papel sai
  const perfil = await perfilDoUsuario(user);
  return <Topo usuario={{ ...perfil, email: user.email ?? "" }} />;
}

export default function PerfilPage() {
  return (
    <>
      <Suspense fallback={<div className="h-16 border-b bg-card" />}>
        <Barra />
      </Suspense>
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
        <Link href="/portal" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />
          Voltar
        </Link>
        <PageHeader title="Meu perfil" description="Sua foto, nome de exibição e senha de acesso." />
        <PerfilCard className="mt-0" />
        <SenhaCard />
      </main>
      <Rodape />
    </>
  );
}
