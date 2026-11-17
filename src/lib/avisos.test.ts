import { describe, expect, it } from "vitest";
import { avisosDoDia, etapasAvisos, listaPtBR, proximoPedido, type CicloAviso, type ConfigAvisos } from "./avisos";

const config: ConfigAvisos = { avisosAtivos: true, diaPedidoExtrato: 1, lembretesExtratoDias: [4, 9], diasAntesVencimentoDas: [3, 0] };
const outubro = (c: Partial<CicloAviso> = {}): CicloAviso => ({
  competencia: "2026-10-01", status: "aguardando_extrato", dasVencimento: null, extratoSolicitadoEm: null, ...c,
});
const pedido = new Date("2026-11-01T11:00:00Z");
const rodar = (hoje: string, ciclos: CicloAviso[], cfg: Partial<ConfigAvisos> = {}, membrosAtivos = 1) =>
  avisosDoDia({ hoje, config: { ...config, ...cfg }, ciclos, membrosAtivos }).map((a) => `${a.tipo} ${a.competencia}`);

describe("avisosDoDia: pedido de extrato", () => {
  it("no dia do pedido, sem ciclo ainda", () => {
    expect(rodar("2026-11-01", [])).toEqual(["pedido_extrato 2026-10-01"]);
  });
  it("antes do dia do pedido, nada", () => {
    expect(rodar("2026-11-04", [], { diaPedidoExtrato: 5 })).toEqual([]);
  });
  it("devolve a data de referência de hoje", () => {
    expect(avisosDoDia({ hoje: "2026-11-01", config, ciclos: [], membrosAtivos: 2 })).toEqual([
      { tipo: "pedido_extrato", competencia: "2026-10-01", dataRef: "2026-11-01" },
    ]);
  });
  it("não pede se o cliente já mandou", () => {
    expect(rodar("2026-11-01", [outubro({ status: "extrato_recebido" })])).toEqual([]);
  });
  it("cron perdido: pede depois do dia se nunca pediu nesta competência", () => {
    expect(rodar("2026-11-03", [outubro()])).toEqual(["pedido_extrato 2026-10-01"]);
    expect(rodar("2026-11-03", [])).toEqual(["pedido_extrato 2026-10-01"]);
  });
  it("já pediu: não repete o pedido", () => {
    expect(rodar("2026-11-03", [outubro({ extratoSolicitadoEm: pedido })])).toEqual([]);
  });
  it("janeiro pede dezembro do ano anterior", () => {
    expect(rodar("2027-01-01", [])).toEqual(["pedido_extrato 2026-12-01"]);
  });
});

describe("avisosDoDia: lembretes de extrato", () => {
  it("nos dias pedido + d, enquanto aguarda", () => {
    const c = [outubro({ extratoSolicitadoEm: pedido })];
    expect(rodar("2026-11-05", c)).toEqual(["lembrete_extrato 2026-10-01"]);
    expect(rodar("2026-11-10", c)).toEqual(["lembrete_extrato 2026-10-01"]);
    expect(rodar("2026-11-06", c)).toEqual([]);
  });
  it("para quando o extrato chega", () => {
    expect(rodar("2026-11-05", [outubro({ status: "extrato_recebido", extratoSolicitadoEm: pedido })])).toEqual([]);
    expect(rodar("2026-11-10", [outubro({ status: "em_processamento", extratoSolicitadoEm: pedido })])).toEqual([]);
  });
  it("lembrete que passa do fim do mês cai no último dia", () => {
    const fev = [{ ...outubro({ extratoSolicitadoEm: pedido }), competencia: "2027-01-01" }];
    expect(rodar("2027-02-28", fev, { diaPedidoExtrato: 25, lembretesExtratoDias: [4, 9] })).toEqual(["lembrete_extrato 2027-01-01"]);
    expect(rodar("2027-02-27", fev, { diaPedidoExtrato: 25, lembretesExtratoDias: [4, 9] })).toEqual([]);
  });
  it("cron perdido no dia do lembrete: não recupera", () => {
    expect(rodar("2026-11-06", [outubro({ extratoSolicitadoEm: pedido })])).toEqual([]);
  });
  it("no dia de um lembrete sem pedido feito, manda só o pedido", () => {
    expect(rodar("2026-11-05", [outubro()])).toEqual(["pedido_extrato 2026-10-01"]);
  });
});

describe("avisosDoDia: DAS", () => {
  const das = (vencimento: string, c: Partial<CicloAviso> = {}) =>
    outubro({ status: "das_enviado", dasVencimento: vencimento, extratoSolicitadoEm: pedido, ...c });
  it("3 dias antes e no dia do vencimento", () => {
    expect(rodar("2026-11-17", [das("2026-11-20")])).toEqual(["lembrete_das 2026-10-01"]);
    expect(rodar("2026-11-20", [das("2026-11-20")])).toEqual(["lembrete_das 2026-10-01"]);
    expect(rodar("2026-11-18", [das("2026-11-20")])).toEqual([]);
  });
  it("um aviso de vencido no dia seguinte, e só um", () => {
    expect(rodar("2026-11-21", [das("2026-11-20")])).toEqual(["lembrete_das 2026-10-01"]);
    expect(rodar("2026-11-22", [das("2026-11-20")])).toEqual([]);
  });
  it("vale para competências antigas e atravessa o mês", () => {
    const set = das("2026-11-02", { competencia: "2026-09-01" });
    expect(rodar("2026-10-30", [set])).toEqual(["lembrete_das 2026-09-01"]);
  });
  it("DAS pago não lembra", () => {
    expect(rodar("2026-11-20", [das("2026-11-20", { status: "das_pago" })])).toEqual([]);
  });
  it("pedido do mês e DAS do mês anterior no mesmo dia", () => {
    expect(rodar("2026-11-01", [das("2026-11-01", { competencia: "2026-09-01" })])).toEqual([
      "pedido_extrato 2026-10-01",
      "lembrete_das 2026-09-01",
    ]);
  });
});

describe("avisosDoDia: desligado", () => {
  it("sem avisos ativos ou sem clientes ativos, nada", () => {
    expect(rodar("2026-11-01", [], { avisosAtivos: false })).toEqual([]);
    expect(rodar("2026-11-01", [], {}, 0)).toEqual([]);
  });
});

describe("textos", () => {
  it("listaPtBR", () => {
    expect(listaPtBR([5])).toBe("5");
    expect(listaPtBR([5, 10])).toBe("5 e 10");
    expect(listaPtBR([5, 10, 15])).toBe("5, 10 e 15");
  });
  it("etapasAvisos monta a linha do tempo", () => {
    expect(etapasAvisos(config, "2026-11-13").map((e) => `${e.quando}: ${e.texto}`)).toEqual([
      "Dia 1: pedimos os extratos de outubro",
      "Dias 5 e 10: lembramos se ainda não enviou",
      "3 dias antes e no dia do vencimento: lembramos o DAS (e no dia seguinte, se não foi pago)",
    ]);
    expect(etapasAvisos({ diaPedidoExtrato: 25, lembretesExtratoDias: [9], diasAntesVencimentoDas: [] }, "2027-02-10").map((e) => e.quando)).toEqual([
      "Dia 25",
      "Dia 28",
      "Dia seguinte ao vencimento",
    ]);
  });
  it("proximoPedido", () => {
    expect(proximoPedido("2026-11-13", 1)).toBe("2026-12-01");
    expect(proximoPedido("2026-11-13", 20)).toBe("2026-11-20");
    expect(proximoPedido("2026-11-20", 20)).toBe("2026-12-20");
    expect(proximoPedido("2026-12-05", 1)).toBe("2027-01-01");
  });
});

describe("avisosDoDia: mês encerrado sem DAS", () => {
  const encerrado = (c: Partial<CicloAviso> = {}) => outubro({ status: "encerrado", ...c });
  it("não pede o extrato, nem no dia nem depois", () => {
    expect(rodar("2026-11-01", [encerrado()])).toEqual([]);
    expect(rodar("2026-11-03", [encerrado()])).toEqual([]);
  });
  it("não lembra o extrato", () => {
    expect(rodar("2026-11-05", [encerrado({ extratoSolicitadoEm: pedido })])).toEqual([]);
  });
  it("não lembra o DAS, mesmo com guia enviada antes de encerrar", () => {
    expect(rodar("2026-11-17", [encerrado({ dasVencimento: "2026-11-20" })])).toEqual([]);
    expect(rodar("2026-11-21", [encerrado({ dasVencimento: "2026-11-20" })])).toEqual([]);
  });
});
