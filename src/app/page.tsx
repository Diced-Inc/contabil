import { Suspense } from "react";
import Link from "next/link";
import { asc } from "drizzle-orm";
import { Building2 } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NovaEmpresaDialog } from "@/components/empresa-form";
import { db } from "@/db";
import { empresas } from "@/db/schema";
import { fmtCnpj, REGIMES } from "@/lib/format";
import { requireUser } from "@/supabase/server";

async function ListaEmpresas() {
  await requireUser();
  const lista = await db.select().from(empresas).orderBy(asc(empresas.razaoSocial));
  if (lista.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma empresa cadastrada. Crie a primeira em &quot;Nova empresa&quot;.</p>;
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {lista.map((e) => (
        <Link key={e.id} href={`/e/${e.id}`} className="rounded-xl transition-shadow hover:shadow-md">
          <Card className="h-full">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="size-4 text-muted-foreground" />
                {e.razaoSocial}
              </CardTitle>
              <CardDescription>
                {fmtCnpj(e.cnpj)} · {REGIMES[e.regimeTributario]}
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
      ))}
    </div>
  );
}

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Empresas</h1>
        <NovaEmpresaDialog />
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Carregando...</p>}>
        <ListaEmpresas />
      </Suspense>
    </main>
  );
}
