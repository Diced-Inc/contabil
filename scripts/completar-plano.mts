// Completa o plano de contas das empresas existentes com as contas novas do seed (idempotente).
// node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/completar-plano.mts [--aplicar]
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { completarPlano } from "../src/db/completar-plano";
import * as schema from "../src/db/schema";

const aplicar = process.argv.includes("--aplicar");
const client = postgres(process.env.DIRECT_URL ?? process.env.DATABASE_URL!, { prepare: false, max: 1 });
const db = drizzle(client, { schema });
try {
  for (const e of await db.select({ id: schema.empresas.id, nome: schema.empresas.razaoSocial }).from(schema.empresas).orderBy(schema.empresas.razaoSocial)) {
    const acoes = await db.transaction((tx) => completarPlano(tx, e.id, { aplicar }));
    const mudou = acoes.filter((a) => a.acao !== "existe");
    console.log(`\n${e.nome}: ${mudou.length ? "" : "nada a fazer"}`);
    for (const a of mudou)
      console.log(`  ${a.acao.padEnd(6)} ${a.codigo.padEnd(9)} ${a.nome}${a.acao === "papel" ? ` -> papel ${a.papel}` : a.acao === "criar" && a.papel ? ` (papel ${a.papel})` : ""}${a.acao === "aviso" ? ` -- ${a.motivo}` : ""}`);
    for (const a of acoes) if (a.acao === "existe" && a.codigo !== a.seed) console.log(`  reusa  ${a.codigo.padEnd(9)} ${a.nome} (no lugar de ${a.seed})`);
  }
  console.log(aplicar ? "\nAplicado." : "\nSimulação (use --aplicar para gravar).");
} finally {
  await client.end();
}
