import { describe, expect, it } from "vitest";
import { cents } from "./format";
import { ajusteGuia } from "./guia-titulo";
import { validarPartidas } from "./lancamentos";
import { partidasBaixas, partidasTitulo } from "./operacoes";
import { acharConta, codigoBase, contaRetencao, contasDaGuia } from "./tributos";
import { PLANO_ITG1000 } from "@/db/seed-plano";

// plano do seed com ids = código (analíticas: sem filho)
const comFilho = new Set(PLANO_ITG1000.map((r) => r[0].split(".").slice(0, -1).join(".")));
const PLANO = PLANO_ITG1000.filter((r) => !comFilho.has(r[0])).map(([codigo, nome, , , papel]) => ({ id: codigo, codigo, nome, papel: papel ?? null }));
const conta = (alvo: Parameters<typeof acharConta>[1]) => acharConta(PLANO, alvo)?.codigo ?? null;

describe("contasDaGuia", () => {
  it("DAS: D deduções / C Simples Nacional a Recolher", () => {
    const m = contasDaGuia("das")!;
    expect([conta(m.despesa), conta(m.obrigacao), m.modo]).toEqual(["3.1.1.04", "2.1.3.01", "despesa"]);
    expect(conta(contasDaGuia("das_mei")!.obrigacao)).toBe("2.1.3.01");
  });
  it("DARF previdenciário: INSS a Recolher, com ou sem código", () => {
    expect(conta(contasDaGuia("darf_previdenciario")!.obrigacao)).toBe("2.1.4.04");
    expect(conta(contasDaGuia("darf_previdenciario", "1099")!.despesa)).toBe("3.2.2.02");
    expect(contasDaGuia("darf_previdenciario", "1162")!.modo).toBe("ja_registrada");
  });
  it.each([
    ["2089", "2.1.3.08", "3.2.5.01"], ["5993", "2.1.3.08", "3.2.5.01"], ["2372", "2.1.3.09", "3.2.5.02"], ["6012", "2.1.3.09", "3.2.5.02"],
    ["8109", "2.1.3.06", "3.1.1.04"], ["6912", "2.1.3.06", "3.1.1.04"], ["2172", "2.1.3.07", "3.1.1.04"], ["5856", "2.1.3.07", "3.1.1.04"],
    ["0561", "2.1.3.04", "3.2.2.02"], ["1708", "2.1.3.04", "3.2.2.12"],
  ])("DARF %s → %s / %s", (codigo, obrigacao, despesa) => {
    const m = contasDaGuia("darf_impostos", codigo)!;
    expect(conta(m.obrigacao)).toBe(obrigacao);
    expect(conta(m.despesa)).toBe(despesa);
  });
  it("tributo próprio reconhece despesa; retenção de nota de fornecedor já está registrada", () => {
    expect(contasDaGuia("darf_impostos", "2089")!.modo).toBe("despesa");
    expect(contasDaGuia("darf_impostos", "1708")!.modo).toBe("ja_registrada");
    expect(contasDaGuia("darf_impostos", "5952")!.modo).toBe("ja_registrada");
    expect(contasDaGuia("darf_impostos", "5952")!.obrigacao.criar?.nome).toBe("PIS/COFINS/CSLL Retidos a Recolher");
  });
  it("código com extensão ou máscara; desconhecido e outra guia pedem as contas", () => {
    expect(codigoBase("0561-07")).toBe("0561");
    expect(contasDaGuia("darf_impostos", "0561-07")!.tributo).toBe("IRRF");
    expect(contasDaGuia("darf_impostos", "9999")).toBeNull();
    expect(contasDaGuia("darf_impostos", null)).toBeNull();
    expect(contasDaGuia("outra", null)).toBeNull();
    expect(contasDaGuia("outra", "2089")!.tributo).toBe("IRPJ"); // outra guia com código conhecido também mapeia
  });
});

describe("contaRetencao", () => {
  it("nota emitida: federal a compensar (criada sob demanda), ISS em deduções", () => {
    expect(contaRetencao("receber", "irrf")!.criar).toMatchObject({ pai: "1.1.4", nome: "IRRF Retido a Compensar" });
    expect(contaRetencao("receber", "pis")).toBe(contaRetencao("receber", "csll"));
    expect(conta(contaRetencao("receber", "iss"))).toBe("3.1.1.04");
  });
  it("nota recebida: a recolher", () => {
    expect(conta(contaRetencao("pagar", "iss"))).toBe("2.1.3.03");
    expect(conta(contaRetencao("pagar", "irrf"))).toBe("2.1.3.04");
    expect(conta(contaRetencao("pagar", "inss"))).toBe("2.1.4.04");
    expect(contaRetencao("pagar", "outras")).toBeNull();
  });
});

const saldo = (ps: { contaId: string; debito?: string; credito?: string }[], c: string) =>
  ps.filter((p) => p.contaId === c).reduce((s, p) => s + cents(p.debito || 0) - cents(p.credito || 0), 0);

describe("retenções da nota", () => {
  it("nota emitida: D Clientes líquido + D retidos / C receita bruto, balanceado", () => {
    const ps = partidasTitulo("receber", "clientes", "receita", "9045.00", [{ contaId: "irrf", valor: "150" }, { contaId: "csrf", valor: "465" }, { contaId: "iss", valor: "340" }]);
    expect(validarPartidas(ps).total).toBe(1_000_000);
    expect(saldo(ps, "clientes")).toBe(904_500);
    expect(saldo(ps, "receita")).toBe(-1_000_000);
  });
  it("nota recebida: D despesa bruto / C retidos a recolher + C Fornecedores líquido", () => {
    const ps = partidasTitulo("pagar", "fornecedores", "despesa", "850", [{ contaId: "irrf", valor: "15" }, { contaId: "iss", valor: "50" }, { contaId: "csrf", valor: "0" }]);
    expect(validarPartidas(ps).total).toBe(91_500);
    expect(ps).toHaveLength(4); // retenção zero não vira partida
    expect(saldo(ps, "fornecedores")).toBe(-85_000);
  });
  it("retenção negativa recusa", () => {
    expect(() => partidasTitulo("pagar", "f", "d", "100", [{ contaId: "x", valor: "-1" }])).toThrow(/maior que zero/);
  });
  it("IRRF retido na nota + DARF 1708 (obrigação já registrada) + baixa: IRRF a Recolher zera, sem despesa em dobro", () => {
    const nota = partidasTitulo("pagar", "fornecedores", "servicos", "985", [{ contaId: "irrf", valor: "15" }]);
    expect(contasDaGuia("darf_impostos", "1708")!.modo).toBe("ja_registrada"); // a guia não lança nada
    const baixa = partidasBaixas({ tipo: "pagar", contaBancoId: "banco", contaPapelId: null, itens: [{ valor: "15", contaId: "irrf" }] });
    const tudo = [...nota, ...baixa];
    expect(saldo(tudo, "irrf")).toBe(0);
    expect(saldo(tudo, "servicos")).toBe(100_000); // despesa = bruto da nota, uma vez só
  });
});

describe("baixa por conta do título", () => {
  it("cada título na conta dele; sem conta, o papel", () => {
    const ps = partidasBaixas({
      tipo: "pagar", contaBancoId: "banco", contaPapelId: "fornecedores",
      itens: [{ valor: "100", contaId: "simples" }, { valor: "50" }, { valor: "25", contaId: "simples", juros: "2" }],
      contaJurosId: "juros",
    });
    expect(ps).toEqual([
      { contaId: "simples", debito: "125.00" }, { contaId: "fornecedores", debito: "50.00" },
      { contaId: "juros", debito: "2.00" }, { contaId: "banco", credito: "177.00" },
    ]);
  });
  it("sem conta no título e sem papel recusa", () => {
    expect(() => partidasBaixas({ tipo: "pagar", contaBancoId: "b", contaPapelId: null, itens: [{ valor: "1" }] })).toThrow(/papel Fornecedores/);
  });
});

describe("ajusteGuia", () => {
  const base = { valor: "518.71", vencimento: "2026-11-23", obrigacaoId: "s", despesaId: "d" };
  const ctx = { temBaixa: false, mesFechado: false, competencia: "2026-10-01" };
  it("nada / só vencimento / reconhecer de novo", () => {
    expect(ajusteGuia(base, { ...base, valor: "518.710" }, ctx)).toBe("nada");
    expect(ajusteGuia(base, { ...base, vencimento: "2026-11-30" }, ctx)).toBe("vencimento");
    expect(ajusteGuia(base, { ...base, valor: "600" }, ctx)).toBe("reconhecer");
    expect(ajusteGuia(base, { ...base, despesaId: null }, ctx)).toBe("reconhecer");
  });
  it("vencimento muda mesmo com o mês fechado (não mexe no lançamento)", () => {
    expect(ajusteGuia(base, { ...base, vencimento: "2026-11-30" }, { ...ctx, mesFechado: true })).toBe("vencimento");
  });
  it("mês fechado ou baixa recusam", () => {
    expect(() => ajusteGuia(base, { ...base, valor: "600" }, { ...ctx, mesFechado: true })).toThrow(/10\/2026 está fechado/);
    expect(() => ajusteGuia(base, { ...base, vencimento: "2026-12-01" }, { ...ctx, temBaixa: true })).toThrow(/baixada/);
    expect(ajusteGuia(base, base, { ...ctx, temBaixa: true })).toBe("nada");
  });
});
