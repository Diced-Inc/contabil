import { describe, expect, it } from "vitest";
import type { LinhaSaldo } from "./saldos";
import { montarDre, umAnoAntes } from "./dre";

const conta = (codigo: string, grupoDre: string, debitos: string, creditos: string): LinhaSaldo => ({
  id: codigo, codigo, nome: `Conta ${codigo}`, natureza: "D", tipo: "analitica", parentId: null, grupoDre,
  saldoAnterior: "0.00", debitos, creditos, saldoAtual: "0.00",
});

const atual = [
  conta("3.1.1.01", "receita_bruta", "0.00", "10000.00"),
  conta("3.1.2.01", "deducoes", "600.00", "0.00"),
  conta("3.2.1.01", "custos", "2000.00", "0.00"),
  conta("3.3.1.01", "despesas_operacionais", "3000.00", "0.00"),
  conta("3.3.1.02", "despesas_operacionais", "0.00", "0.00"),
  { ...conta("3", "receita_bruta", "0.00", "99.00"), tipo: "sintetica" as const },
];
const anterior = [conta("3.1.1.01", "receita_bruta", "0.00", "500.00")];

describe("montarDre", () => {
  const d = montarDre(atual, anterior);
  const sub = (label: string) => d.find((l) => l.tipo === "subtotal" && l.label === label);

  it("subtotais do Anexo 3", () => {
    expect(sub("Receita líquida")).toMatchObject({ atual: "9400.00", anterior: "500.00" });
    expect(sub("Lucro bruto")?.atual).toBe("7400.00");
    expect(sub("Resultado antes do financeiro")?.atual).toBe("4400.00");
    expect(sub("Resultado financeiro")?.atual).toBe("0.00");
    expect(sub("Resultado antes dos tributos")?.atual).toBe("4400.00");
    expect(d.at(-1)).toMatchObject({ tipo: "subtotal", label: "Resultado líquido", atual: "4400.00", anterior: "500.00" });
  });

  it("ordem, sinais e contas sem valor omitidas", () => {
    expect(d.filter((l) => l.tipo !== "conta").map((l) => l.label)).toEqual([
      "Receita bruta", "Deduções", "Receita líquida", "Custos", "Lucro bruto",
      "Despesas operacionais", "Resultado antes do financeiro",
      "Receitas financeiras", "Despesas financeiras", "Resultado financeiro",
      "Outras receitas", "Outras despesas", "Resultado antes dos tributos",
      "Tributos sobre o lucro", "Resultado líquido",
    ]);
    const contas = d.filter((l) => l.tipo === "conta");
    expect(contas.map((c) => [c.codigo, c.atual])).toEqual([
      ["3.1.1.01", "10000.00"], ["3.1.2.01", "-600.00"], ["3.2.1.01", "-2000.00"], ["3.3.1.01", "-3000.00"],
    ]);
  });
});

describe("umAnoAntes", () => {
  it("trata 29/02", () => {
    expect(umAnoAntes("2028-02-29")).toBe("2027-02-28");
    expect(umAnoAntes("2026-12-31")).toBe("2025-12-31");
  });
});
