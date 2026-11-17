import { Suspense } from "react";
import { connection } from "next/server";
import { and, count, eq, isNotNull } from "drizzle-orm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/db";
import { membros } from "@/db/schema";
import { emailConfigurado } from "@/lib/email";
import { hoje } from "@/lib/format";
import { getEmpresa } from "../empresa";
import { AvisosForm } from "./avisos-form";

async function Conteudo({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const empresa = await getEmpresa(id);
  const [{ ativos }] = await db
    .select({ ativos: count() })
    .from(membros)
    .where(and(eq(membros.empresaId, id), isNotNull(membros.userId), isNotNull(membros.aceitoEm)));
  return (
    <AvisosForm
      empresaId={id}
      config={{
        avisosAtivos: empresa.avisosAtivos,
        diaPedidoExtrato: empresa.diaPedidoExtrato,
        lembretesExtratoDias: empresa.lembretesExtratoDias,
        lembretesDasAposEnvio: empresa.lembretesDasAposEnvio,
        diasAntesVencimentoDas: empresa.diasAntesVencimentoDas,
      }}
      hoje={hoje()}
      emailOk={emailConfigurado()}
      clientesAtivos={ativos}
    />
  );
}

export function AvisosCard({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Card id="avisos" className="mt-6 scroll-mt-6">
      <CardHeader className="border-b">
        <CardTitle>Avisos ao cliente</CardTitle>
        <CardDescription>E-mails que o sistema manda sozinho para o cliente: pede os extratos todo mês, lembra quem esqueceu e lembra das guias até serem pagas.</CardDescription>
      </CardHeader>
      <CardContent>
        <Suspense fallback={<div className="h-72 animate-pulse rounded-xl bg-muted" aria-busy="true" aria-label="Carregando" />}>
          <Conteudo params={params} />
        </Suspense>
      </CardContent>
    </Card>
  );
}
