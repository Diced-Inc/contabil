import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cents, fmtCnpj, fmtCpf, fmtDataExtenso, fmtCompetencia, fmtSaldoDC, fmtValor, hoje, isoData, lerAno, parseValorBR, valorParaInput,
} from "./format";

describe("format", () => {
  it("fmtSaldoDC", () => {
    expect(fmtSaldoDC("1234.5", "D")).toBe("1.234,50D");
    expect(fmtSaldoDC("-10", "D")).toBe("10,00C");
    expect(fmtSaldoDC("0", "C")).toBe("0,00C");
  });
  it("cents soma sem erro de ponto flutuante", () => {
    expect(cents("0.1") + cents("0.2")).toBe(30);
  });
  it("fmtValor, fmtCnpj, fmtCompetencia", () => {
    expect(fmtValor("-1234.5")).toBe("-1.234,50");
    expect(fmtCnpj("12345678000195")).toBe("12.345.678/0001-95");
    expect(fmtCompetencia("2026-03-01")).toBe("03/2026");
  });
  it("fmtCpf e fmtDataExtenso", () => {
    expect(fmtCpf("04135465358")).toBe("041.354.653-58");
    expect(fmtDataExtenso("2025-12-31")).toBe("31 de dezembro de 2025");
    expect(fmtDataExtenso("2026-03-05")).toBe("5 de março de 2026");
  });
  it("parseValorBR e valorParaInput", () => {
    expect(parseValorBR("1.234,56")).toBe("1234.56");
    expect(parseValorBR(" 10,5 ")).toBe("10.5");
    expect(parseValorBR("1234.56")).toBe("1234.56");
    expect(parseValorBR("")).toBe("");
    expect(valorParaInput("1234.5")).toBe("1234,50");
    expect(valorParaInput("0.00")).toBe("");
  });
});

describe("datas", () => {
  afterEach(() => vi.useRealTimers());
  it("hoje() em São Paulo, não em UTC", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-16T01:30:00Z")); // 22h30 do dia 15 em SP
    expect(hoje()).toBe("2026-10-15");
    expect(lerAno(undefined)).toBe(2026);
  });
  it("isoData e lerAno rejeitam lixo sem lançar", () => {
    expect(isoData("2026-02-28")).toBe("2026-02-28");
    for (const x of ["2026-02-30", "2026-13-01", "abc", ["2026-01-01"], undefined]) expect(isoData(x)).toBeUndefined();
    expect(lerAno("2025")).toBe(2025);
    for (const x of ["99999", "20x5", "", ["2025"]]) expect(lerAno(x)).toBe(Number(hoje().slice(0, 4)));
  });
});
