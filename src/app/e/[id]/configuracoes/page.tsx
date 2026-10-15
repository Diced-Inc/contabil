import { Suspense } from "react";
import { connection } from "next/server";
import { atualizarEmpresa } from "@/actions/empresas";
import { EmpresaForm } from "@/components/empresa-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { getEmpresa } from "../empresa";

async function Form({ params }: Pick<PageProps<"/e/[id]/configuracoes">, "params">) {
  await connection();
  const { id } = await params;
  const empresa = await getEmpresa(id);
  return <EmpresaForm action={atualizarEmpresa.bind(null, id)} empresa={empresa} rotulo="Salvar" />;
}

export default function ConfiguracoesPage({ params }: PageProps<"/e/[id]/configuracoes">) {
  return (
    <div className="max-w-2xl">
      <PageHeader title="Configurações" description="Dados cadastrais usados nos cabeçalhos dos relatórios." />
      <Card>
        <CardHeader className="border-b">
          <CardTitle>Dados da empresa</CardTitle>
          <CardDescription>Razão social, CNPJ e regime tributário.</CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<p className="text-sm text-muted-foreground">Carregando...</p>}>
            <Form params={params} />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
