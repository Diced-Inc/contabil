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
    <Card className="mt-6">
      <CardHeader className="border-b">
        <CardTitle>Avisos ao cliente</CardTitle>
        <CardDescription>E-mails automáticos todo dia às 8h: pedido dos extratos do mês, lembretes e vencimento do DAS.</CardDescription>
      </CardHeader>
      <CardContent>
        <Suspense fallback={<p className="text-sm text-muted-foreground">Carregando...</p>}>
          <Conteudo params={params} />
        </Suspense>
      </CardContent>
    </Card>
  );
}
