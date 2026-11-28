import { describe, expect, it } from "vitest";
import { itemSaldoBanco, itemSaldoInicial, mesesSemLancamento, mesesSocioSemProLabore, naturezaInvertida, regrasPatrimoniais, resumir } from "./checagem";
import { cents, fromCents } from "./format";
import { diferencaSaldoBanco } from "./saldo-dia";

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
  it("item que falha descreve o problema; o que passa mantém o texto positivo", () => {
    expect(st(r, "ativo-credor")?.titulo).toBe("Ativo total com saldo credor");
    expect(st(r, "passivo-devedor")?.titulo).toBe("Passivo + PL com saldo devedor");
    expect(st(r, "balanco")?.titulo).toBe("Balanço fecha só porque saldos invertidos se compensam");
    expect(st(r, "capital-social")?.titulo).toBe("Capital social não registrado");
    expect(st(r, "transferencias")?.titulo).toBe("Transferências entre contas com saldo (sem par)");
    expect(st(r, "clientes-credor")?.titulo).toBe("Clientes com saldo credor");
    const ok = regrasPatrimoniais([
      l("1.1.1.02", "Bancos", "D", "100.00"), l("2.3.1.01", "Capital Subscrito", "C", "-100.00"),
      l("1.1.2.01", "Clientes", "D", "0.00", "clientes"),
    ], { ...base, totais: { ativo: 10000, passivoPl: -10000, fecha: true } });
    expect(st(ok, "ativo-credor")?.titulo).toBe("Ativo total com saldo devedor");
    expect(st(ok, "clientes-credor")?.titulo).toBe("Clientes sem saldo credor");
    expect(st(ok, "capital-social")?.titulo).toBe("Capital social registrado");
    // nenhum item reprovado usa o mesmo título do aprovado
    for (const id of ["ativo-credor", "passivo-devedor", "balanco", "clientes-credor", "fornecedores-devedor", "aplicacoes-credor",
      "impostos-devedor", "adiantamento-socios", "capital-social", "natureza"]) {
      if (st(r, id)?.status !== "ok") expect(st(r, id)?.titulo, id).not.toBe(st(ok, id)?.titulo);
    }
  });
});

describe("saldo do banco × OFX", () => {
  // TAVAPPS: OFX R$ 0,27, contábil R$ 0,27, 102 linhas "SALDO TOTAL DISPONÍVEL DIA" ignoradas somando ~R$ 607 mil
  const linhasSaldo = Array.from({ length: 102 }, (_, i) => ({ valor: fromCents(500_000 + i * 1_000 + 17), status: "ignorada" as const }));
  const ignoradas = linhasSaldo.reduce((s, l) => s + cents(l.valor), 0);
  const b = (saldoContabil: string, pendentes: string) => {
    const diferenca = fromCents(diferencaSaldoBanco({ saldoOfx: 27, saldoContabil: cents(saldoContabil), pendentes: cents(pendentes) }));
    return { id: "itau", nome: "Itau Tavapps", saldoOfx: "0.27", saldoContabil, pendentes, diferenca, dataSaldo: "2026-11-25" };
  };
  it("linhas ignoradas não entram: contábil igual ao OFX confere", () => {
    expect(ignoradas).toBeGreaterThan(50_000_000);
    expect(diferencaSaldoBanco({ saldoOfx: 27, saldoContabil: 27, pendentes: 0 })).toBe(0);
    const i = itemSaldoBanco(b("0.27", "0.00"), "/e/x", "2026-11-27");
    expect(i).toMatchObject({ status: "ok", titulo: "Saldo bancário confere: Itau Tavapps" });
    expect(i.detalhe).not.toMatch(/607/);
  });
  it("pendentes aparecem à parte e explicam a diferença", () => {
    const i = itemSaldoBanco(b("100.27", "-100.00"), "/e/x", "2026-11-27");
    expect(i.status).toBe("alerta");
    expect(i.titulo).toMatch(/depois de conciliar as pendentes/);
    expect(i.detalhe).toContain("pendentes (R$ -100,00)");
  });
  it("diferença sem explicação: não confere", () => {
    const i = itemSaldoBanco(b("10.27", "0.00"), "/e/x", "2026-11-27");
    expect(i).toMatchObject({ status: "alerta", titulo: "Saldo bancário não confere: Itau Tavapps" });
    expect(i.detalhe).toContain("sobram R$ -10,00");
  });
});

describe("itemSaldoInicial", () => {
  it("alerta só com movimento e sem abertura ativa", () => {
    expect(itemSaldoInicial("2025-01-03", null, "/e/x")).toMatchObject({ status: "alerta", titulo: "Sem saldos iniciais", link: "/e/x/lancamentos/saldos-iniciais" });
    expect(itemSaldoInicial("2025-01-03", { data: "2024-12-31" }, "/e/x")).toMatchObject({ status: "ok", detalhe: "Abertura em 31/12/2024." });
    expect(itemSaldoInicial(null, null, "/e/x").status).toBe("ok");
  });
});
