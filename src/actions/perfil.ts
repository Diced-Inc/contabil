"use server";

import { revalidatePath } from "next/cache";
import sharp from "sharp";
import type { Resultado } from "@/app/login/actions";
import { createClient, requireUser } from "@/supabase/server";

const TIPOS = ["image/png", "image/jpeg", "image/webp"];
const MAX = 2 * 1024 * 1024;

export async function atualizarFoto(formData: FormData): Promise<Resultado> {
  const user = await requireUser();
  const foto = formData.get("foto");
  if (!(foto instanceof File) || foto.size === 0) return { erro: "Escolha uma imagem." };
  if (!TIPOS.includes(foto.type)) return { erro: "Use PNG, JPEG ou WebP." };
  if (foto.size > MAX) return { erro: "A imagem passa de 2 MB." };

  let webp: Buffer;
  try {
    webp = await sharp(Buffer.from(await foto.arrayBuffer())).rotate().resize(256, 256, { fit: "cover" }).webp({ quality: 85 }).toBuffer();
  } catch {
    return { erro: "Não foi possível ler a imagem." };
  }

  const supabase = await createClient();
  const path = `${user.id}/avatar.webp`;
  const { error } = await supabase.storage.from("avatars").upload(path, webp, { contentType: "image/webp", upsert: true });
  if (error) return { erro: error.message };
  const { error: errMeta } = await supabase.auth.updateUser({ data: { avatar_path: path } });
  if (errMeta) return { erro: errMeta.message };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removerFoto(): Promise<Resultado> {
  const user = await requireUser();
  const path: string | undefined = user.user_metadata?.avatar_path;
  if (!path) return { ok: true };
  const supabase = await createClient();
  const { error } = await supabase.storage.from("avatars").remove([path]);
  if (error) return { erro: error.message };
  const { error: errMeta } = await supabase.auth.updateUser({ data: { avatar_path: null } });
  if (errMeta) return { erro: errMeta.message };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function salvarNome(_: Resultado, formData: FormData): Promise<Resultado> {
  await requireUser();
  const nome = String(formData.get("nome") ?? "").trim();
  if (nome.length > 80) return { erro: "Use até 80 caracteres." };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ data: { display_name: nome || null } });
  if (error) return { erro: error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}
