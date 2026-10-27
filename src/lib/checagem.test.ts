import { describe, expect, it } from "vitest";
import { mesesSemLancamento, mesesSocioSemProLabore, naturezaInvertida, resumir } from "./checagem";

const conta = (codigo: string, nome: string, natureza: "D" | "C", saldoAtual: string, tipo: "analitica" | "sintetica" = "analitica") => ({
  id: codigo, codigo, nome, natureza, tipo, saldoAtual,
});

describe("naturezaInvertida", () => {
  it("pega devedora credora e credora devedora, ignora sintética e zero", () => {
    const r = naturezaInvertida([
      conta("1.1.1", "Caixa", "D", "-10.00"),
      conta("1.1.2", "Banco", "D", "50.00"),
      conta("2.1.1", "Fornecedores", "C", "5.00"),
      conta("2.1.2", "Salários a pagar", "C", "-5.00"),
      conta("1", "Ativo", "D", "-99.00", "sintetica"),
      conta("1.1.3", "Aplicação", "D", "0.00"),
    ]);
    expect(r.map((c) => c.codigo)).toEqual(["1.1.1", "2.1.1"]);
  });
  it("retificadora segue a própria natureza: credora com saldo devedor é invertida", () => {
    const r = naturezaInvertida([
      conta("1.2.9", "(-) Depreciação acumulada", "C", "-300.00"),
      conta("1.1.9", "(-) PCLD", "C", "40.00"),
    ]);
    expect(r.map((c) => c.codigo)).toEqual(["1.1.9"]);
  });
});

describe("mesesSemLancamento", () => {
  const p = { ate: "2026-04-15", inicio: "2020-01-01", hoje: "2026-04-15" };
  it("lista meses sem lançamento até a data limite", () => {
    expect(mesesSemLancamento(2026, ["2026-01-01", "2026-03-01"], p)).toEqual(["2026-02-01", "2026-04-01"]);
  });
  it("ano inteiro quando a data limite é 31/12", () => {
    expect(mesesSemLancamento(2025, [], { ate: "2025-12-31", inicio: "2024-06-01", hoje: "2026-04-15" })).toHaveLength(12);
  });
  it("começa no mês do primeiro movimento da empresa", () => {
    expect(mesesSemLancamento(2026, ["2026-03-01"], { ...p, inicio: "2026-02-20" })).toEqual(["2026-02-01", "2026-04-01"]);
  });
  it("pula o mês corrente antes do dia 10", () => {
    expect(mesesSemLancamento(2026, ["2026-03-01"], { ...p, ate: "2026-04-09", hoje: "2026-04-09" })).toEqual(["2026-01-01", "2026-02-01"]);
  });
});

describe("mesesSocioSemProLabore", () => {
  const l = (mes: string, socio: number, proLabore: number, origem = "manual", status: "aprovado" | "estornado" = "aprovado") =>
    ({ mes, socio, proLabore, origem, status });
  it("só meses com saída a sócio e sem pró-labore", () => {
    expect(
      mesesSocioSemProLabore([l("2026-01-01", 100, 0), l("2026-02-01", 100, 0), l("2026-02-01", 0, 50), l("2026-03-01", 0, 0)]),
    ).toEqual(["2026-01-01"]);
  });
  it("ignora original estornado e o estorno (o pró-labore estornado não conta)", () => {
    expect(
      mesesSocioSemProLabore([
        l("2026-01-01", 100, 0, "manual", "estornado"),
        l("2026-01-01", 100, 0, "estorno"),
        l("2026-02-01", 100, 0),
        l("2026-02-01", 0, 50, "manual", "estornado"),
        l("2026-02-01", 0, 50, "estorno"),
      ]),
    ).toEqual(["2026-02-01"]);
  });
});

describe("resumir", () => {
  it("conta por status", () => {
    const i = (status: "ok" | "alerta" | "erro") => ({ id: status, titulo: "", detalhe: "", status });
    expect(resumir([i("ok"), i("ok"), i("erro"), i("alerta")])).toEqual({ ok: 2, alerta: 1, erro: 1 });
  });
});
