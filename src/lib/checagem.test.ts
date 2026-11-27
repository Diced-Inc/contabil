import { describe, expect, it } from "vitest";
import { mesesSemLancamento, mesesSocioSemProLabore, naturezaInvertida, regrasPatrimoniais, resumir } from "./checagem";

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

describe("regrasPatrimoniais", () => {
  const l = (codigo: string, nome: string, natureza: "D" | "C", saldoAtual: string, papel: string | null = null) =>
    ({ id: codigo, codigo, nome, natureza, tipo: "analitica" as const, saldoAtual, papel });
  const base = { base: "/e/x", ano: 2026 };
  const st = (r: ReturnType<typeof regrasPatrimoniais>, id: string) => r.find((i) => i.id === id);
  // cenário TAVAPPS: Ativo credor e balanço fechando por compensação
  const tav = [
    l("1", "ATIVO", "D", "0.00"), l("1.1", "ATIVO CIRCULANTE", "D", "0.00"), l("2.3", "PATRIMÔNIO LÍQUIDO", "C", "0.00"),
    l("1.1.1.02", "Bancos Conta Movimento", "D", "50000.00"),
    l("1.1.1.03", "Aplicações Financeiras", "D", "-10.00"),
    l("1.1.2.01", "Clientes", "D", "-1680390.47", "clientes"),
    l("1.1.4.06", "Adiantamentos a sócios", "D", "1383015.06"),
    l("1.1.5", "Transferencias entre contas bancarias", "D", "-414989.89", "transferencias"),
    l("2.1.1.01", "Fornecedores Nacionais", "C", "720454.85", "fornecedores"),
    l("2.1.3.01", "Simples Nacional a Recolher", "C", "300.00"),
    l("2.1.2.03", "Cheque Especial", "C", "5.00"),
    l("2.3.1.01", "Capital Subscrito", "C", "0.00"),
  ].map((x) => (x.codigo.split(".").length < 3 ? { ...x, tipo: "sintetica" as const } : x));
  const r = regrasPatrimoniais(tav, {
    ...base, totais: { ativo: -71350643, passivoPl: 71350643, fecha: true },
    semPar: [{ data: "2026-04-01", valor: "-1000.00", memo: "PIX ENVIADO TAVAPPS", contaBancariaNome: "Inter" }],
  });

  it("Ativo credor e Passivo+PL devedor são erro; balanço que fecha por compensação não fica verde", () => {
    expect(st(r, "ativo-credor")?.status).toBe("erro");
    expect(st(r, "ativo-credor")?.itens?.map((i) => i.texto.split(" ")[0])).toEqual(["1.1.2.01", "1.1.5", "1.1.1.03"]);
    expect(st(r, "passivo-devedor")?.status).toBe("erro");
    expect(st(r, "balanco")?.status).toBe("alerta");
  });
  it("contas de papel e grupos específicos", () => {
    expect(st(r, "clientes-credor")).toMatchObject({ status: "alerta", itens: [{ texto: "1.1.2.01 Clientes: saldo credor de R$ 1.680.390,47" }] });
    expect(st(r, "fornecedores-devedor")?.status).toBe("alerta");
    expect(st(r, "aplicacoes-credor")?.status).toBe("erro");
    expect(st(r, "impostos-devedor")?.itens).toHaveLength(1);
    expect(st(r, "adiantamento-socios")?.status).toBe("alerta");
    expect(st(r, "capital-social")?.status).toBe("alerta");
    const t = st(r, "transferencias")!;
    expect(t.status).toBe("alerta");
    expect(t.link).toBe("/e/x/conciliacao?ver=transferencias");
    expect(t.itens?.filter((i) => i.grupo === "Sem par")).toHaveLength(1);
  });
  it("natureza invertida: só as que não caíram numa regra específica, agrupadas", () => {
    expect(st(r, "natureza")?.itens).toEqual([{ texto: "2.1.2.03 Cheque Especial: saldo devedor de R$ 5,00", link: "/e/x/relatorios/razao?ano=2026&conta=2.1.2.03", grupo: "2.1" }]);
  });
  it("empresa saudável: tudo ok", () => {
    const ok = regrasPatrimoniais([
      l("1.1.1.02", "Bancos", "D", "100.00"), l("2.3.1.01", "Capital Subscrito", "C", "-100.00"),
      l("1.1.5.01", "Transferências entre Contas", "D", "0.00", "transferencias"),
    ], { ...base, totais: { ativo: 10000, passivoPl: -10000, fecha: true } });
    expect(ok.filter((i) => i.status !== "ok").map((i) => i.id)).toEqual([]);
  });
});
