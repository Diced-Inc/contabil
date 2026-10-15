import { describe, expect, it } from "vitest";
import { validarPartidas } from "./lancamentos";
import { partidasBaixa } from "./titulos";

const BANCO = "11111111-1111-4111-8111-111111111111";
const PAPEL = "22222222-2222-4222-8222-222222222222";
const DIF = "33333333-3333-4333-8333-333333333333";
const base = { contaBancoId: BANCO, contaPapelId: PAPEL, contaDiferencaId: DIF };

describe("partidasBaixa", () => {
  it("valor exato: duas partidas", () => {
    expect(partidasBaixa({ ...base, tipo: "receber", valorTitulo: "100.00", valorPago: "100" })).toEqual([
      { contaId: BANCO, debito: "100.00" },
      { contaId: PAPEL, credito: "100.00" },
    ]);
  });
  it("receber com desconto: D diferença", () => {
    const ps = partidasBaixa({ ...base, tipo: "receber", valorTitulo: "100.00", valorPago: "95.50" });
    expect(ps).toContainEqual({ contaId: DIF, debito: "4.50" });
    expect(ps).toContainEqual({ contaId: BANCO, debito: "95.50" });
  });
  it("receber com juros: C diferença", () => {
    expect(partidasBaixa({ ...base, tipo: "receber", valorTitulo: "100.00", valorPago: "102.30" })).toContainEqual({
      contaId: DIF,
      credito: "2.30",
    });
  });
  it("pagar espelhado", () => {
    expect(partidasBaixa({ ...base, tipo: "pagar", valorTitulo: "100.00", valorPago: "100.00" })).toEqual([
      { contaId: PAPEL, debito: "100.00" },
      { contaId: BANCO, credito: "100.00" },
    ]);
    expect(partidasBaixa({ ...base, tipo: "pagar", valorTitulo: "100.00", valorPago: "90" })).toContainEqual({
      contaId: DIF,
      credito: "10.00",
    });
    expect(partidasBaixa({ ...base, tipo: "pagar", valorTitulo: "100.00", valorPago: "110" })).toContainEqual({
      contaId: DIF,
      debito: "10.00",
    });
  });
  it("diferença sem conta é erro", () => {
    expect(() =>
      partidasBaixa({ ...base, contaDiferencaId: null, tipo: "receber", valorTitulo: "100", valorPago: "99" }),
    ).toThrow(/conta da diferença/);
  });
  it("valor pago zero é erro", () => {
    expect(() => partidasBaixa({ ...base, tipo: "pagar", valorTitulo: "100", valorPago: "0" })).toThrow(/maior que zero/);
  });
  it("sempre balanceado", () => {
    for (const tipo of ["receber", "pagar"] as const)
      for (const valorPago of ["0.01", "33.33", "100", "100.01", "1234.56"])
        expect(() => validarPartidas(partidasBaixa({ ...base, tipo, valorTitulo: "100.00", valorPago }))).not.toThrow();
  });
});
