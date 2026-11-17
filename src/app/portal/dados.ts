import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { empresas, membros } from "@/db/schema";
import { requireMembro } from "@/supabase/server";

/** Empresa do portal: exige contador ou membro dela. */
export async function getEmpresaPortal(empresaId: string) {
  const { user, papel } = await requireMembro(empresaId);
  const [empresa] = await db.select().from(empresas).where(eq(empresas.id, empresaId));
  if (!empresa) notFound();
  return { user, papel, empresa };
}

export function empresasDoCliente(userId: string) {
  return db
    .select({ id: empresas.id, razaoSocial: empresas.razaoSocial, cnpj: empresas.cnpj, logoPath: empresas.logoPath })
    .from(membros)
    .innerJoin(empresas, eq(empresas.id, membros.empresaId))
    .where(eq(membros.userId, userId))
    .orderBy(asc(empresas.razaoSocial));
}

/** Avatar do menu no portal: para o cliente, o logo da empresa (quando há); senão a foto dele (ou a inicial). */
export function avatarDoCliente(papel: string | null, logoUrl: string | null, fotoUrl: string | null) {
  const logo = papel === "cliente" && !!logoUrl;
  return { avatarUrl: logo ? logoUrl : fotoUrl, avatarLogo: logo };
}
