import { Suspense } from "react";
import { connection } from "next/server";
import { and, count, eq } from "drizzle-orm";
import { AppSidebar } from "@/components/app-sidebar";
import { db } from "@/db";
import { contasBancarias, transacoesBancarias } from "@/db/schema";
import { requireUser } from "@/supabase/server";
import { getEmpresa } from "./empresa";

async function Shell({ params, children }: LayoutProps<"/e/[id]">) {
  await connection();
  const user = await requireUser();
  const { id } = await params;
  const empresa = await getEmpresa(id);
  const [{ pendentes }] = await db
    .select({ pendentes: count() })
    .from(transacoesBancarias)
    .innerJoin(contasBancarias, eq(transacoesBancarias.contaBancariaId, contasBancarias.id))
    .where(and(eq(contasBancarias.empresaId, id), eq(transacoesBancarias.status, "pendente")));

  return (
    <div className="flex min-h-svh flex-1">
      <AppSidebar empresaId={id} empresaNome={empresa.razaoSocial} pendentes={pendentes} email={user.email ?? ""} />
      <main className="min-w-0 flex-1 px-6 py-7 xl:px-8">
        <div className="mx-auto w-full max-w-[1280px]">{children}</div>
      </main>
    </div>
  );
}

export default function EmpresaLayout(props: LayoutProps<"/e/[id]">) {
  return (
    <Suspense fallback={<div className="min-h-svh flex-1 bg-background" />}>
      <Shell {...props} />
    </Suspense>
  );
}
