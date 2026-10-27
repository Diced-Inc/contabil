import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/supabase/server";

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
  } else {
    destino.pathname = "/login/redefinir";
  }
  return NextResponse.redirect(destino);
}
