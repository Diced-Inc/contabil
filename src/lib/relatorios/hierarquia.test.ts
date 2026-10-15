import { describe, expect, it } from "vitest";
import type { LinhaSaldo } from "./saldos";
import { agregar, comMovimento, compararCodigo, nivel } from "./hierarquia";

function linha(codigo: string, tipo: LinhaSaldo["tipo"], v: Partial<LinhaSaldo> = {}): LinhaSaldo {
  return {
    id: codigo, codigo, nome: codigo, natureza: "D", tipo, parentId: null, grupoDre: null,
    saldoAnterior: "0.00", debitos: "0.00", creditos: "0.00", saldoAtual: "0.00", ...v,
  };
}

describe("hierarquia", () => {
  it("nivel conta segmentos", () => {
    expect(nivel("1")).toBe(1);
    expect(nivel("1.1.2.01")).toBe(4);
  });

  it("ordena código numericamente", () => {
    const cs = ["1.1.10", "1.1.2", "1", "1.1", "2", "1.10"].sort(compararCodigo);
    expect(cs).toEqual(["1", "1.1", "1.1.2", "1.1.10", "1.10", "2"]);
  });

  it("soma analíticas no pai e no avô, preservando ordem", () => {
    const r = agregar([
      linha("1.1.10", "analitica", { debitos: "5.00", saldoAtual: "5.00" }),
      linha("1", "sintetica"),
      linha("1.1", "sintetica"),
      linha("1.1.2", "analitica", { saldoAnterior: "100.10", debitos: "10.00", creditos: "3.00", saldoAtual: "107.10" }),
      linha("2", "sintetica"),
    ]);
    expect(r.map((l) => l.codigo)).toEqual(["1", "1.1", "1.1.2", "1.1.10", "2"]);
    for (const c of ["1", "1.1"]) {
      expect(r.find((l) => l.codigo === c)).toMatchObject({
        saldoAnterior: "100.10", debitos: "15.00", creditos: "3.00", saldoAtual: "112.10",
      });
    }
    expect(r.find((l) => l.codigo === "2")?.saldoAtual).toBe("0.00");
  });

  it("comMovimento descarta linhas zeradas", () => {
    const r = comMovimento([linha("1", "sintetica"), linha("1.1", "analitica", { creditos: "1.00", saldoAtual: "-1.00" })]);
    expect(r.map((l) => l.codigo)).toEqual(["1.1"]);
  });
});
