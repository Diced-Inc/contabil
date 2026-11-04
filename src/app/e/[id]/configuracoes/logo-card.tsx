import { Suspense } from "react";
import { connection } from "next/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { logoDaEmpresa } from "@/supabase/server";
import { getEmpresa } from "../empresa";
import { LogoForm } from "./logo-form";

async function Conteudo({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const empresa = await getEmpresa(id);
  return <LogoForm empresaId={id} razaoSocial={empresa.razaoSocial} logoUrl={await logoDaEmpresa(empresa)} />;
}

export function LogoCard({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Card className="mt-6">
      <CardHeader className="border-b">
        <CardTitle>Logo da empresa</CardTitle>
        <CardDescription>Exibido na barra lateral, na lista de empresas e no cabeçalho dos relatórios.</CardDescription>
      </CardHeader>
      <CardContent>
        <Suspense fallback={<p className="text-sm text-muted-foreground">Carregando...</p>}>
          <Conteudo params={params} />
        </Suspense>
      </CardContent>
    </Card>
  );
}
