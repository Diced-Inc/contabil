import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

let avisou = false;

export async function updateSession(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    // Em produção sem chaves nada passa: falhar fechado em vez de expor os dados sem login.
    if (process.env.NODE_ENV === "production") {
      return new NextResponse("Supabase não configurado", {
        status: 503,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    // Fora de produção as rotas ficam abertas para inspeção local sem .env.
    if (!avisou) {
      console.warn("[auth] NEXT_PUBLIC_SUPABASE_URL/ANON_KEY ausentes: rotas sem proteção.");
      avisou = true;
    }
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
        Object.entries(headers).forEach(([k, v]) => supabaseResponse.headers.set(k, v));
      },
    },
  });

  // Não colocar código entre createServerClient e getClaims().
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims && !request.nextUrl.pathname.startsWith("/login")) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    return NextResponse.redirect(loginUrl);
  }

  return supabaseResponse;
}
