/**
 * Reclassificação em lote, desfazer lote e correção do estorno fora do mês contra o Postgres de verdade, numa transação
 * desfeita no fim (nada fica no banco). Sem DATABASE_URL o teste é pulado (pnpm test); para rodar:
 *   node --env-file=.env node_modules/vitest/vitest.mjs run src/db/reclassificacao.test.ts
 */
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { PartidaInput } from "@/lib/lancamentos";

const temBanco = !!process.env.DATABASE_URL;
class Desfazer extends Error {}

describe.skipIf(!temBanco)("reclassificação em lote (Postgres)", async () => {
  const { db } = await import("@/db");
  const { contasBancarias, empresas, fechamentos, importacoes, planoContas, transacoesBancarias } = await import("@/db/schema");
  const { classificarTransacao } = await import("@/lib/conciliacao");
  const { criarLancamento } = await import("@/lib/lancamentos");
  const { situacao } = await import("@/lib/reclassificacao");
  const reg = await import("@/lib/reclassificacao-registro");
  afterAll(() => db.$client.end());

  it("estorno + novo carimbado, prévia = gravado, idempotente, desfazer volta ao estado anterior, correção do estorno", async () => {
    try { await db.transaction(async (tx) => {
      const [e] = await tx.insert(empresas).values({ razaoSocial: "Teste lote", cnpj: `L${Date.now()}` }).returning();
      const conta = async (codigo: string, nome: string, natureza: "D" | "C", extra: object = {}) =>
        (await tx.insert(planoContas).values({ empresaId: e.id, codigo, nome, natureza, tipo: "analitica", ...extra }).returning())[0];
      const banco = await conta("1.1.1.01", "Banco", "D");
      const cli = await conta("1.1.2.01", "Clientes", "D", { papel: "clientes" });
      await conta("2.1.1.01", "Fornecedores", "C", { papel: "fornecedores" });
      const adto = await conta("2.1.5.05", "Adiantamentos de Clientes", "C");
      const serv = await conta("3.1.1.03", "Venda de Serviços", "C", { grupoDre: "receita_bruta" });
      const [cb] = await tx.insert(contasBancarias).values({ empresaId: e.id, nome: "Banco teste", ofxBankid: "1", ofxAcctid: "1", contaContabilId: banco.id }).returning();
      const [imp] = await tx.insert(importacoes).values({ contaBancariaId: cb.id, nomeArquivo: "t.ofx", qtdTransacoes: 4, qtdNovas: 4 }).returning();
      /** Recebimento classificado direto em Clientes (o legado da TAVAPPS). */
      const recebido = async (fitid: string, data: string, valor: string) => {
        const [t] = await tx.insert(transacoesBancarias).values({ contaBancariaId: cb.id, importacaoId: imp.id, fitid, data, valor, memo: `PIX RECEBIDO ${fitid}` }).returning();
        await classificarTransacao(tx, { empresaId: e.id, transacaoId: t.id, historico: `Recebimento ${fitid}`, confirmarSemTitulo: true, partidas: [{ contaId: cli.id, valor }] });
        return t.id;
      };
      const t1 = await recebido("a", "2025-03-10", "100.00");
      const t2 = await recebido("b", "2025-03-15", "200.00");
      const t3 = await recebido("c", "2025-04-05", "300.00");
      const t4 = await recebido("d", "2025-04-08", "40.00");

      /** Σ(D − C) por conta × competência e por conta × mês da data (relatórios e banco). */
      const somas = async () => [...await tx.execute<{ k: string; s: string }>(sql`
        SELECT 'c:' || p.conta_id || '@' || l.competencia AS k, sum(p.debito - p.credito)::text AS s
        FROM partidas p JOIN lancamentos l ON l.id = p.lancamento_id WHERE l.empresa_id = ${e.id} GROUP BY 1 HAVING sum(p.debito - p.credito) <> 0
        UNION ALL
        SELECT 'd:' || p.conta_id || '@' || date_trunc('month', l.data)::date, sum(p.debito - p.credito)::text
        FROM partidas p JOIN lancamentos l ON l.id = p.lancamento_id WHERE l.empresa_id = ${e.id} GROUP BY 1 HAVING sum(p.debito - p.credito) <> 0
        ORDER BY 1`)];
      const antes = await somas();
      const criadosNoLote = (loteId: string) => tx.execute<{ id: string; origem: string; competencia: string; substitui: string | null; partidas: PartidaInput[] }>(sql`
        SELECT l.id, l.origem::text AS origem, l.competencia::text AS competencia, l.substitui_id AS substitui,
          (SELECT json_agg(json_build_object('contaId', p.conta_id, 'debito', p.debito::text, 'credito', p.credito::text) ORDER BY p.ordem)
           FROM partidas p WHERE p.lancamento_id = l.id) AS partidas
        FROM lancamento_log g JOIN lancamentos l ON l.id = g.lancamento_id
        WHERE g.lote_id = ${loteId} AND g.acao = 'criado' ORDER BY l.numero`);
      const chave = (ls: { competencia: string; partidas: PartidaInput[] }[]) => {
        const m: Record<string, number> = {};
        for (const l of ls) for (const p of l.partidas) {
          const k = `${p.contaId}@${l.competencia}`;
          m[k] = Math.round(((m[k] ?? 0) + Number(p.debito || 0) - Number(p.credito || 0)) * 100) / 100;
          if (!m[k]) delete m[k];
        }
        return m;
      };
      const previa = async (id: string, alvo: Parameters<typeof situacao>[1]) =>
        situacao((await reg.listarCandidatas(tx, e.id, id))[0], alvo, await reg.contextoLote(tx, e.id));

      // lote A: receita direta no mês do extrato
      const receita = { operacao: "receita_direta" as const, contaId: serv.id, competencia: null };
      const pa = [await previa(t1, receita), await previa(t2, receita)];
      expect(pa.map((i) => i.tipo)).toEqual(["reclassificar", "reclassificar"]);
      const A = await reg.reclassificarLote(tx, { empresaId: e.id, transacaoIds: [t1, t2], alvo: receita, motivo: "Recebimentos sem título vão para a receita" });
      expect([A.feitas, A.puladas.length, A.erros]).toEqual([2, 0, []]);
      const ca = [...await criadosNoLote(A.loteId)];
      expect(chave(ca)).toEqual(chave(pa.flatMap((i) => i.lancs))); // prévia = gravado
      expect(ca.filter((l) => l.origem === "estorno").every((l) => l.substitui === null)).toBe(true);
      expect(ca.filter((l) => l.origem !== "estorno").every((l) => l.substitui !== null)).toBe(true);
      const [logA] = await tx.execute<{ n: number; sem: number }>(sql`
        SELECT count(*)::int AS n, count(*) FILTER (WHERE motivo IS DISTINCT FROM 'Recebimentos sem título vão para a receita')::int AS sem
        FROM lancamento_log WHERE lote_id = ${A.loteId}`);
      expect(logA).toEqual({ n: 6, sem: 0 }); // por item: estornado + estorno criado + novo criado
      // idempotência: as mesmas transações de novo pulam
      const A2 = await reg.reclassificarLote(tx, { empresaId: e.id, transacaoIds: [t1, t2], alvo: receita, motivo: "de novo, sem efeito" });
      expect([A2.feitas, A2.puladas.map((p) => p.motivo)]).toEqual([0, ["Já está em 3.1.1.03 Venda de Serviços", "Já está em 3.1.1.03 Venda de Serviços"]]);

      // lote B: competência anterior (reconhecimento em fevereiro + baixa); lote C: adiantamento
      const fev = { ...receita, competencia: "2025-02-01" };
      const pb = await previa(t3, fev);
      const B = await reg.reclassificarLote(tx, { empresaId: e.id, transacaoIds: [t3], alvo: fev, motivo: "Serviço de fevereiro" });
      expect(B.feitas).toBe(1);
      expect(chave([...await criadosNoLote(B.loteId)])).toEqual(chave(pb.lancs));
      expect((await reg.reclassificarLote(tx, { empresaId: e.id, transacaoIds: [t3], alvo: fev, motivo: "de novo" })).puladas).toHaveLength(1);
      const ad = { operacao: "adiantamento" as const, contaId: null, competencia: null };
      const pc = await previa(t4, ad);
      const C = await reg.reclassificarLote(tx, { empresaId: e.id, transacaoIds: [t4], alvo: ad, motivo: "Recebido antes do serviço" });
      expect(C.feitas).toBe(1);
      expect(chave([...await criadosNoLote(C.loteId)])).toEqual(chave(pc.lancs));
      expect(chave(pc.lancs)).toEqual({ [`${cli.id}@2025-04-01`]: 40, [`${adto.id}@2025-04-01`]: -40 });

      // mês fechado bloqueia (não manda para hoje)
      await tx.insert(fechamentos).values({ empresaId: e.id, competencia: "2025-03-01" });
      const D = await reg.desfazerLote(tx, { empresaId: e.id, loteId: A.loteId, motivo: "teste mês fechado" });
      expect(D.erros.map((x) => x.motivo)).toEqual(["Mês 03/2025 fechado: reabra em Fechamento para desfazer", "Mês 03/2025 fechado: reabra em Fechamento para desfazer"]);
      await tx.execute(sql`delete from fechamentos where empresa_id = ${e.id}`);

      // desfazer os três lotes: volta ao estado anterior (por competência e por data), títulos do lote B cancelados
      for (const l of [A, B, C]) expect((await reg.desfazerLote(tx, { empresaId: e.id, loteId: l.loteId, motivo: "Desfazendo o teste" })).feitas).toBe(l === A ? 2 : 1);
      expect(await somas()).toEqual(antes);
      const [tb] = await tx.execute<{ status: string }>(sql`select status::text from titulos where empresa_id = ${e.id}`);
      expect(tb.status).toBe("cancelado");
      // desfazer de novo: pulado; desfazer o desfazer: recusado
      const A3 = await reg.desfazerLote(tx, { empresaId: e.id, loteId: A.loteId, motivo: "de novo" });
      expect([A3.feitas, A3.puladas.length]).toEqual([0, 2]);
      const ultimo = (await reg.listarLotes(tx, e.id)).find((l) => l.tipo === "desfazer")!;
      expect(ultimo.tipo).toBe("desfazer");
      await expect(reg.desfazerLote(tx, { empresaId: e.id, loteId: ultimo.loteId, motivo: "refazer" })).rejects.toThrow(/já é um desfazer/);
      // as transações voltaram para Clientes e podem ser reclassificadas de novo
      expect((await previa(t1, receita)).tipo).toBe("reclassificar");

      // estorno fora do mês (código antigo): original em maio, estorno em junho
      const orig = await criarLancamento(tx, {
        empresaId: e.id, data: "2025-05-04", historico: "Recebimento antigo", origem: "conciliacao",
        partidas: [{ contaId: banco.id, debito: "50.00" }, { contaId: serv.id, credito: "50.00" }],
      });
      const est = await criarLancamento(tx, {
        empresaId: e.id, data: "2025-06-20", competencia: "2025-06-01", historico: `Estorno do lançamento ${orig.numero}: Recebimento antigo`,
        origem: "estorno", estornoDeId: orig.id, partidas: [{ contaId: banco.id, credito: "50.00" }, { contaId: serv.id, debito: "50.00" }],
      });
      await tx.execute(sql`update lancamentos set status = 'estornado' where id = ${orig.id}`);
      const pares = await reg.estornosForaDoMes(tx, e.id);
      expect(pares.map((p) => [p.estorno.id, p.bloqueio])).toEqual([[est.id, null]]);
      const K = await reg.corrigirEstornosForaDoMes(tx, { empresaId: e.id, motivo: "Moodlr: setembro em dobro" });
      expect(K.feitas).toBe(1);
      expect(await reg.estornosForaDoMes(tx, e.id)).toHaveLength(0);
      const [mes] = await tx.execute<{ maio: string; junho: string }>(sql`
        SELECT coalesce(sum(p.debito - p.credito) FILTER (WHERE l.competencia = '2025-05-01'), 0)::text AS maio,
          coalesce(sum(p.debito - p.credito) FILTER (WHERE l.competencia = '2025-06-01'), 0)::text AS junho
        FROM partidas p JOIN lancamentos l ON l.id = p.lancamento_id WHERE l.empresa_id = ${e.id} AND p.conta_id = ${serv.id}
          AND l.created_at = now() AND l.numero >= ${orig.numero}`);
      expect(mes).toEqual({ maio: "0.00", junho: "0.00" }); // o par original/estorno se anula no mês do original
      const ck = [...await criadosNoLote(K.loteId)];
      expect(ck.map((l) => [l.origem, l.competencia, l.substitui])).toEqual([["estorno", "2025-06-01", null], ["estorno", "2025-05-01", est.id]]);
      expect((await reg.corrigirEstornosForaDoMes(tx, { empresaId: e.id, motivo: "de novo, nada" })).feitas).toBe(0);
      throw new Desfazer();
    }); } catch (err) { if (!(err instanceof Desfazer)) throw err; }
  }, 120_000);
});
