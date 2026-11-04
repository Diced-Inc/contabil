import type { User } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { emailPermitido, ERRO_NAO_AUTORIZADO } from "./proxy";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Chamado de Server Component: o proxy já renova a sessão.
          }
        },
      },
    },
  );
}

export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!emailPermitido(user.email)) {
    await supabase.auth.signOut();
    redirect(ERRO_NAO_AUTORIZADO);
  }
  return user;
}

/** Nome de exibição e URL assinada (1 h) da foto, ambos em user_metadata (bucket privado "avatars"). */
export async function perfilDoUsuario(user: User) {
  const nome: string = user.user_metadata?.display_name ?? "";
  const path: string | undefined = user.user_metadata?.avatar_path;
  if (!path) return { nome, avatarUrl: null };
  const supabase = await createClient();
  const { data } = await supabase.storage.from("avatars").createSignedUrl(path, 3600);
  return { nome, avatarUrl: data?.signedUrl ?? null };
}
