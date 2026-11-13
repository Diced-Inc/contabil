import { Suspense } from "react";
import { connection } from "next/server";
import { atualizarEmpresa } from "@/actions/empresas";
import { EmpresaForm } from "@/components/empresa-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { getEmpresa } from "../empresa";
import { AvisosCard } from "./avisos-card";
import { LogoCard } from "./logo-card";
import { PerfilCard } from "./perfil-card";
import { SenhaCard } from "./senha-card";

async function Form({ params }: Pick<PageProps<"/e/[id]/configuracoes">, "params">) {
  await connection();
  const { id } = await params;
  const empresa = await getEmpresa(id);
  return <EmpresaForm action={atualizarEmpresa.bind(null, id)} empresa={empresa} rotulo="Salvar" />;
}

export default function ConfiguracoesPage({ params }: PageProps<"/e/[id]/configuracoes">) {
  return (
    <div className="max-w-2xl">
      <PageHeader title="Configurações" description="Dados da empresa, logo, avisos ao cliente e a sua conta." />
      <Card id="dados" className="scroll-mt-6">
        <CardHeader className="border-b">
          <CardTitle>Dados da empresa</CardTitle>
          <CardDescription>Identificação, endereço, responsável legal e contador. Os nomes aparecem nas assinaturas dos relatórios e o nome da empresa nos e-mails ao cliente.</CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-muted" aria-busy="true" aria-label="Carregando" />}>
            <Form params={params} />
          </Suspense>
        </CardContent>
      </Card>
      <LogoCard params={params} />
      <AvisosCard params={params} />
      <PerfilCard />
      <SenhaCard />
    </div>
  );
}
