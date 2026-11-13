import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { and, eq, isNull, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { contadores, membros } from "@/db/schema";

export const ERRO_NAO_AUTORIZADO = "/login?erro=Acesso%20n%C3%A3o%20autorizado";

export type Papel = "contador" | "cliente";

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

/** Reserva para quando a tabela contadores não responde: ALLOWED_EMAILS (lista vazia = ninguém). */
function emailNaListaDeReserva(email: string | undefined) {
  const lista = (process.env.ALLOWED_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return !!email && lista.includes(email.toLowerCase());
}

/** Papel do usuário no sistema; null = logado sem acesso. Deduplicado por request. */
export const papelDe = cache(async (userId: string, email: string | undefined): Promise<Papel | null> => {
  let contador: boolean;
  try {
    contador = (await db.select({ id: contadores.userId }).from(contadores).where(eq(contadores.userId, userId)).limit(1)).length > 0;
  } catch (e) {
    console.error("[auth] falha ao consultar contadores; usando ALLOWED_EMAILS:", e);
    contador = emailNaListaDeReserva(email);
  }
  if (contador) return "contador";
  const [m] = await db.select({ id: membros.id }).from(membros).where(eq(membros.userId, userId)).limit(1);
  return m ? "cliente" : null;
});

const usuarioAtual = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user;
});

async function negar(): Promise<never> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect(ERRO_NAO_AUTORIZADO);
}

/** Qualquer usuário logado (perfil, senha). */
export async function requireSessao() {
  const user = await usuarioAtual();
  if (!user) redirect("/login");
  return user;
}

/** Contador: todas as telas contábeis e actions. Cliente vai para o portal; sem papel, sai. */
export async function requireUser() {
  const user = await requireSessao();
  const papel = await papelDe(user.id, user.email);
  if (papel === "contador") return user;
  if (papel === "cliente") redirect("/portal");
  return negar();
}

/** Contador ou cliente membro da empresa. */
export async function requireMembro(empresaId: string) {
  const user = await requireSessao();
  const papel = await papelDe(user.id, user.email);
  if (papel === null) return negar();
  if (!z.uuid().safeParse(empresaId).success) notFound();
  if (papel === "cliente") {
    const [m] = await db
      .select({ id: membros.id })
      .from(membros)
      .where(and(eq(membros.empresaId, empresaId), eq(membros.userId, user.id)))
      .limit(1);
    if (!m) redirect("/portal");
  }
  return { user, papel };
}

/** Para onde mandar logo após o login (contador: empresas; cliente: portal). Sem papel: desloga. */
export async function destinoPosLogin(user: User) {
  const papel = await papelDe(user.id, user.email);
  if (papel === null) return negar();
  return papel === "contador" ? "/" : "/portal";
}

/** Liga convites pendentes (mesmo e-mail, user_id null) ao usuário que acabou de entrar com e-mail confirmado. */
export async function vincularConvites(user: User) {
  if (!user.email || !user.email_confirmed_at) return;
  await db
    .update(membros)
    .set({ userId: user.id, aceitoEm: sql`coalesce(${membros.aceitoEm}, now())` })
    .where(and(eq(membros.email, user.email.toLowerCase()), isNull(membros.userId)));
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

/** URL assinada (1 h) do logo da empresa (bucket privado "logos") ou null. */
export async function logoDaEmpresa(empresa: { logoPath: string | null }) {
  if (!empresa.logoPath) return null;
  const supabase = await createClient();
  const { data } = await supabase.storage.from("logos").createSignedUrl(empresa.logoPath, 3600);
  return data?.signedUrl ?? null;
}
