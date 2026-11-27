import { describe, expect, it } from "vitest";
import { normalizarMemo, selecionarExemplos } from "./exemplos";

const ex = (memo: string, valor: string, contaCodigo: string) => ({ memo, valor, contaCodigo });

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
