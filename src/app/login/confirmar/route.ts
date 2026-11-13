import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient, destinoPosLogin, vincularConvites } from "@/supabase/server";
import { COOKIE_RECUPERACAO } from "../recuperacao";

/**
 * Destino dos links por e-mail: troca o code (PKCE) ou token_hash por sessão.
 * Recuperação de senha e convite (`proximo=definir-senha`) vão para /login/redefinir; outros links de acesso entram direto.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const convite = searchParams.get("proximo") === "definir-senha";

  const supabase = await createClient();
  const { data, error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && type
      ? await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
      : { data: { user: null }, error: new Error("sem code") };

  const destino = request.nextUrl.clone();
  destino.search = "";
  if (error || !data.user) {
    destino.pathname = "/login/recuperar";
    destino.searchParams.set("erro", "Link inválido ou expirado. Peça um novo.");
    return NextResponse.redirect(destino);
  }
  await vincularConvites(data.user);

  // code sem tipo é o fluxo PKCE de resetPasswordForEmail
  if (!convite && tokenHash && type !== "recovery") {
    destino.pathname = await destinoPosLogin(data.user);
    return NextResponse.redirect(destino);
  }

  destino.pathname = "/login/redefinir";
  if (convite) destino.searchParams.set("convite", "1");
  const res = NextResponse.redirect(destino);
  // só quem passou por este link pode definir a senha sem a atual (sessão comum usa "Trocar senha")
  res.cookies.set(COOKIE_RECUPERACAO, "1", {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 15 * 60, path: "/login",
  });
  return res;
}
