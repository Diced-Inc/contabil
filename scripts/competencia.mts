// Relatórios por competência: compara, por empresa e mês, os totais por data e por competência (débitos e resultado
// da classe 3) e lista os lançamentos com competência fora do mês da data. --aplicar preenche competência vazia com o
// mês da data (backfill; hoje a coluna é NOT NULL e tem CHECK de 1º dia, então deve achar zero).
// node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/competencia.mts [--aplicar]
import postgres from "postgres";

const aplicar = process.argv.includes("--aplicar");
const sql = postgres(process.env.DIRECT_URL ?? process.env.DATABASE_URL!, { prepare: false, max: 1 });
const fmt = (n: string | number) => Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
try {
  const [{ n: vazias }] = await sql`SELECT count(*)::int n FROM lancamentos WHERE competencia IS NULL OR extract(day from competencia) <> 1`;
  console.log(`Competência vazia ou fora do 1º dia: ${vazias}`);
  if (aplicar && vazias) {
    const r = await sql`UPDATE lancamentos SET competencia = date_trunc('month', data)::date WHERE competencia IS NULL OR extract(day from competencia) <> 1`;
    console.log(`  preenchidas: ${r.count}`);
  }
  for (const e of await sql`SELECT id, razao_social FROM empresas ORDER BY razao_social`) {
    const meses = await sql`
      WITH p AS (
        SELECT date_trunc('month', l.data)::date AS por_data, l.competencia AS por_comp, p.debito, p.credito, pc.codigo
        FROM lancamentos l JOIN partidas p ON p.lancamento_id = l.id JOIN plano_contas pc ON pc.id = p.conta_id
        WHERE l.empresa_id = ${e.id} AND l.origem <> 'apuracao'
      ), m AS (SELECT por_data AS mes FROM p UNION SELECT por_comp FROM p)
      SELECT m.mes::text,
        coalesce((SELECT sum(debito) FROM p WHERE por_data = m.mes), 0)::text AS deb_data,
        coalesce((SELECT sum(debito) FROM p WHERE por_comp = m.mes), 0)::text AS deb_comp,
        coalesce((SELECT sum(credito - debito) FROM p WHERE por_data = m.mes AND codigo LIKE '3%'), 0)::text AS res_data,
        coalesce((SELECT sum(credito - debito) FROM p WHERE por_comp = m.mes AND codigo LIKE '3%'), 0)::text AS res_comp
      FROM m ORDER BY 1`;
    const mudam = meses.filter((m) => m.deb_data !== m.deb_comp || m.res_data !== m.res_comp);
    const fora = await sql`
      SELECT numero, origem, data::text, competencia::text, left(historico, 60) AS h FROM lancamentos
      WHERE empresa_id = ${e.id} AND competencia <> date_trunc('month', data)::date ORDER BY data`;
    const fechados = await sql`SELECT string_agg(to_char(competencia, 'MM/YYYY'), ', ' ORDER BY competencia) AS f FROM fechamentos WHERE empresa_id = ${e.id}`;
    console.log(`\n${e.razao_social}: ${meses.length} mês(es) com movimento, ${mudam.length} mudam${fechados[0].f ? ` (fechados: ${fechados[0].f})` : ""}`);
    for (const m of mudam)
      console.log(`  ${m.mes.slice(0, 7)}  débitos ${fmt(m.deb_data)} -> ${fmt(m.deb_comp)}  resultado ${fmt(m.res_data)} -> ${fmt(m.res_comp)}`);
    for (const l of fora) console.log(`    nº ${l.numero} ${l.origem} data ${l.data} competência ${l.competencia.slice(0, 7)}: ${l.h}`);
  }
  console.log(aplicar ? "\nAplicado." : "\nSimulação (use --aplicar para gravar o backfill).");
} finally {
  await sql.end();
}
