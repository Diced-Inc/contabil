import { describe, expect, it } from "vitest";
import { casarCsv, lerCsvAbertura, partidasAbertura, saldoExtratoNaData, type ContaAbertura } from "./abertura";

const contas: ContaAbertura[] = [
  { id: "g", codigo: "1.1.1", nome: "Caixa e Equivalentes", natureza: "D", tipo: "sintetica" },
  { id: "banco", codigo: "1.1.1.02", nome: "Bancos Conta Movimento", natureza: "D", tipo: "analitica" },
  { id: "forn", codigo: "2.1.1.01", nome: "Fornecedores Nacionais", natureza: "C", tipo: "analitica" },
  { id: "cap", codigo: "2.3.1.01", nome: "Capital Subscrito", natureza: "C", tipo: "analitica" },
  { id: "rec", codigo: "3.1.1.03", nome: "Venda de Serviços", natureza: "C", tipo: "analitica" },
];
const dif = { lucrosId: "lucros", prejuizosId: "prej" };

describe("partidasAbertura", () => {
  it("D = C: uma partida por conta com saldo, zeros fora", () => {
    expect(partidasAbertura([{ contaId: "banco", saldo: 15000 }, { contaId: "cap", saldo: -15000 }, { contaId: "forn", saldo: 0 }]))
      .toEqual({ partidas: [{ contaId: "banco", debito: "150.00" }, { contaId: "cap", credito: "150.00" }], diferenca: 0 });
  });
  it("D ≠ C sem a opção é erro", () => {
    expect(() => partidasAbertura([{ contaId: "banco", saldo: 15000 }, { contaId: "cap", saldo: -10000 }])).toThrow(/não fecham.*50,00/);
  });
  it("sobra de débito vai a crédito de Lucros; sobra de crédito a débito de Prejuízos", () => {
    expect(partidasAbertura([{ contaId: "banco", saldo: 15000 }, { contaId: "cap", saldo: -10000 }], dif).partidas.at(-1))
      .toEqual({ contaId: "lucros", credito: "50.00" });
    expect(partidasAbertura([{ contaId: "banco", saldo: 10000 }, { contaId: "cap", saldo: -15000 }], dif).partidas.at(-1))
      .toEqual({ contaId: "prej", debito: "50.00" });
  });
  it("sem saldos não é lançamento", () => {
    expect(() => partidasAbertura([{ contaId: "banco", saldo: 0 }])).toThrow(/duas contas/);
  });
});

describe("CSV do balancete", () => {
  it("lê código, nome, saldo BR e natureza; casa por código, depois por nome; sintética e zero ficam de fora", () => {
    const csv = [
      "Código;Descrição;Saldo;Natureza",
      "1.1.1;Caixa e Equivalentes;1.000,00;D",
      "1.1.1.02;Bancos;1.000,00;D",
      ";fornecedores nacionais;300,00;C",
      "2.3.1.01;Capital;700,00;C",
      "2.1.9.99;Conta que não existe;10,00;C",
      "3.1.1.03;Venda de Serviços;5,00;C",
      "1.1.4.01;Zerada;0,00;D",
    ].join("\n");
    const linhas = lerCsvAbertura(csv);
    expect(linhas).toHaveLength(6);
    const r = casarCsv(linhas, contas);
    expect(Object.fromEntries(r.saldos)).toEqual({ banco: 100000, forn: -30000, cap: -70000 });
    expect(r.ignoradas).toBe(1);
    expect(r.pendentes.map((p) => [p.linha, p.motivo])).toEqual([[6, "Sem conta no plano"], [7, expect.stringMatching(/resultado/)]]);
  });
  it("sem natureza: lado da conta, negativo inverte; lado no fim do saldo; coluna Conta com códigos; vírgula", () => {
    const r = casarCsv(lerCsvAbertura("conta,saldo\n1.1.1.02,-50.00\n2.1.1.01,\"1.234,56 D\"\n"), contas);
    expect(Object.fromEntries(r.saldos)).toEqual({ banco: -5000, forn: 123456 });
  });
  it("linhas da mesma conta somam", () => {
    const r = casarCsv(lerCsvAbertura("codigo;saldo;nat\n1.1.1.02;10,00;D\n1.1.1.02;4,00;C"), contas);
    expect(r.saldos.get("banco")).toBe(600);
  });
  it("cabeçalho sem saldo é erro", () => {
    expect(() => lerCsvAbertura("codigo;valorx\n1;2")).not.toThrow();
    expect(() => lerCsvAbertura("codigo;natureza\n1;D")).toThrow(/Cabeçalho/);
  });
});

describe("saldoExtratoNaData", () => {
  const dias = [{ data: "2025-01-02", valor: 1000 }, { data: "2025-01-10", valor: -300 }, { data: "2025-02-05", valor: 50 }];
  it("volta do saldo do OFX até a data e avança depois dele", () => {
    expect(saldoExtratoNaData({ saldo: 10700, dataSaldo: "2025-01-31" }, dias, "2024-12-31")).toBe(10000);
    expect(saldoExtratoNaData({ saldo: 10700, dataSaldo: "2025-01-31" }, dias, "2025-02-28")).toBe(10750);
  });
});
