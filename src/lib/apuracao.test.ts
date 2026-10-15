import { describe, expect, it } from "vitest";
import { partidasApuracao, type PartidaApuracao } from "./apuracao";
import { cents } from "./format";

const soma = (ps: PartidaApuracao[], k: "debito" | "credito") => ps.reduce((t, p) => t + cents(p[k] ?? 0), 0);

describe("partidasApuracao", () => {
  it("lucro: zera receita e despesa, credita lucros acumulados", () => {
    const r = partidasApuracao(
      [{ id: "rec", codigo: "3.1.1.01", saldo: "-1000.00" }, { id: "desp", codigo: "3.2.1.01", saldo: "300.00" }],
      "lucros", "prej",
    );
    expect(r.partidas).toEqual([
      { contaId: "rec", debito: "1000.00" },
      { contaId: "desp", credito: "300.00" },
      { contaId: "lucros", credito: "700.00" },
    ]);
    expect(r.resultado).toBe("700.00");
    expect(soma(r.partidas, "debito")).toBe(soma(r.partidas, "credito"));
  });

  it("prejuízo: debita prejuízos acumulados", () => {
    const r = partidasApuracao(
      [{ id: "rec", codigo: "3.1.1.01", saldo: "-300.00" }, { id: "desp", codigo: "3.2.1.01", saldo: "1000.00" }],
      "lucros", "prej",
    );
    expect(r.partidas).toEqual([
      { contaId: "rec", debito: "300.00" },
      { contaId: "desp", credito: "1000.00" },
      { contaId: "prej", debito: "700.00" },
    ]);
    expect(r.resultado).toBe("-700.00");
    expect(soma(r.partidas, "debito")).toBe(soma(r.partidas, "credito"));
  });

  it("sem saldos → vazio", () => {
    expect(partidasApuracao([], "l", "p")).toEqual({ partidas: [], resultado: "0.00" });
    expect(partidasApuracao([{ id: "x", codigo: "3.1.1.01", saldo: "0.00" }], "l", "p")).toEqual({ partidas: [], resultado: "0.00" });
  });

  it("ignora contas das classes 1 e 2", () => {
    const r = partidasApuracao(
      [
        { id: "caixa", codigo: "1.1.1.01", saldo: "500.00" },
        { id: "forn", codigo: "2.1.1.01", saldo: "-200.00" },
        { id: "rec", codigo: "3.1.1.01", saldo: "-50.10" },
      ],
      "l", "p",
    );
    expect(r.partidas.map((p) => p.contaId)).toEqual(["rec", "l"]);
    expect(r.resultado).toBe("50.10");
  });

  it("resultado zero com movimento: zera contas sem contrapartida e continua balanceado", () => {
    const r = partidasApuracao(
      [{ id: "rec", codigo: "3.1.1.01", saldo: "-100.00" }, { id: "desp", codigo: "3.2.1.01", saldo: "100.00" }],
      "l", "p",
    );
    expect(r.partidas).toHaveLength(2);
    expect(r.resultado).toBe("0.00");
    expect(soma(r.partidas, "debito")).toBe(soma(r.partidas, "credito"));
  });
});
