import { createClient } from "@supabase/supabase-js";

/** Client com service role (convites, links de acesso). Só no servidor; null quando a chave não está configurada. */
export function adminClient() {
  if (typeof window !== "undefined") throw new Error("adminClient só pode rodar no servidor.");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
