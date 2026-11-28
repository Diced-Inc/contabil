import { describe, expect, it } from "vitest";
import { cents } from "./format";
import { validarPartidas, type PartidaInput } from "./lancamentos";
import {
  bloqueioCorrecao, efeitoLote, estornoForaDoMes, filtrarCandidatas, lancamentosCorrecao, resumoLote, situacao, type Alvo, type Candidata,
  type ContaInfo, type ParEstorno,
} from "./reclassificacao";

const C = (id: string, codigo: string, nome: string, papel: string | null = null) => ({ id, codigo, nome, papel });
const PLANO = [
  C("banco", "1.1.1.02", "Bancos Conta Movimento"),
  C("banco2", "1.1.1.03", "Banco Dois"),
  C("cli", "1.1.2.01", "Clientes", "clientes"),
  C("adto-forn", "1.1.4.04", "Adiantamentos a Fornecedores"),
  C("transf", "1.1.5.01", "Transferências entre Contas", "transferencias"),
  C("forn", "2.1.1.01", "Fornecedores Nacionais", "fornecedores"),
  C("adto-cli", "2.1.5.05", "Adiantamentos de Clientes"),
  C("serv", "3.1.1.03", "Venda de Serviços"),
  C("aluguel", "3.2.2.03", "Aluguel"),
];
const MAPA = new Map(PLANO.map((c) => [c.id, c]));
const INFO = new Map<string, ContaInfo>(PLANO.map((c) => [c.id, { ...c, natureza: /^(1|3\.2)/.test(c.codigo) ? "D" : "C" }]));
const CTX = { contas: PLANO, fechados: new Set<string>() };

/** Recebimento (valor > 0) ou pagamento classificado direto numa conta. */
function cand(id: string, valor: string, conta: string, data = "2025-03-10", extra: Partial<Candidata> = {}): Candidata {
  const v = String(Math.abs(Number(valor)).toFixed(2));
  const partidas: PartidaInput[] = Number(valor) > 0
    ? [{ contaId: "banco", debito: v, credito: "0.00" }, { contaId: conta, debito: "0.00", credito: v }]
    : [{ contaId: conta, debito: v, credito: "0.00" }, { contaId: "banco", debito: "0.00", credito: v }];
  return {
    transacaoId: id, contaBancariaId: "cb1", contaBancariaNome: "Itaú", contaBanco: "banco", data, valor, memo: `PIX RECEBIDO ${id}`,
    status: "classificada", lancamentoId: `l-${id}`, numero: 10, lancData: data, competencia: `${data.slice(0, 7)}-01`,
    historico: `Recebimento ${id}`, documento: null, partidas, baixa: false, adiantamento: false, reconhecido: [], ...extra,
  };
}
const RECEITA: Alvo = { operacao: "receita_direta", contaId: "serv", competencia: null };
/** Σ(D − C) por conta e competência dos lançamentos. */
function porConta(ls: { competencia: string; partidas: PartidaInput[] }[]) {
  const m: Record<string, number> = {};
  for (const l of ls) for (const p of l.partidas) {
    const k = `${p.contaId}@${l.competencia.slice(0, 7)}`;
    m[k] = (m[k] ?? 0) + cents(p.debito || 0) - cents(p.credito || 0);
    if (m[k] === 0) delete m[k];
  }
  return m;
}

describe("filtro → candidatas", () => {
  const cs = [
    cand("a", "100.00", "cli", "2025-01-05"),
    cand("b", "250.00", "cli", "2025-02-05", { memo: "TED OURIBANK S.A." }),
    cand("c", "-80.00", "forn", "2025-02-07"),
    cand("d", "300.00", "serv", "2026-01-10"),
    cand("e", "50.00", "transf", "2025-03-01", { contaBancariaId: "cb2" }),
  ];
  const ids = (f: Parameters<typeof filtrarCandidatas>[1]) => filtrarCandidatas(cs, f, MAPA).map((c) => c.transacaoId);
  it("contrapartida, operação, memo, sinal, valor, datas e competência", () => {
    expect(ids({ contaId: "cli" })).toEqual(["a", "b"]);
    expect(ids({ operacao: "receita_direta" })).toEqual(["d"]);
    expect(ids({ operacao: "baixa_receber" })).toEqual(["a", "b"]); // Clientes = baixa a receber pela conta
    expect(ids({ memo: "ouribank" })).toEqual(["b"]);
    expect(ids({ sinal: "saida" })).toEqual(["c"]);
    expect(ids({ valorMin: "90", valorMax: "250" })).toEqual(["a", "b"]);
    expect(ids({ de: "2025-02-01", ate: "2025-02-28" })).toEqual(["b", "c"]);
    expect(ids({ compDe: "2026-01-01" })).toEqual(["d"]);
    expect(ids({ contaBancariaId: "cb2" })).toEqual(["e"]);
    expect(ids({ contaId: "cli", sinal: "entrada", compAte: "2025-01-01" })).toEqual(["a"]);
  });
});

describe("situação e partidas por operação", () => {
  it("Clientes → receita direta no mês do extrato: estorno + D Banco / C Receita, Clientes zera", () => {
    const i = situacao(cand("a", "100.00", "cli"), RECEITA, CTX);
    expect(i.tipo).toBe("reclassificar");
    expect(i.lancs.map((l) => [l.data, l.competencia])).toEqual([["2025-03-10", "2025-03-01"], ["2025-03-10", "2025-03-01"]]);
    i.lancs.forEach((l) => validarPartidas(l.partidas));
    expect(porConta(i.lancs)).toEqual({ "cli@2025-03": 10000, "serv@2025-03": -10000 });
  });

  it("receita direta com competência anterior: reconhece na competência (título) e baixa no extrato", () => {
    const i = situacao(cand("a", "100.00", "cli"), { ...RECEITA, competencia: "2025-01-01" }, CTX);
    expect(i.tipo).toBe("reclassificar");
    // estorno (mar) + reconhecimento (jan, 1º dia) + baixa (data do extrato)
    expect(i.lancs.map((l) => [l.data, l.competencia])).toEqual([
      ["2025-03-10", "2025-03-01"], ["2025-01-01", "2025-01-01"], ["2025-03-10", "2025-03-01"],
    ]);
    // receita em janeiro; Clientes sobe em jan e baixa em mar (o estorno devolve o crédito antigo)
    expect(porConta(i.lancs)).toEqual({ "serv@2025-01": -10000, "cli@2025-01": 10000 });
  });

  it("competência depois do extrato bloqueia (é adiantamento)", () => {
    const i = situacao(cand("a", "100.00", "cli"), { ...RECEITA, competencia: "2025-05-01" }, CTX);
    expect(i.tipo).toBe("bloqueada");
    expect(i.motivo).toMatch(/adiantamento/);
  });

  it("adiantamento de cliente e a fornecedor pela conta do plano", () => {
    const e = situacao(cand("a", "100.00", "cli"), { operacao: "adiantamento", contaId: null, competencia: null }, CTX);
    expect(porConta(e.lancs)).toEqual({ "cli@2025-03": 10000, "adto-cli@2025-03": -10000 });
    const s = situacao(cand("c", "-80.00", "forn"), { operacao: "adiantamento", contaId: null, competencia: null }, CTX);
    expect(porConta(s.lancs)).toEqual({ "forn@2025-03": -8000, "adto-forn@2025-03": 8000 });
  });

  it("despesa direta, transferência sem par e conta simples", () => {
    const d = situacao(cand("c", "-80.00", "forn"), { operacao: "despesa_direta", contaId: "aluguel", competencia: null }, CTX);
    expect(porConta(d.lancs)).toEqual({ "forn@2025-03": -8000, "aluguel@2025-03": 8000 });
    const t = situacao(cand("a", "100.00", "cli"), { operacao: "transferencia", contaId: "transf", competencia: null }, CTX);
    expect(porConta(t.lancs)).toEqual({ "cli@2025-03": 10000, "transf@2025-03": -10000 });
    const o = situacao(cand("a", "100.00", "serv"), { operacao: null, contaId: "adto-cli", competencia: null }, CTX);
    expect(porConta(o.lancs)).toEqual({ "serv@2025-03": 10000, "adto-cli@2025-03": -10000 });
  });

  it("bloqueia: sinal, conta fora da operação, Clientes sem confirmação, título, par, mês fechado", () => {
    const motivo = (c: Candidata, a: Alvo, fechados = new Set<string>()) => situacao(c, a, { ...CTX, fechados });
    expect(motivo(cand("c", "-80.00", "forn"), RECEITA).motivo).toMatch(/não vale para saída/);
    expect(motivo(cand("a", "100.00", "cli"), { ...RECEITA, contaId: "aluguel" }).motivo).toMatch(/não cabe/);
    expect(motivo(cand("a", "100.00", "serv"), { operacao: null, contaId: "cli", competencia: null }).motivo).toMatch(/confirmação/);
    expect(motivo(cand("a", "100.00", "serv"), { operacao: null, contaId: "cli", competencia: null, confirmarSemTitulo: true }).tipo).toBe("reclassificar");
    expect(motivo(cand("a", "100.00", "cli", undefined, { baixa: true }), RECEITA).motivo).toMatch(/título/);
    expect(motivo(cand("a", "100.00", "cli", undefined, { status: "transferencia" }), RECEITA).motivo).toMatch(/par/);
    expect(motivo(cand("a", "100.00", "cli", undefined, { adiantamento: true }), RECEITA).motivo).toMatch(/Adiantamento/);
    const f = motivo(cand("a", "100.00", "cli"), RECEITA, new Set(["2025-03-01"]));
    expect([f.tipo, f.fechados]).toEqual(["bloqueada", ["2025-03-01"]]);
    // o reconhecimento em mês fechado também bloqueia
    expect(motivo(cand("a", "100.00", "cli"), { ...RECEITA, competencia: "2025-01-01" }, new Set(["2025-01-01"])).fechados).toEqual(["2025-01-01"]);
  });
});

describe("idempotência", () => {
  it("já no destino pula (mês do extrato, competência separada e adiantamento)", () => {
    expect(situacao(cand("d", "300.00", "serv"), RECEITA, CTX)).toMatchObject({ tipo: "pulada", motivo: "Já está em 3.1.1.03 Venda de Serviços" });
    // baixa do título reconhecido pelo lote em janeiro: rodar de novo pula
    const baixa = cand("a", "100.00", "cli", undefined, { baixa: true, reconhecido: [{ contaId: "serv", competencia: "2025-01-01" }] });
    expect(situacao(baixa, { ...RECEITA, competencia: "2025-01-01" }, CTX).tipo).toBe("pulada");
    expect(situacao(baixa, RECEITA, CTX).tipo).toBe("bloqueada"); // outro destino: tem título, não mexe
    const ad = cand("a", "100.00", "adto-cli", undefined, { adiantamento: true });
    expect(situacao(ad, { operacao: "adiantamento", contaId: null, competencia: null }, CTX).tipo).toBe("pulada");
  });
});

describe("efeito agregado", () => {
  it("saldo por conta antes → depois, DRE e Balanço por ano", () => {
    const itens = [
      situacao(cand("a", "100.00", "cli", "2025-03-10"), RECEITA, CTX),
      situacao(cand("b", "50.00", "cli", "2026-02-10"), RECEITA, CTX),
      situacao(cand("d", "300.00", "serv"), RECEITA, CTX), // pulada: fora do efeito
    ];
    const base = [
      { contaId: "banco", ano: 2025, saldo: "400.00", semApuracao: "400.00" },
      { contaId: "cli", ano: 2025, saldo: "-100.00", semApuracao: "-100.00" },
      { contaId: "serv", ano: 2025, saldo: "-300.00", semApuracao: "-300.00" },
      { contaId: "banco", ano: 2026, saldo: "50.00", semApuracao: "50.00" },
      { contaId: "cli", ano: 2026, saldo: "-50.00", semApuracao: "-50.00" },
    ];
    const e = efeitoLote(itens, base, INFO);
    expect(e.contas.map((c) => [c.id, c.antes, c.depois])).toEqual([["cli", -15000, 0], ["serv", -30000, -45000]]);
    expect(e.anos.map((a) => a.ano)).toEqual([2025, 2026]);
    const [y25, y26] = e.anos;
    expect(y25.dre.contas.map((c) => [c.id, c.antes, c.depois])).toEqual([["serv", 30000, 40000]]);
    expect(y25.dre.liquido).toEqual({ antes: 30000, depois: 40000 });
    expect(y26.dre.liquido).toEqual({ antes: 0, depois: 5000 });
    // Ativo sobe (Clientes credor some), Passivo + PL acompanha pelo resultado; o balanço continua fechando
    expect(y25.balanco.ativo).toEqual({ antes: 30000, depois: 40000 });
    expect(y25.balanco.passivoPl).toEqual({ antes: -30000, depois: -40000 });
    expect(y26.balanco.ativo).toEqual({ antes: 30000, depois: 45000 });
    expect(y26.balanco.contas.map((c) => [c.id, c.antes, c.depois])).toEqual([["cli", -15000, 0]]);
    expect(resumoLote(itens, MAPA)).toMatchObject({ reclassificar: 2, puladas: 1, bloqueadas: 0, total: "150.00" });
  });
});

describe("estorno fora do mês do original (Moodlr)", () => {
  const original = {
    id: "o", numero: 30, data: "2026-09-04", competencia: "2026-09-01", historico: "Recebimento Ouribank", documento: null,
    partidas: [{ contaId: "banco", debito: "5984.45", credito: "0.00" }, { contaId: "cli", debito: "0.00", credito: "5984.45" }],
  };
  const par: ParEstorno = {
    original,
    estorno: {
      id: "e", numero: 74, data: "2026-10-20", competencia: "2026-10-01", historico: "Estorno do lançamento 30: Recebimento Ouribank",
      documento: null, status: "aprovado", origem: "estorno",
      partidas: [{ contaId: "banco", debito: "0.00", credito: "5984.45" }, { contaId: "cli", debito: "5984.45", credito: "0.00" }],
    },
  };
  it("detecta só estorno aprovado em outra competência", () => {
    expect(estornoForaDoMes(par)).toBe(true);
    expect(estornoForaDoMes({ ...par, estorno: { ...par.estorno, status: "estornado" } })).toBe(false); // já corrigido
    expect(estornoForaDoMes({ ...par, estorno: { ...par.estorno, competencia: "2026-09-01" } })).toBe(false);
    expect(estornoForaDoMes({ ...par, estorno: { ...par.estorno, origem: "apuracao" } })).toBe(false);
  });
  it("compensação: anula o estorno em outubro e o refaz em setembro, na data do original", () => {
    const ls = lancamentosCorrecao(par);
    expect(ls.map((l) => [l.data, l.competencia])).toEqual([["2026-10-20", "2026-10-01"], ["2026-09-04", "2026-09-01"]]);
    ls.forEach((l) => validarPartidas(l.partidas));
    // setembro deixa de contar em dobro (−1 original), outubro volta a zero (+1)
    expect(porConta(ls)).toEqual({ "banco@2026-10": 598445, "cli@2026-10": -598445, "banco@2026-09": -598445, "cli@2026-09": 598445 });
    expect(bloqueioCorrecao(par, new Set())).toBeNull();
    expect(bloqueioCorrecao(par, new Set(["2026-10-01"]))).toMatch(/10\/2026/);
  });
});
