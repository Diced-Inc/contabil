import { cache } from "react";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { empresas } from "@/db/schema";
import { requireUser } from "@/supabase/server";

/**
 * Carrega a empresa da rota ou responde 404. Deduplicado por request.
 * Exige contador: toda página de /e/[id] passa por aqui, e o layout não roda de novo em navegação no cliente.
 */
export const getEmpresa = cache(async (id: string) => {
  await requireUser();
  if (!z.uuid().safeParse(id).success) notFound();
  const [empresa] = await db.select().from(empresas).where(eq(empresas.id, id));
  if (!empresa) notFound();
  return empresa;
});
