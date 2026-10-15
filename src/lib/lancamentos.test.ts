import { describe, expect, it } from "vitest";
import { validarPartidas } from "./lancamentos";

const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";

describe("validarPartidas", () => {
  it("balanceado devolve total em centavos", () => {
    expect(validarPartidas([{ contaId: C1, debito: "100.50" }, { contaId: C2, credito: "100.50" }])).toEqual({ total: 10050 });
  });
  it("uma partida só é erro", () => {
    expect(() => validarPartidas([{ contaId: C1, debito: "10" }])).toThrow(/duas partidas/);
  });
  it("débitos diferentes de créditos é erro", () => {
    expect(() => validarPartidas([{ contaId: C1, debito: "10" }, { contaId: C2, credito: "9.99" }])).toThrow(/desbalanceado/);
  });
  it("partida com débito e crédito é erro", () => {
    expect(() => validarPartidas([{ contaId: C1, debito: "10", credito: "10" }, { contaId: C2, credito: "0" }])).toThrow(/OU/);
  });
  it("partida zerada é erro", () => {
    expect(() => validarPartidas([{ contaId: C1, debito: "" }, { contaId: C2, credito: "0" }])).toThrow(/OU/);
  });
  it("0.10 + 0.20 balanceia com 0.30 (centavos)", () => {
    expect(
      validarPartidas([{ contaId: C1, debito: "0.10" }, { contaId: C1, debito: "0.20" }, { contaId: C2, credito: "0.30" }]),
    ).toEqual({ total: 30 });
  });
});
