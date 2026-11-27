import { describe, expect, it } from "vitest";
import {
  adiantamentosAntigos, adiantamentosDoTitulo, documentoDoMemo, mesmaContraparte, partidasAdiantamento, partidasCompensacao,
  saldoAdiantamento, valorCompensacao,
} from "./adiantamentos";
import { cents } from "./format";
import { validarPartidas } from "./lancamentos";
import { dataReconhecimento, operacaoSugerida } from "./operacoes";

const saldo = (ps: { contaId: string; debito?: string; credito?: string }[], c: string) =>
  ps.filter((p) => p.contaId === c).reduce((s, p) => s + cents(p.debito || 0) - cents(p.credito || 0), 0);

describe("partidas", () => {
  it("de cliente: D Banco / C Adiantamentos de Clientes; a fornecedor: D Adiantamentos a Fornecedores / C Banco", () => {
    expect(partidasAdiantamento("cliente", "banco", "adc", "1500")).toEqual([{ contaId: "banco", debito: "1500.00" }, { contaId: "adc", credito: "1500.00" }]);
    expect(partidasAdiantamento("fornecedor", "banco", "adf", "-800.5")).toEqual([{ contaId: "adf", debito: "800.50" }, { contaId: "banco", credito: "800.50" }]);
  });
  it("compensação: receber D Adiantamentos / C Clientes; pagar D Fornecedores / C Adiantamentos", () => {
    expect(partidasCompensacao("receber", "clientes", "adc", "1000")).toEqual([{ contaId: "adc", debito: "1000.00" }, { contaId: "clientes", credito: "1000.00" }]);
    expect(partidasCompensacao("pagar", "forn", "adf", "300")).toEqual([{ contaId: "forn", debito: "300.00" }, { contaId: "adf", credito: "300.00" }]);
    expect(() => partidasCompensacao("pagar", "f", "a", "0")).toThrow(/maior que zero/);
  });
  it("ciclo completo: adiantamento + título + compensação zera o adiantamento e Clientes, receita reconhecida uma vez", () => {
    const ad = partidasAdiantamento("cliente", "banco", "adc", "1000");
    const titulo = [{ contaId: "clientes", debito: "1000.00" }, { contaId: "receita", credito: "1000.00" }]; // reconhecimento na competência
    const comp = partidasCompensacao("receber", "clientes", "adc", "1000");
    const tudo = [...ad, ...titulo, ...comp];
    for (const ls of [ad, titulo, comp]) validarPartidas(ls);
    expect([saldo(tudo, "adc"), saldo(tudo, "clientes"), saldo(tudo, "banco"), saldo(tudo, "receita")]).toEqual([0, 0, 100_000, -100_000]);
  });
});

describe("saldo e valor da compensação", () => {
  it("saldo = adiantado − compensado", () => expect(saldoAdiantamento("1000.00", "350.25")).toBe(64_975));
  it("sem valor: o menor dos saldos; parcial; acima de um dos saldos recusa", () => {
    expect(valorCompensacao(100_000, 60_000)).toBe(60_000);
    expect(valorCompensacao(100_000, 160_000)).toBe(100_000);
    expect(valorCompensacao(100_000, 160_000, 40_000)).toBe(40_000);
    expect(() => valorCompensacao(100_000, 60_000, 70_000)).toThrow(/saldo do adiantamento/);
    expect(() => valorCompensacao(50_000, 60_000, 55_000)).toThrow(/saldo do título/);
    expect(() => valorCompensacao(0, 60_000)).toThrow(/Nada a compensar/);
  });
});

describe("contraparte", () => {
  it("CPF/CNPJ do memo", () => {
    expect(documentoDoMemo("PIX RECEBIDO 12.345.678/0001-90 ACME LTDA")).toBe("12345678000190");
    expect(documentoDoMemo("Pix recebido: Fulano 123.456.789-09")).toBe("12345678909");
    expect(documentoDoMemo("TED ACME")).toBeNull();
  });
  it("documento manda quando os dois têm; senão o nome", () => {
    expect(mesmaContraparte({ contraparte: "ACME", contraparteDocumento: "12345678000190" }, { contraparte: "Outra", contraparteDocumento: "12.345.678/0001-90" })).toBe(true);
    expect(mesmaContraparte({ contraparte: "ACME SOFTWARE LTDA", contraparteDocumento: "1" }, { contraparte: "ACME SOFTWARE LTDA", contraparteDocumento: "2" })).toBe(false);
    expect(mesmaContraparte({ contraparte: "ACME SOFTWARE LTDA" }, { contraparte: "Acme Software Ltda", contraparteDocumento: "123" })).toBe(true);
    expect(mesmaContraparte({ contraparte: "ACME SOFTWARE LTDA" }, { contraparte: "ACME COMERCIO" })).toBe(false);
  });
  it("só adiantamentos do tipo do título, da contraparte e com saldo", () => {
    const ads = [
      { id: "1", tipo: "cliente" as const, contraparte: "Cliente X", contraparteDocumento: "111", saldo: 100 },
      { id: "2", tipo: "fornecedor" as const, contraparte: "Cliente X", contraparteDocumento: "111", saldo: 100 },
      { id: "3", tipo: "cliente" as const, contraparte: "Cliente X", contraparteDocumento: "111", saldo: 0 },
      { id: "4", tipo: "cliente" as const, contraparte: "Outro", contraparteDocumento: "222", saldo: 100 },
    ];
    expect(adiantamentosDoTitulo({ tipo: "receber", contraparte: "Cliente X SA", contraparteDocumento: "111" }, ads).map((a) => a.id)).toEqual(["1"]);
    expect(adiantamentosDoTitulo({ tipo: "pagar", contraparte: "Cliente X", contraparteDocumento: "111" }, ads).map((a) => a.id)).toEqual(["2"]);
  });
});

describe("regras de rota", () => {
  it("competência depois do extrato nunca vai para Clientes: recusa e aponta o adiantamento", () => {
    expect(() => dataReconhecimento("2025-05-01", "2025-04-10")).toThrow(/adiantamento/);
  });
  it("a IA não sugere adiantamento (precisa da contraparte)", () => {
    const conta = { codigo: "2.1.5.05", nome: "Adiantamentos de Clientes", papel: null };
    expect(operacaoSugerida("adiantamento", conta, true)).toBe("adiantamento"); // derivada da conta, para o contador confirmar
    expect(operacaoSugerida("adiantamento", { codigo: "3.1.1.03", nome: "Venda de Serviços", papel: null }, true)).toBe("receita_direta");
  });
  it("antigos: saldo e data até hoje − 90 dias", () => {
    const ads = [{ data: "2025-01-01", saldo: 10 }, { data: "2025-03-01", saldo: 10 }, { data: "2024-12-01", saldo: 0 }];
    expect(adiantamentosAntigos(ads, "2025-04-01").map((a) => a.data)).toEqual(["2025-01-01"]);
  });
});
