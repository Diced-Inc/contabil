import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/supabase/server";
import { COOKIE_RECUPERACAO } from "../recuperacao";

/** Destino do link de recuperação de senha: troca o code (PKCE) ou token_hash por sessão. */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  const supabase = await createClient();
  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && type
      ? await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
      : { error: new Error("sem code") };

  const destino = request.nextUrl.clone();
  destino.search = "";
  if (error) {
    destino.pathname = "/login/recuperar";
    destino.searchParams.set("erro", "Link inválido ou expirado. Peça um novo.");
    return NextResponse.redirect(destino);
  }
  destino.pathname = "/login/redefinir";
  const res = NextResponse.redirect(destino);
  // só quem passou por este link pode redefinir sem a senha atual (sessão comum usa "Trocar senha")
  res.cookies.set(COOKIE_RECUPERACAO, "1", {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 15 * 60, path: "/login",
  });
  return res;
}
