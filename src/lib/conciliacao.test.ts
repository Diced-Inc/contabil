import { describe, expect, it } from "vitest";
import { partidasClassificacao } from "./conciliacao";
import { padraoComum } from "./classificacao/regras";
import { validarPartidas } from "./lancamentos";

describe("partidasClassificacao", () => {
  it("entrada: D banco / C contrapartidas", () => {
    const ps = partidasClassificacao("150.10", "banco", [{ contaId: "rec", valor: "150.10" }]);
    expect(ps).toEqual([{ contaId: "banco", debito: "150.10" }, { contaId: "rec", credito: "150.10" }]);
    expect(validarPartidas(ps).total).toBe(15010);
  });

  it("saída dividida: D contrapartidas / C banco", () => {
    const ps = partidasClassificacao("-1000.00", "banco", [
      { contaId: "emprestimo", valor: "900.01" },
      { contaId: "juros", valor: "99.99" },
    ]);
    expect(ps.at(-1)).toEqual({ contaId: "banco", credito: "1000.00" });
    expect(ps.slice(0, 2).every((p) => p.debito)).toBe(true);
    expect(validarPartidas(ps).total).toBe(100000);
  });

  it("rejeita soma diferente, valor zero e a própria conta do banco", () => {
    expect(() => partidasClassificacao("-10.00", "b", [{ contaId: "x", valor: "9.99" }])).toThrow(/difere/);
    expect(() => partidasClassificacao("10.00", "b", [{ contaId: "x", valor: "0" }])).toThrow(/maior que zero/);
    expect(() => partidasClassificacao("10.00", "b", [{ contaId: "b", valor: "10" }])).toThrow(/própria conta/);
    expect(() => partidasClassificacao("10.00", "b", [])).toThrow();
  });
});

describe("padraoComum", () => {
  it("usa o prefixo comum quando tem ao menos 6 caracteres", () => {
    expect(padraoComum(["PIX ENVIADO 123.456 JOAO", "PIX ENVIADO 123.456 MARIA"])).toBe("PIX ENVIADO 123.456");
  });
  it("cai no primeiro memo quando o prefixo é curto", () => {
    expect(padraoComum(["PIX JOAO", "PIX MARIA"])).toBe("PIX JOAO");
    expect(padraoComum([])).toBe("");
  });
});
