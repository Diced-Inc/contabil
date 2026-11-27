// Cria o título (obrigação) das guias anexadas antes da fase 3 que ainda não têm um (idempotente; só meses abertos).
// Guia que o cliente já marcou como paga fica de fora (o pagamento pode já ter sido classificado direto do extrato como
// despesa: o título contaria a despesa de novo). Confira a conciliação e use --incluir-pagas para incluí-las.
// node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/backfill-guias.mts [--aplicar] [--incluir-pagas]
import { and, eq, isNull, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { fmtCompetencia } from "../src/lib/format";
import { criarTituloDaGuia, dadosTituloGuia, resolverContasGuia } from "../src/lib/guia-titulo";
import { mesesFechados } from "../src/lib/lancamentos";

const aplicar = process.argv.includes("--aplicar");
const incluirPagas = process.argv.includes("--incluir-pagas");
const client = postgres(process.env.DIRECT_URL ?? process.env.DATABASE_URL!, { prepare: false, max: 1 });
const db = drizzle(client, { schema });
const { guias, ciclosMensais, empresas, titulos } = schema;

class Simulacao extends Error {}

try {
  const pendentes = await db
    .select({ guia: guias, competencia: ciclosMensais.competencia, empresa: empresas.razaoSocial })
    .from(guias)
    .innerJoin(ciclosMensais, eq(ciclosMensais.id, guias.cicloId))
    .innerJoin(empresas, eq(empresas.id, guias.empresaId))
    .leftJoin(titulos, and(eq(titulos.guiaId, guias.id), ne(titulos.status, "cancelado")))
    .where(isNull(titulos.id))
    .orderBy(empresas.razaoSocial, ciclosMensais.competencia);
  if (!pendentes.length) console.log("Nenhuma guia sem título.");
  for (const { guia: g, competencia, empresa } of pendentes) {
    const linha = `${empresa} ${fmtCompetencia(competencia)} ${g.tipo} R$ ${g.valor} vence ${g.vencimento}`;
    if (g.pagoEm && !incluirPagas) {
      console.log(`  revisar ${linha} (paga pelo cliente em ${g.pagoEm.toISOString().slice(0, 10)}: confira se o pagamento já foi classificado; --incluir-pagas)`);
      continue;
    }
    try {
      // simulação roda a mesma transação e desfaz no fim: mostra exatamente o que seria criado
      await db.transaction(async (tx) => {
        if ((await mesesFechados(tx, g.empresaId)).has(competencia)) return console.log(`  pula   ${linha} (mês fechado)`);
        const contas = await resolverContasGuia(tx, g.empresaId, g);
        const r = await criarTituloDaGuia(tx, { empresaId: g.empresaId, guia: g, competencia, contas });
        const [t] = await tx.select().from(titulos).where(eq(titulos.guiaId, g.id));
        const ps = t?.lancamentoId
          ? await tx.select({ codigo: schema.planoContas.codigo, d: schema.partidas.debito, c: schema.partidas.credito })
            .from(schema.partidas).innerJoin(schema.planoContas, eq(schema.planoContas.id, schema.partidas.contaId))
            .where(eq(schema.partidas.lancamentoId, t.lancamentoId)).orderBy(schema.partidas.ordem)
          : [];
        const d = dadosTituloGuia(g, competencia);
        console.log(`  ${aplicar ? "criado" : "criaria"} ${linha} -> título ${d.descricao} em ${d.competencia}: ${ps.map((p) => `${Number(p.d) > 0 ? "D" : "C"} ${p.codigo} ${Number(p.d) > 0 ? p.d : p.c}`).join(" / ") || "sem lançamento"}${r.aviso ? ` (${r.aviso})` : ""}`);
        if (!aplicar) throw new Simulacao();
      });
    } catch (e) {
      if (!(e instanceof Simulacao)) console.log(`  ERRO   ${linha}: ${(e as Error).message}`);
    }
  }
  console.log(aplicar ? "\nAplicado." : "\nSimulação (use --aplicar para gravar).");
} finally {
  await client.end();
}
