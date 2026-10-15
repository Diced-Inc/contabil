import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Pooler transaction do Supabase derruba conexões ociosas; sem idle_timeout o postgres-js
// fica ~60 s esperando um socket morto. Um único pool por processo evita N pools no HMR do dev.
const globalForDb = globalThis as unknown as { __pg?: ReturnType<typeof postgres> };
const client =
  globalForDb.__pg ??
  postgres(process.env.DATABASE_URL!, {
    prepare: false,
    max: 10,
    idle_timeout: 20,
    max_lifetime: 60 * 30,
    connect_timeout: 10,
  });
if (process.env.NODE_ENV !== "production") globalForDb.__pg = client;

export const db = drizzle(client, { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
