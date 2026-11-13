import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { empresas, membros } from "@/db/schema";
import { requireMembro } from "@/supabase/server";

/** Empresa do portal: exige contador ou membro dela. */
export async function getEmpresaPortal(empresaId: string) {
  const { user } = await requireMembro(empresaId);
  const [empresa] = await db.select().from(empresas).where(eq(empresas.id, empresaId));
  if (!empresa) notFound();
  return { user, empresa };
}

export function empresasDoCliente(userId: string) {
  return db
    .select({ id: empresas.id, razaoSocial: empresas.razaoSocial, cnpj: empresas.cnpj, logoPath: empresas.logoPath })
    .from(membros)
    .innerJoin(empresas, eq(empresas.id, membros.empresaId))
    .where(eq(membros.userId, userId))
    .orderBy(asc(empresas.razaoSocial));
}
