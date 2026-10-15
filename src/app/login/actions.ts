"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/supabase/server";

export async function entrar(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("senha") ?? "");
  if (!email || !password) redirect("/login?erro=" + encodeURIComponent("Informe e-mail e senha."));

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect("/login?erro=" + encodeURIComponent("E-mail ou senha inválidos."));

  redirect("/");
}

export async function sair() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
