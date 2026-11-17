import { Suspense } from "react";
import { connection } from "next/server";
import { and, count, eq, isNull } from "drizzle-orm";
import { AppSidebar } from "@/components/app-sidebar";
import { db } from "@/db";
import { contasBancarias, documentosRecebidos, transacoesBancarias } from "@/db/schema";
import { logoDaEmpresa, perfilDoUsuario, requireUser } from "@/supabase/server";
import { getEmpresa } from "./empresa";

async function Shell({ params, children }: LayoutProps<"/e/[id]">) {
  await connection();
  const user = await requireUser();
  const { id } = await params;
  const [empresa, perfil] = await Promise.all([getEmpresa(id), perfilDoUsuario(user)]);
  const logoUrl = await logoDaEmpresa(empresa);
  const [[{ pendentes }], [{ documentosNovos }]] = await Promise.all([
    db
      .select({ pendentes: count() })
      .from(transacoesBancarias)
      .innerJoin(contasBancarias, eq(transacoesBancarias.contaBancariaId, contasBancarias.id))
      .where(and(eq(contasBancarias.empresaId, id), eq(transacoesBancarias.status, "pendente"))),
    db
      .select({ documentosNovos: count() })
      .from(documentosRecebidos)
      .where(and(eq(documentosRecebidos.empresaId, id), isNull(documentosRecebidos.processadoEm))),
  ]);

  return (
    <div className="flex min-h-svh flex-1 flex-col lg:flex-row">
      <AppSidebar empresaId={id} empresaNome={empresa.razaoSocial} logoUrl={logoUrl} pendentes={pendentes} documentosNovos={documentosNovos} email={user.email ?? ""} {...perfil} />
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:py-7 xl:px-8">
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
