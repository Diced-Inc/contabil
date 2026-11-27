import { describe, expect, it } from "vitest";
import { validarPartidas } from "./lancamentos";
import {
  contaPadrao, contasDaOperacao, lancamentosDireta, operacaoDaConta, operacaoSugerida, operacoesPara, rankearTitulos,
} from "./operacoes";

const C = (id: string, codigo: string, nome: string, papel: string | null = null) => ({ id, codigo, nome, papel });
const PLANO = [
  C("banco", "1.1.1.02", "Bancos Conta Movimento"),
  C("aplic", "1.1.1.03", "Aplicações Financeiras"),
  C("cli", "1.1.2.01", "Clientes", "clientes"),
  C("adto", "1.1.4.06", "Adiantamentos a Sócios"),
  C("receb-socio", "1.1.4.05", "Valores a Receber de Sócios"),
  C("transf", "1.1.5.01", "Transferências entre Contas", "transferencias"),
  C("forn", "2.1.1.01", "Fornecedores Nacionais", "fornecedores"),
  C("emp", "2.1.2.01", "Empréstimos Bancários"),
  C("simples", "2.1.3.01", "Simples Nacional a Recolher"),
  C("lucros", "2.3.3.01", "Lucros Acumulados", "lucros_acumulados"),
  C("distrib", "2.3.3.03", "(-) Lucros Distribuídos"),
  C("prej", "2.3.3.02", "(-) Prejuízos Acumulados", "prejuizos_acumulados"),
  C("serv", "3.1.1.03", "Venda de Serviços"),
  C("dedu", "3.1.1.04", "(-) Deduções de Tributos, Abatimentos e Devoluções"),
  C("juros-p", "3.2.3.01", "Juros Passivos"),
  C("tarifa", "3.2.3.02", "Tarifas Bancárias"),
  C("aluguel", "3.2.2.03", "Aluguel"),
];
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe("operações × contas", () => {
  it("cada operação restringe o seletor ao grupo certo", () => {
    expect(ids(contasDaOperacao("receita_direta", PLANO, true))).toEqual(["serv", "dedu"]);
    expect(ids(contasDaOperacao("despesa_direta", PLANO, false))).toEqual(["juros-p", "tarifa", "aluguel"]);
    expect(ids(contasDaOperacao("baixa_imposto", PLANO, false))).toEqual(["simples"]);
    expect(ids(contasDaOperacao("adiantamento_socio", PLANO, false))).toEqual(["adto", "receb-socio"]);
    expect(ids(contasDaOperacao("distribuicao_lucros", PLANO, false))).toEqual(["lucros", "distrib"]);
    // pagamento de empréstimo aceita juros (principal + juros); o tomado, só o passivo
    expect(ids(contasDaOperacao("emprestimo", PLANO, false))).toEqual(["emp", "juros-p"]);
    expect(ids(contasDaOperacao("emprestimo", PLANO, true))).toEqual(["emp"]);
    expect(contasDaOperacao("outra", PLANO, true)).toHaveLength(PLANO.length);
  });
  it("conta padrão: a sugerida se servir, senão a típica", () => {
    expect(contaPadrao("adiantamento_socio", PLANO, false)).toBe("adto");
    expect(contaPadrao("distribuicao_lucros", PLANO, false)).toBe("distrib");
    expect(contaPadrao("estorno", PLANO, false)).toBe("dedu");
    expect(contaPadrao("transferencia", PLANO, true)).toBe("transf");
    expect(contaPadrao("despesa_direta", PLANO, false, "aluguel")).toBe("aluguel");
    expect(contaPadrao("despesa_direta", PLANO, false, "serv")).toBeNull();
  });
  it("sinal: receita/baixa a receber só entrada; despesa, baixas a pagar/imposto e distribuição só saída", () => {
    expect(operacoesPara(true)).not.toContain("despesa_direta");
    expect(operacoesPara(true)).not.toContain("distribuicao_lucros");
    expect(operacoesPara(false)).not.toContain("receita_direta");
    expect(operacoesPara(false)).not.toContain("baixa_receber");
  });
  it("operação derivada da conta sugerida", () => {
    const c = (id: string) => PLANO.find((x) => x.id === id);
    expect(operacaoDaConta(c("serv"), true)).toBe("receita_direta");
    expect(operacaoDaConta(c("aluguel"), false)).toBe("despesa_direta");
    expect(operacaoDaConta(c("aluguel"), true)).toBe("estorno");
    expect(operacaoDaConta(c("forn"), false)).toBe("baixa_pagar");
    expect(operacaoDaConta(c("simples"), false)).toBe("baixa_imposto");
    expect(operacaoDaConta(c("adto"), false)).toBe("adiantamento_socio");
    expect(operacaoDaConta(c("transf"), true)).toBe("transferencia");
    expect(operacaoDaConta(c("aplic"), false)).toBe("outra");
  });
  it("operação da IA só vale se couber no sinal e na conta; nunca baixa a receber", () => {
    const serv = PLANO.find((x) => x.id === "serv");
    expect(operacaoSugerida("receita_direta", serv, true)).toBe("receita_direta");
    expect(operacaoSugerida("despesa_direta", serv, true)).toBe("receita_direta");
    expect(operacaoSugerida("inventada", serv, true)).toBe("receita_direta");
    expect(operacaoSugerida("baixa_receber", PLANO.find((x) => x.id === "cli"), true)).toBe("baixa_receber"); // derivada, não da IA
    expect(operacaoSugerida("outra", serv, true)).toBe("outra");
  });
});

describe("lancamentosDireta", () => {
  const base = { contaBancoId: "banco", historico: "Serviços ACME", contraparte: "ACME" };
  it("competência no mês do extrato: um lançamento D Banco / C Receita", () => {
    const ls = lancamentosDireta({
      ...base, valorTx: "1500.00", dataBanco: "2025-11-10", contaPapelId: "cli", competencia: "2025-11-01",
      contras: [{ contaId: "serv", valor: "1500.00" }],
    });
    expect(ls).toEqual([{
      data: "2025-11-10", competencia: "2025-11-01", historico: "Serviços ACME",
      partidas: [{ contaId: "banco", debito: "1500.00" }, { contaId: "serv", credito: "1500.00" }],
    }]);
  });
  it("receita de outubro recebida em novembro: D Clientes / C Receita em outubro + D Banco / C Clientes em novembro", () => {
    const ls = lancamentosDireta({
      ...base, valorTx: "1500.00", dataBanco: "2025-11-10", contaPapelId: "cli", competencia: "2025-10-01",
      contras: [{ contaId: "serv", valor: "1500.00" }],
    });
    expect(ls.map((l) => [l.data, l.competencia])).toEqual([["2025-10-01", "2025-10-01"], ["2025-11-10", "2025-11-01"]]);
    expect(ls[0].partidas).toEqual([{ contaId: "cli", debito: "1500.00" }, { contaId: "serv", credito: "1500.00" }]);
    expect(ls[1].partidas).toEqual([{ contaId: "banco", debito: "1500.00" }, { contaId: "cli", credito: "1500.00" }]);
    ls.forEach((l) => validarPartidas(l.partidas));
  });
  it("despesa dividida com competência anterior: um reconhecimento por linha, uma baixa", () => {
    const ls = lancamentosDireta({
      ...base, valorTx: "-300.00", dataBanco: "2025-11-05", contaPapelId: "forn", competencia: "2025-10-01",
      contras: [{ contaId: "aluguel", valor: "200" }, { contaId: "tarifa", valor: "100" }],
    });
    expect(ls).toHaveLength(3);
    expect(ls[0].partidas).toEqual([{ contaId: "aluguel", debito: "200.00" }, { contaId: "forn", credito: "200.00" }]);
    expect(ls[1].partidas).toEqual([{ contaId: "tarifa", debito: "100.00" }, { contaId: "forn", credito: "100.00" }]);
    expect(ls[2]).toMatchObject({ data: "2025-11-05", partidas: [{ contaId: "forn", debito: "300.00" }, { contaId: "banco", credito: "300.00" }] });
  });
  it("competência depois do mês do extrato (adiantamento) é recusada", () => {
    expect(() => lancamentosDireta({
      ...base, valorTx: "1500.00", dataBanco: "2025-11-10", contaPapelId: "cli", competencia: "2025-12-01",
      contras: [{ contaId: "serv", valor: "1500.00" }],
    })).toThrow(/adiantamento/);
  });
  it("soma das linhas diferente do valor é recusada também com competência separada", () => {
    expect(() => lancamentosDireta({
      ...base, valorTx: "-300.00", dataBanco: "2025-11-05", contaPapelId: "forn", competencia: "2025-10-01",
      contras: [{ contaId: "aluguel", valor: "200" }],
    })).toThrow(/difere/);
  });
});

describe("rankearTitulos", () => {
  const t = (contraparte: string, saldo: string, vencimento: string | null) => ({ contraparte, saldo, vencimento, competencia: "2025-10-01" });
  const alvo = { valor: "-1000.00", data: "2025-11-10", memo: "PIX ENVIADO ACME SERVICOS LTDA" };
  it("valor exato primeiro, depois o mais próximo; nome no memo e vencimento desempatam", () => {
    const r = rankearTitulos([
      t("Outro Fornecedor", "990.00", "2025-11-10"),
      t("Beta", "1000.00", "2025-09-01"),
      t("ACME Serviços", "1000.00", "2025-11-08"),
      t("Gama", "5000.00", "2025-11-10"),
    ], alvo);
    expect(r.map((x) => x.contraparte)).toEqual(["ACME Serviços", "Beta", "Outro Fornecedor", "Gama"]);
    expect(r[0]).toMatchObject({ exato: true, nomeParecido: true });
    expect(r[2].exato).toBe(false);
  });
  it("usa o saldo em aberto (baixa parcial), não o valor original", () => {
    const r = rankearTitulos([t("A", "400.00", null), t("B", "1000.00", null)], { ...alvo, valor: "-400" });
    expect(r[0]).toMatchObject({ contraparte: "A", exato: true });
  });
});
