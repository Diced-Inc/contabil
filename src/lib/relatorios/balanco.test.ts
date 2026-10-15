import { describe, expect, it } from "vitest";
import type { LinhaSaldo } from "./saldos";
import { montarBalanco } from "./balanco";

const l = (codigo: string, tipo: LinhaSaldo["tipo"], saldoAtual = "0.00", natureza: "D" | "C" = "D"): LinhaSaldo => ({
  id: codigo, codigo, nome: codigo, natureza, tipo, parentId: null, grupoDre: null,
  saldoAnterior: "0.00", debitos: "0.00", creditos: "0.00", saldoAtual,
});
const plano = (ativo: string, capital: string, receita: string) => [
  l("1", "sintetica"), l("1.1", "sintetica"), l("1.1.1", "analitica", ativo),
  l("2", "sintetica", "0.00", "C"), l("2.3", "sintetica", "0.00", "C"), l("2.3.1", "analitica", capital, "C"),
  l("3", "sintetica", "0.00", "C"), l("3.1", "analitica", receita, "C"),
];

describe("montarBalanco", () => {
  it("fecha com resultado zero e sem linha virtual", () => {
    const b = montarBalanco(plano("1000.00", "-1000.00", "0.00"), [], false, false);
    expect(b.atual).toEqual({ ativo: 100000, passivoPl: -100000, fecha: true });
    expect(b.linhas.some((x) => x.virtual)).toBe(false);
    expect(b.linhas.some((x) => x.codigo.startsWith("3"))).toBe(false);
  });

  it("resultado não apurado entra no PL como linha virtual", () => {
    const b = montarBalanco(plano("500.00", "0.00", "-500.00"), plano("0.00", "0.00", "0.00"), false, false);
    const v = b.linhas.find((x) => x.virtual)!;
    expect(v).toMatchObject({ codigo: "2.3.9", nome: "Resultado do exercício", natureza: "C", atual: "-500.00", anterior: "0.00" });
    expect(b.linhas.find((x) => x.codigo === "2.3")?.atual).toBe("-500.00");
    expect(b.linhas.map((x) => x.codigo)).toEqual(["1", "1.1", "1.1.1", "2", "2.3", "2.3.9"]);
    expect(b.atual).toEqual({ ativo: 50000, passivoPl: -50000, fecha: true });
    expect(b.anterior.fecha).toBe(true);
  });

  it("exercício apurado não ganha linha virtual", () => {
    const b = montarBalanco(plano("500.00", "0.00", "-500.00"), [], true, false);
    expect(b.linhas.some((x) => x.virtual)).toBe(false);
    expect(b.atual).toEqual({ ativo: 50000, passivoPl: 0, fecha: false });
  });
});
