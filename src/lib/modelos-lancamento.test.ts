import { describe, expect, it } from "vitest";
import { PLANO_ITG1000 } from "@/db/seed-plano";
import { aplicarModelo, MODELOS, type Modelo, type Parametros } from "./modelos-lancamento";

// plano do seed, id = código (as partidas saem legíveis)
const contas = PLANO_ITG1000.map(([codigo, nome, , , papel]) => ({ id: codigo, codigo, nome, papel: papel ?? null }));
const modelo = (id: string) => MODELOS.find((m) => m.id === id) as Extract<Modelo, { montar: unknown }>;
const p = (x: Partial<Parametros>): Parametros => ({ valor: 0, irrf: 0, tributo: "simples", ...x });
const resumo = (id: string, x: Partial<Parametros>, cs = contas) => {
  const r = aplicarModelo(modelo(id), p(x), cs);
  return { faltando: r.faltando, partidas: r.partidas.map((q) => `${q.contaId || "?"} ${q.debito ? `D ${q.debito}` : `C ${q.credito}`}`) };
};

describe("modelos de lançamento", () => {
  it("depreciação mensal", () => {
    expect(resumo("depreciacao", { valor: 12345 })).toEqual({ faltando: [], partidas: ["3.2.2.09 D 123.45", "1.3.3.07 C 123.45"] });
  });
  it("provisão de impostos: sobre a receita em deduções, sobre o lucro em despesa", () => {
    expect(resumo("provisao-impostos", { valor: 1000, tributo: "simples" }).partidas).toEqual(["3.1.1.04 D 10.00", "2.1.3.01 C 10.00"]);
    expect(resumo("provisao-impostos", { valor: 1000, tributo: "iss" }).partidas).toEqual(["3.1.1.04 D 10.00", "2.1.3.03 C 10.00"]);
    expect(resumo("provisao-impostos", { valor: 1000, tributo: "csll" }).partidas).toEqual(["3.2.5.02 D 10.00", "2.1.3.09 C 10.00"]);
  });
  it("pró-labore: bruto, INSS 11%, IRRF opcional e líquido fecham", () => {
    expect(resumo("pro-labore", { valor: 500000 }).partidas).toEqual(["3.2.2.02 D 5000.00", "2.1.4.04 C 550.00", "2.1.4.02 C 4450.00"]);
    expect(resumo("pro-labore", { valor: 500000, irrf: 12345 }).partidas)
      .toEqual(["3.2.2.02 D 5000.00", "2.1.4.04 C 550.00", "2.1.3.04 C 123.45", "2.1.4.02 C 4326.55"]);
    expect(() => resumo("pro-labore", { valor: 1000, irrf: 1000 })).toThrow(/passam do pró-labore/);
  });
  it("distribuição de lucros e compensação de adiantamento a sócios", () => {
    expect(resumo("distribuicao-lucros", { valor: 100 }).partidas).toEqual(["2.3.3.03 D 1.00", "2.1.5.06 C 1.00"]);
    expect(resumo("compensacao-adiantamento-socio", { valor: 100 }).partidas).toEqual(["2.3.3.03 D 1.00", "1.1.4.06 C 1.00"]);
  });
  it("ajuste: duas contas em branco para escolher", () => {
    expect(resumo("ajuste", { valor: 100 })).toEqual({ faltando: [], partidas: ["? D 1.00", "? C 1.00"] });
  });
  it("parcelamento é link para o formulário de Títulos", () => {
    const m = MODELOS.find((x) => x.id === "parcelamento")!;
    expect("link" in m && m.link("e1")).toBe("/e/e1/titulos?tipo=parcelamentos");
  });
  it("plano diferente: acha pelo nome no grupo; o que falta fica em branco e nomeado", () => {
    const outro = [
      { id: "x", codigo: "3.9.1", nome: "Depreciação", papel: null },
      { id: "y", codigo: "1.3.9.01", nome: "Depreciação Acumulada", papel: null },
    ];
    expect(resumo("depreciacao", { valor: 100 }, outro).partidas).toEqual(["? D 1.00", "y C 1.00"]);
    expect(resumo("depreciacao", { valor: 100 }, outro).faltando).toEqual(["Depreciação e Amortização (despesa)"]);
    expect(() => resumo("depreciacao", { valor: 0 })).toThrow(/valor/);
  });
});
