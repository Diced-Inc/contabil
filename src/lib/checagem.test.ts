import { describe, expect, it } from "vitest";
import { mesesSemLancamento, mesesSocioSemProLabore, naturezaInvertida, resumir } from "./checagem";

const conta = (codigo: string, nome: string, natureza: "D" | "C", saldoAtual: string, tipo: "analitica" | "sintetica" = "analitica") => ({
  id: codigo, codigo, nome, natureza, tipo, saldoAtual,
});

describe("naturezaInvertida", () => {
  it("pega devedora credora e credora devedora, ignora retificadora, sintética e zero", () => {
    const r = naturezaInvertida([
      conta("1.1.1", "Caixa", "D", "-10.00"),
      conta("1.1.2", "Banco", "D", "50.00"),
      conta("2.1.1", "Fornecedores", "C", "5.00"),
      conta("2.1.2", "Salários a pagar", "C", "-5.00"),
      conta("1.2.9", "(-) Depreciação acumulada", "C", "-300.00"),
      conta("1.2.8", " (-) Provisão", "D", "-1.00"),
      conta("1", "Ativo", "D", "-99.00", "sintetica"),
      conta("1.1.3", "Aplicação", "D", "0.00"),
    ]);
    expect(r.map((c) => c.codigo)).toEqual(["1.1.1", "2.1.1"]);
  });
});

describe("mesesSemLancamento", () => {
  it("lista meses sem lançamento até a data limite", () => {
    expect(mesesSemLancamento(2026, ["2026-01-01", "2026-03-01"], "2026-04-15")).toEqual(["2026-02-01", "2026-04-01"]);
  });
  it("ano inteiro quando a data limite é 31/12", () => {
    expect(mesesSemLancamento(2025, [], "2025-12-31")).toHaveLength(12);
  });
});

describe("mesesSocioSemProLabore", () => {
  it("só meses com saída a sócio e sem pró-labore", () => {
    expect(
      mesesSocioSemProLabore([
        { mes: "2026-01-01", socio: 100, proLabore: 0 },
        { mes: "2026-02-01", socio: 100, proLabore: 50 },
        { mes: "2026-03-01", socio: 0, proLabore: 0 },
      ]),
    ).toEqual(["2026-01-01"]);
  });
});

describe("resumir", () => {
  it("conta por status", () => {
    const i = (status: "ok" | "alerta" | "erro") => ({ id: status, titulo: "", detalhe: "", status });
    expect(resumir([i("ok"), i("ok"), i("erro"), i("alerta")])).toEqual({ ok: 2, alerta: 1, erro: 1 });
  });
});
