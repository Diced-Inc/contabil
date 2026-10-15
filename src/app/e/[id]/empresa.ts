import { cache } from "react";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { empresas } from "@/db/schema";

/** Carrega a empresa da rota ou responde 404. Deduplicado por request. */
export const getEmpresa = cache(async (id: string) => {
  if (!z.uuid().safeParse(id).success) notFound();
  const [empresa] = await db.select().from(empresas).where(eq(empresas.id, id));
  if (!empresa) notFound();
  return empresa;
});
