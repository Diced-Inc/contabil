import { Suspense } from "react";
import { connection } from "next/server";
import { atualizarEmpresa } from "@/actions/empresas";
import { EmpresaForm } from "@/components/empresa-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getEmpresa } from "../empresa";

async function Form({ params }: Pick<PageProps<"/e/[id]/configuracoes">, "params">) {
  await connection();
  const { id } = await params;
  const empresa = await getEmpresa(id);
  return <EmpresaForm action={atualizarEmpresa.bind(null, id)} empresa={empresa} rotulo="Salvar" />;
}

export default function ConfiguracoesPage({ params }: PageProps<"/e/[id]/configuracoes">) {
  return (
    <div className="max-w-lg">
      <h1 className="mb-6 text-2xl font-semibold">Configurações</h1>
      <Card>
        <CardHeader>
          <CardTitle>Dados da empresa</CardTitle>
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
