/**
 * Triggers de período fechado (0023) e relatórios por competência contra o Postgres de verdade, numa transação desfeita
 * no fim (nada fica no banco; só a sequência de `numero` avança). Sem DATABASE_URL o teste é pulado (pnpm test); para rodar:
 *   node --env-file=.env node_modules/vitest/vitest.mjs run src/db/periodo-fechado.test.ts
 */
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

const temBanco = !!process.env.DATABASE_URL;
class Desfazer extends Error {}

describe.skipIf(!temBanco)("período fechado por data ou competência (Postgres)", async () => {
  const { db } = await import("@/db");
  const { empresas, fechamentos, lancamentos, partidas, planoContas } = await import("@/db/schema");
  const { criarLancamento, estornarLancamento } = await import("@/lib/lancamentos");
  const { saldos } = await import("@/lib/relatorios/saldos");
  const { razao360 } = await import("@/lib/relatorios/razao");
  const { diario } = await import("@/lib/relatorios/diario");
  const { carregarEstado, motivoNaoFechar } = await import("@/lib/fechamento");
  afterAll(() => db.$client.end());

  it("barra data ou competência em mês fechado; relatórios agrupam por competência; estorno na competência do original", async () => {
    const erros: string[] = [];
    try { await db.transaction(async (tx) => {
      const [e] = await tx.insert(empresas).values({ razaoSocial: "Teste trigger", cnpj: `T${Date.now()}` }).returning();
      const [banco, receita] = await tx.insert(planoContas).values([
        { empresaId: e.id, codigo: "1.1", nome: "Banco", natureza: "D", tipo: "analitica" },
        { empresaId: e.id, codigo: "3.1", nome: "Receita", natureza: "C", tipo: "analitica", grupoDre: "receita_bruta" },
      ]).returning();
      const fechar = (c: string) => tx.insert(fechamentos).values({ empresaId: e.id, competencia: c });
      /** Lançamento cru (sem o código do app): o trigger decide. */
      const lancar = async (data: string, competencia: string, valor = "10.00") => {
        const [l] = await tx.insert(lancamentos).values({ empresaId: e.id, data, competencia, historico: "t", origem: "manual" }).returning();
        await tx.insert(partidas).values([
          { lancamentoId: l.id, contaId: banco.id, debito: valor, ordem: 0 },
          { lancamentoId: l.id, contaId: receita.id, credito: valor, ordem: 1 },
        ]);
        return l;
      };
      /** Espera erro do trigger, num savepoint (a transação externa continua). */
      const barrado = async (fn: () => Promise<unknown>) => {
        const msg = await tx.transaction(async (sp) => {
          void sp;
          await fn();
          return "passou";
        }).catch((err: { cause?: { message?: string }; message?: string }) => err.cause?.message ?? err.message ?? "erro");
        erros.push(msg);
        return msg;
      };

      // fechado antes: fevereiro
      await fechar("2030-02-01");
      expect(await barrado(() => lancar("2030-02-10", "2030-03-01"))).toMatch(/02\/2030 está fechado/); // data fechada
      expect(await barrado(() => lancar("2030-03-10", "2030-02-01"))).toMatch(/02\/2030 está fechado/); // competência fechada
      const marco = await lancar("2030-03-10", "2030-03-01", "100.00"); // as duas abertas
      await lancar("2030-01-31", "2030-03-01", "7.00"); // banco em janeiro, competência março
      await lancar("2030-03-31", "2030-04-01", "5.00"); // banco em março, competência abril
      expect(await barrado(() => tx.execute(sql`update lancamentos set competencia = '2030-02-01' where id = ${marco.id}`))).toMatch(/02\/2030/);
      expect(await barrado(() => tx.execute(sql`update lancamentos set data = '2030-02-05' where id = ${marco.id}`))).toMatch(/02\/2030/);
      expect(await barrado(() => lancar("2030-03-10", "2030-03-15"))).toMatch(/lancamentos_competencia_mes/);

      // lançamento existente cuja competência fecha depois (data aberta)
      const x = await lancar("2030-04-05", "2030-05-01", "3.00");
      await fechar("2030-05-01");
      expect(await barrado(() => tx.execute(sql`update lancamentos set historico = 'mudou' where id = ${x.id}`))).toMatch(/05\/2030/);
      expect(await barrado(() => tx.insert(partidas).values({ lancamentoId: x.id, contaId: banco.id, debito: "1.00" }))).toMatch(/05\/2030/);
      expect(await barrado(() => tx.execute(sql`delete from partidas where lancamento_id = ${x.id}`))).toMatch(/05\/2030/);
      expect(await barrado(() => tx.execute(sql`delete from lancamentos where id = ${x.id}`))).toMatch(/05\/2030/);
      // status muda livre (estorno marca o original), e o estorno vai para a competência da data (maio fechado)
      const ex = await estornarLancamento(tx, x.id, "2030-04-20");
      expect(ex.competencia).toBe("2030-04-01");
      // competência aberta: estorno fica na competência do original, mesmo com a data em outro mês
      const orig = await criarLancamento(tx, {
        empresaId: e.id, data: "2030-03-20", historico: "orig", origem: "manual",
        partidas: [{ contaId: banco.id, debito: "1.00" }, { contaId: receita.id, credito: "1.00" }],
      });
      const eo = await estornarLancamento(tx, orig.id, "2030-04-02");
      expect([eo.data, eo.competencia]).toEqual(["2030-04-02", "2030-03-01"]);

      // relatórios: março por competência = 100 + 7 (+1 −1 do par estornado); o de 31/03 com competência abril fica fora
      const rec = async (de: string, ate: string) => {
        const l = (await saldos(e.id, de, ate, tx)).find((x) => x.id === receita.id)!;
        return { saldoAnterior: Number(l.saldoAnterior).toFixed(2), debitos: Number(l.debitos).toFixed(2), creditos: Number(l.creditos).toFixed(2) };
      };
      expect(await rec("2030-03-01", "2030-03-31")).toMatchObject({ creditos: "108.00", debitos: "1.00", saldoAnterior: "0.00" });
      expect(await rec("2030-01-01", "2030-01-31")).toMatchObject({ creditos: "0.00", debitos: "0.00" });
      expect((await rec("2030-04-15", "2030-04-30"))).toMatchObject({ saldoAnterior: "-107.00", creditos: "5.00", debitos: "3.00" });
      const [r] = await razao360(e.id, [receita.id], "2030-03-01", "2030-03-31", tx);
      expect(r.movimentos.map((m) => [m.data, m.competencia, m.credito])).toEqual([
        ["2030-01-31", "2030-03-01", "7.00"], ["2030-03-10", "2030-03-01", "100.00"], ["2030-03-20", "2030-03-01", "1.00"],
        ["2030-04-02", "2030-03-01", "0.00"],
      ]);
      const d = await diario(e.id, "2030-04-01", "2030-04-30", tx);
      expect(d.map((l) => [l.data, l.competencia])).toEqual([["2030-03-31", "2030-04-01"], ["2030-04-20", "2030-04-01"]]);
      // fechamento: o mês mais antigo aberto conta pela data (31/01, competência março) e pela competência
      const est = await carregarEstado(tx, e.id);
      expect(est.primeiroAberto).toBe("2030-01-01");
      expect(motivoNaoFechar("2030-04-01", est)).toContain("01/2030");
      throw new Desfazer();
    }); } catch (err) { if (!(err instanceof Desfazer)) throw err; }
    expect(erros).toHaveLength(9);
  }, 60_000);
});
