import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PerfilCard } from "@/app/e/[id]/configuracoes/perfil-card";
import { SenhaCard } from "@/app/e/[id]/configuracoes/senha-card";
import { logoDaEmpresa, papelDe, perfilDoUsuario, requireSessao, requireUser } from "@/supabase/server";
import { avatarDoCliente, empresasDoCliente } from "../dados";
import { Rodape, Topo } from "../topo";

async function Barra() {
  await connection();
  const user = await requireSessao();
  const papel = await papelDe(user.id, user.email);
  if (papel === null) await requireUser(); // sem papel sai
  const [perfil, logo] = await Promise.all([
    perfilDoUsuario(user),
    papel === "cliente" ? empresasDoCliente(user.id).then((l) => logoDaEmpresa(l.find((e) => e.logoPath) ?? { logoPath: null })) : null,
  ]);
  return <Topo usuario={{ ...perfil, email: user.email ?? "", ...avatarDoCliente(papel, logo, perfil.avatarUrl) }} />;
}

export default function PerfilPage() {
  return (
    <>
      <Suspense fallback={<div className="h-16 border-b bg-card" />}>
        <Barra />
      </Suspense>
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
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
