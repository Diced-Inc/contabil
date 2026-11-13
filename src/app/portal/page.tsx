import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Building2, ChevronRight } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { EmptyState, PageHeader } from "@/components/page-header";
import { fmtCnpj } from "@/lib/format";
import { logoDaEmpresa, papelDe, perfilDoUsuario, requireSessao, requireUser } from "@/supabase/server";
import { empresasDoCliente } from "./dados";
import { Rodape, Topo } from "./topo";

async function Conteudo() {
  await connection();
  const user = await requireSessao();
  const papel = await papelDe(user.id, user.email);
  if (papel !== "cliente") await requireUser(); // contador vai para "/", sem papel sai
  const lista = await empresasDoCliente(user.id);
  if (lista.length === 1) redirect(`/portal/${lista[0].id}`);
  const [perfil, logos] = await Promise.all([perfilDoUsuario(user), Promise.all(lista.map(logoDaEmpresa))]);

  return (
    <>
      <Topo usuario={{ ...perfil, email: user.email ?? "" }} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <PageHeader title="Suas empresas" description="Escolha a empresa para enviar documentos e acompanhar o mês." />
        {lista.length === 0 ? (
          <EmptyState icon={Building2} title="Nenhuma empresa liberada" hint="Seu acesso foi removido. Fale com seu contador." />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {lista.map((e, i) => (
              <Link
                key={e.id}
                href={`/portal/${e.id}`}
                className="group flex items-center gap-4 rounded-xl border bg-card p-5 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <Avatar url={logos[i]} texto={e.razaoSocial} className="size-12 rounded-xl text-base" />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 font-semibold leading-snug text-foreground">{e.razaoSocial}</span>
                  <span className="mt-0.5 block text-sm text-muted-foreground tabular-nums">CNPJ {fmtCnpj(e.cnpj)}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
              </Link>
            ))}
          </div>
        )}
      </main>
      <Rodape />
    </>
  );
}

export default function PortalPage() {
  return (
    <Suspense>
      <Conteudo />
    </Suspense>
  );
}
