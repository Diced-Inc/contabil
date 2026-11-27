import { describe, expect, it } from "vitest";
import { montarExemplos, normalizarMemo, selecionarExemplos } from "./exemplos";

const ex = (memo: string, valor: string, contaCodigo: string) => ({ memo, valor, contaCodigo });

describe("montarExemplos", () => {
  const tx = (lancamentoId: string, memo: string, valor: string) => ({ lancamentoId, memo, valor, contaBanco: "banco" });
  const p = (lancamentoId: string, contaId: string, codigo: string, nome: string, papel: string | null, debito: string, credito = "0") =>
    ({ lancamentoId, contaId, codigo, nome, papel, debito, credito });
  it("pega a maior contrapartida e tira Clientes e imposto a recolher; Fornecedores fica", () => {
    const r = montarExemplos(
      [tx("l1", "PIX RECEBIDO ACME", "100.00"), tx("l2", "BOLETO PAGO XYZ", "-50.00"), tx("l3", "DARF", "-30.00"), tx("l4", "PIX RECEBIDO B", "80.00")],
      [
        p("l1", "banco", "1.1.1.02", "Bancos", null, "100.00"), p("l1", "cli", "1.1.2.01", "Clientes", "clientes", "0", "100.00"),
        p("l2", "forn", "2.1.1.01", "Fornecedores Nacionais", "fornecedores", "50.00"), p("l2", "banco", "1.1.1.02", "Bancos", null, "0", "50.00"),
        p("l3", "irrf", "2.1.3.04", "IRRF a Recolher", null, "30.00"), p("l3", "banco", "1.1.1.02", "Bancos", null, "0", "30.00"),
        p("l4", "banco", "1.1.1.02", "Bancos", null, "80.00"), p("l4", "rec", "3.1.1.03", "Venda de Serviços", null, "0", "70.00"),
        p("l4", "jur", "3.1.2.02", "Juros Ativos", null, "0", "10.00"),
      ],
    );
    expect(r).toEqual([{ memo: "BOLETO PAGO XYZ", valor: "-50.00", contaCodigo: "2.1.1.01" }, { memo: "PIX RECEBIDO B", valor: "80.00", contaCodigo: "3.1.1.03" }]);
  });
});

describe("normalizarMemo", () => {
  it("tira acento, dígitos, datas e ids", () => {
    expect(normalizarMemo("PIX RECEBIDO MATHEUS11/11 MATHEUS GONÇALVES 010.262.663-43")).toEqual(["pix", "recebido", "matheus", "matheus", "goncalves"]);
    expect(normalizarMemo("TAR PLANO ADAPT 1 02/26")).toEqual(["tar", "plano", "adapt"]);
  });
});

describe("selecionarExemplos", () => {
  const pool = [
    ex("PIX ENVIADO MATHEUS GONCALVES 010.262.663-43", "-500.00", "1.1.4.06"),
    ex("PIX ENVIADO MATHEUS GONCALVES 010.262.663-43", "-800.00", "1.1.4.06"), // repetido após normalizar
    ex("PIX RECEBIDO MATHEUS27/10 MATHEUS GONCALVES", "1000.00", "2.1.5.07"),
    ex("TAR PLANO ADAPT 1 02/26", "-89.00", "2.1.1.01"),
    ex("RENDIMENTOS REND PAGO APLIC AUT MAIS", "0.50", "1.1.1.03"),
    ex("BOLETO PAGO BANCO BV S.A", "-1200.00", "2.1.1.01"),
  ];

  it("traz os mais parecidos primeiro, prefere o mesmo sinal e deduplica", () => {
    const r = selecionarExemplos(pool, [{ memo: "PIX ENVIADO MATHEUS GONC 12/11", valor: "-300.00" }], { porAlvo: 2, recentes: 0 });
    expect(r.map((e) => e.contaCodigo)).toEqual(["1.1.4.06", "2.1.5.07"]);
    expect(r).toHaveLength(2);
  });

  it("mesmo sinal ganha de memo igualmente parecido com sinal oposto", () => {
    const p = [ex("PIX MATHEUS", "100.00", "A"), ex("PIX MATHEUS", "-100.00", "B")];
    expect(selecionarExemplos(p, [{ memo: "PIX MATHEUS", valor: "-5.00" }], { porAlvo: 1, recentes: 0 })[0].contaCodigo).toBe("B");
  });

  it("une os de cada transação e completa com recentes, respeitando o teto", () => {
    const alvos = [{ memo: "TAR PLANO ADAPT 1 03/26", valor: "-89.00" }, { memo: "RENDIMENTOS REND PAGO APLIC", valor: "0.20" }];
    const r = selecionarExemplos(pool, alvos, { porAlvo: 1, recentes: 1 });
    expect(r.map((e) => e.memo)).toEqual([pool[0].memo, pool[3].memo, pool[4].memo]); // recente + 1 por alvo, na ordem do pool
    expect(selecionarExemplos(pool, alvos, { porAlvo: 3, recentes: 5, max: 4 })).toHaveLength(4);
  });

  it("sem semelhantes, só os recentes", () => {
    expect(selecionarExemplos(pool, [{ memo: "XYZ", valor: "1" }], { recentes: 2 }).map((e) => e.memo)).toEqual([pool[0].memo, pool[2].memo]);
  });
});
