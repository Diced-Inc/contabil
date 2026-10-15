import { describe, expect, it } from "vitest";
import { cents, fmtCnpj, fmtCompetencia, fmtSaldoDC, fmtValor } from "./format";

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
});
