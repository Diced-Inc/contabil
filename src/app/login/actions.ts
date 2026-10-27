"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { emailPermitido } from "@/supabase/proxy";
import { createClient, requireUser } from "@/supabase/server";
import { COOKIE_RECUPERACAO } from "./recuperacao";

export type Resultado = { erro?: string; ok?: boolean };

const msgErro = (e: { code?: string; message: string }) =>
  e.code === "same_password" ? "A nova senha deve ser diferente da atual." : e.message;

function validarNovaSenha(formData: FormData) {
  const password = String(formData.get("nova") ?? "");
  if (password.length < 8) return { erro: "A nova senha precisa ter pelo menos 8 caracteres." };
  if (password !== String(formData.get("confirmar") ?? "")) return { erro: "As senhas não conferem." };
  return { password };
}

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

export async function trocarSenha(_: Resultado, formData: FormData): Promise<Resultado> {
  const user = await requireUser();
  const v = validarNovaSenha(formData);
  if (v.erro) return v;

  const supabase = await createClient();
  const atual = String(formData.get("atual") ?? "");
  const { error: errAtual } = await supabase.auth.signInWithPassword({ email: user.email!, password: atual });
  if (errAtual) return { erro: "Senha atual incorreta." };

  const { error } = await supabase.auth.updateUser({ password: v.password });
  if (error) return { erro: msgErro(error) };
  return { ok: true };
}

export async function enviarRecuperacao(_: Resultado, formData: FormData): Promise<Resultado> {
  const email = String(formData.get("email") ?? "").trim();
  // Mesma resposta exista ou não o e-mail, para não revelar quem tem conta.
  if (email && emailPermitido(email)) {
    const origin = process.env.NEXT_PUBLIC_SITE_URL || (await headers()).get("origin");
    const supabase = await createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/login/confirmar`,
    });
    if (error) console.error("[auth] resetPasswordForEmail:", error.message);
  }
  return { ok: true };
}

export async function redefinirSenha(_: Resultado, formData: FormData): Promise<Resultado> {
  await requireUser();
  const jar = await cookies();
  if (!jar.has(COOKIE_RECUPERACAO)) return { erro: "Abra o link de recuperação enviado por e-mail." };
  const v = validarNovaSenha(formData);
  if (v.erro) return v;

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: v.password });
  if (error) return { erro: msgErro(error) };
  jar.delete({ name: COOKIE_RECUPERACAO, path: "/login" });
  redirect("/");
}
