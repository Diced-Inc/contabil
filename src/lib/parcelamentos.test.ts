import { describe, expect, it } from "vitest";
import { validarPartidas } from "./lancamentos";
import { divisaoCpLp, montarParcelamento, parcelaSugerida, parcelasDoParcelamento, parcelasParaCurtoPrazo } from "./parcelamentos";
import { somarMeses } from "./format";

const base = {
  descricao: "Simples Nacional", principal: "10000", multa: "2000", juros: "1000.01", nParcelas: 24, valorParcela: "541.67",
  primeiroVencimento: "2025-03-31", data: "2025-03-10", contaPrincipalId: "simples", contaMultaId: "multa", contaJurosId: "juros",
  contaCpId: "cp", contaLpId: "lp",
};

describe("parcelasDoParcelamento", () => {
  it("n − 1 no valor e a última com o resto, somando o total em centavos", () => {
    const ps = parcelasDoParcelamento({ total: 1_300_001, n: 24, valorParcela: 54_167, primeiroVencimento: "2025-03-31" });
    expect(ps).toHaveLength(24);
    expect(ps.reduce((s, x) => s + x.valor, 0)).toBe(1_300_001);
    expect(ps[23].valor).toBe(1_300_001 - 23 * 54_167);
    expect(ps.map((x) => x.vencimento).slice(0, 3)).toEqual(["2025-03-31", "2025-04-30", "2025-05-31"]);
  });
  it("parcelas que passam do total recusam", () => {
    expect(() => parcelasDoParcelamento({ total: 1000, n: 3, valorParcela: 500, primeiroVencimento: "2025-01-10" })).toThrow(/passam da dívida/);
  });
  it("parcela sugerida divide igual", () => expect(parcelaSugerida(1_300_001, 24)).toBe(54_167));
});

describe("divisão CP/LP", () => {
  const ps = (n: number) => parcelasDoParcelamento({ total: n * 100, n, valorParcela: 100, primeiroVencimento: "2025-01-10" });
  it("12 parcelas: tudo no curto prazo", () => expect(divisaoCpLp(ps(12))).toEqual({ cp: 1200, lp: 0 }));
  it("13 parcelas: 12 no CP e 1 no LP", () => expect(divisaoCpLp(ps(13))).toEqual({ cp: 1200, lp: 100 }));
  it("menos de 12: tudo no CP", () => expect(divisaoCpLp(ps(5))).toEqual({ cp: 500, lp: 0 }));
  it("60 parcelas: 12 no CP e 48 no LP", () => expect(divisaoCpLp(ps(60))).toEqual({ cp: 1200, lp: 4800 }));
});

describe("montarParcelamento", () => {
  it("D principal + multa + juros / C CP + C LP, balanceado", () => {
    const m = montarParcelamento(base);
    expect(validarPartidas(m.partidas).total).toBe(1_300_001);
    expect(m.partidas).toEqual([
      { contaId: "simples", debito: "10000.00" }, { contaId: "multa", debito: "2000.00" }, { contaId: "juros", debito: "1000.01" },
      { contaId: "cp", credito: "6500.04" }, { contaId: "lp", credito: "6499.97" },
    ]);
  });
  it("sem multa/juros não pede as contas; sem LP não credita LP", () => {
    const m = montarParcelamento({ ...base, multa: "", juros: "0", nParcelas: 10, valorParcela: "1000", contaMultaId: null, contaJurosId: null });
    expect(m.partidas).toEqual([{ contaId: "simples", debito: "10000.00" }, { contaId: "cp", credito: "10000.00" }]);
  });
  it("multa sem conta recusa; CP = LP recusa", () => {
    expect(() => montarParcelamento({ ...base, contaMultaId: null })).toThrow(/conta da multa/);
    expect(() => montarParcelamento({ ...base, contaLpId: "cp" })).toThrow(/diferentes/);
  });
});

describe("transferir para o curto prazo", () => {
  const ps = parcelasDoParcelamento({ total: 2400, n: 24, valorParcela: 100, primeiroVencimento: "2025-03-31" })
    .map((x) => ({ id: `p${x.numero}`, vencimento: x.vencimento, contaId: x.numero <= 12 ? "cp" : "lp", saldo: x.valor }));
  it("no início a 13ª ainda é LP; um mês depois ela vence em até 12 meses", () => {
    expect(parcelasParaCurtoPrazo(ps, "lp", "2025-03-10").map((x) => x.id)).toEqual([]);
    expect(somarMeses("2025-03-31", 12)).toBe("2026-03-31");
    expect(parcelasParaCurtoPrazo(ps, "lp", "2025-03-31").map((x) => x.id)).toEqual(["p13"]);
    expect(parcelasParaCurtoPrazo(ps, "lp", "2025-04-15").map((x) => x.id)).toEqual(["p13"]);
  });
  it("seis meses depois: as que vencem até a data + 12 meses", () => {
    expect(parcelasParaCurtoPrazo(ps, "lp", "2025-08-31").map((x) => x.id)).toEqual(["p13", "p14", "p15", "p16", "p17", "p18"]);
  });
  it("segunda vez não move nada (já no CP); sem saldo fica", () => {
    const movidas = ps.map((x) => (["p13", "p14"].includes(x.id) ? { ...x, contaId: "cp" } : x));
    expect(parcelasParaCurtoPrazo(movidas, "lp", "2025-04-29").map((x) => x.id)).toEqual([]);
    expect(parcelasParaCurtoPrazo(ps.map((x) => ({ ...x, saldo: 0 })), "lp", "2026-12-31")).toEqual([]);
  });
});

describe("somarMeses", () => {
  it("limita o dia ao fim do mês e vira o ano", () => {
    expect(somarMeses("2025-01-31", 1)).toBe("2025-02-28");
    expect(somarMeses("2024-01-31", 1)).toBe("2024-02-29");
    expect(somarMeses("2025-11-15", 3)).toBe("2026-02-15");
  });
});
