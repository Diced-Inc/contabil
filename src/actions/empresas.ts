"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import sharp from "sharp";
import { z } from "zod";
import { db } from "@/db";
import { empresas, porteEnum, regimeEnum } from "@/db/schema";
import { seedPlano } from "@/db/seed-plano";
import { somenteDigitos } from "@/lib/format";
import { createClient, requireUser } from "@/supabase/server";

export type EstadoForm = { erro?: string; ok?: boolean };

/** Campo opcional: vazio vira null; senão aplica o schema ao texto aparado. */
function opcional<T extends z.ZodType<string, string>>(schema: T) {
  return z.string().trim().transform((v) => v || null).pipe(z.union([z.null(), schema]));
}
const cpf = (msg: string) => opcional(z.string().transform(somenteDigitos).pipe(z.string().length(11, msg)));

const empresaSchema = z.object({
  razaoSocial: z.string().trim().min(2, "Razão social deve ter ao menos 2 caracteres."),
  cnpj: z.string().transform(somenteDigitos).pipe(z.string().length(14, "CNPJ deve ter 14 dígitos.")),
  regimeTributario: z.enum(regimeEnum.enumValues, "Regime tributário inválido."),
  porte: z.union([z.literal("").transform(() => null), z.enum(porteEnum.enumValues)], "Porte inválido."),
  cidade: opcional(z.string()),
  uf: opcional(z.string().toUpperCase().regex(/^[A-Z]{2}$/, "UF deve ter 2 letras.")),
  responsavelNome: opcional(z.string()),
  responsavelCpf: cpf("CPF do responsável deve ter 11 dígitos."),
  contadorNome: opcional(z.string()),
  contadorCpf: cpf("CPF do contador deve ter 11 dígitos."),
  contadorCrc: opcional(z.string()),
});

function ler(form: FormData) {
  return empresaSchema.safeParse(
    Object.fromEntries(Object.keys(empresaSchema.shape).map((c) => [c, c === "regimeTributario" ? form.get(c) : (form.get(c) ?? "")])),
  );
}

function cnpjDuplicado(e: unknown) {
  const err = e as { code?: string; cause?: { code?: string } };
  return (err.cause?.code ?? err.code) === "23505";
}

export async function criarEmpresa(_prev: EstadoForm, form: FormData): Promise<EstadoForm> {
  await requireUser();
  const r = ler(form);
  if (!r.success) return { erro: r.error.issues[0].message };
  let id: string;
  try {
    id = await db.transaction(async (tx) => {
      const [e] = await tx.insert(empresas).values(r.data).returning({ id: empresas.id });
      await seedPlano(tx, e.id);
      return e.id;
    });
  } catch (e) {
    if (cnpjDuplicado(e)) return { erro: "CNPJ já cadastrado." };
    throw e;
  }
  revalidatePath("/");
  redirect(`/e/${id}`);
}

export async function atualizarEmpresa(id: string, _prev: EstadoForm, form: FormData): Promise<EstadoForm> {
  await requireUser();
  const r = ler(form);
  if (!r.success) return { erro: r.error.issues[0].message };
  try {
    await db.update(empresas).set(r.data).where(eq(empresas.id, id));
  } catch (e) {
    if (cnpjDuplicado(e)) return { erro: "CNPJ já cadastrado." };
    throw e;
  }
  revalidatePath("/");
  revalidatePath(`/e/${id}`, "layout");
  return { ok: true };
}

const TIPOS_LOGO = ["image/png", "image/jpeg", "image/webp"];

export async function atualizarLogo(empresaId: string, formData: FormData): Promise<EstadoForm> {
  await requireUser();
  if (!z.uuid().safeParse(empresaId).success) return { erro: "Empresa inválida." };
  const logo = formData.get("logo");
  if (!(logo instanceof File) || logo.size === 0) return { erro: "Escolha uma imagem." };
  if (!TIPOS_LOGO.includes(logo.type)) return { erro: "Use PNG, JPEG ou WebP." };
  if (logo.size > 2 * 1024 * 1024) return { erro: "A imagem passa de 2 MB." };

  let webp: Buffer;
  try {
    webp = await sharp(Buffer.from(await logo.arrayBuffer())).rotate().resize(256, 256, { fit: "cover" }).webp({ quality: 85 }).toBuffer();
  } catch {
    return { erro: "Não foi possível ler a imagem." };
  }

  const path = `${empresaId}/logo.webp`;
  const supabase = await createClient();
  const { error } = await supabase.storage.from("logos").upload(path, webp, { contentType: "image/webp", upsert: true });
  if (error) return { erro: error.message };
  await db.update(empresas).set({ logoPath: path }).where(eq(empresas.id, empresaId));
  revalidatePath("/");
  revalidatePath(`/e/${empresaId}`, "layout");
  return { ok: true };
}

export async function removerLogo(empresaId: string): Promise<EstadoForm> {
  await requireUser();
  if (!z.uuid().safeParse(empresaId).success) return { erro: "Empresa inválida." };
  const [e] = await db.select({ logoPath: empresas.logoPath }).from(empresas).where(eq(empresas.id, empresaId));
  if (!e?.logoPath) return { ok: true };
  const supabase = await createClient();
  const { error } = await supabase.storage.from("logos").remove([e.logoPath]);
  if (error) return { erro: error.message };
  await db.update(empresas).set({ logoPath: null }).where(eq(empresas.id, empresaId));
  revalidatePath("/");
  revalidatePath(`/e/${empresaId}`, "layout");
  return { ok: true };
}
