import { describe, expect, it } from "vitest";
import { avisosDoDia, etapasAvisos, guiasDoLembrete, listaPtBR, proximoPedido, type CicloAviso, type ConfigAvisos } from "./avisos";

const config: ConfigAvisos = { avisosAtivos: true, diaPedidoExtrato: 1, lembretesExtratoDias: [4, 9], lembretesDasAposEnvio: [3], diasAntesVencimentoDas: [3] };
const outubro = (c: Partial<CicloAviso> = {}): CicloAviso => ({
  competencia: "2026-10-01", status: "aguardando_extrato", extratoSolicitadoEm: null, guias: [], ...c,
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

describe("avisosDoDia: guias", () => {
  // Guia enviada em 10/11 às 15h em São Paulo (18h UTC), vence 20/11.
  const enviado = new Date("2026-11-10T18:00:00Z");
  const guia = (vencimento: string, g: { enviadoEm?: Date | null; pagoEm?: Date | null } = {}) => ({ vencimento, enviadoEm: enviado, pagoEm: null, ...g });
  const das = (vencimento: string, c: Partial<CicloAviso> = {}) =>
    outubro({ status: "das_enviado", extratoSolicitadoEm: pedido, guias: [guia(vencimento)], ...c });
  const dias = (de: number, ate: number) => Array.from({ length: ate - de + 1 }, (_, i) => `2026-11-${String(de + i).padStart(2, "0")}`);
  it("3 dias depois do envio e 3 dias antes do vencimento, nada mais", () => {
    expect(dias(11, 22).filter((d) => rodar(d, [das("2026-11-20")]).length)).toEqual(["2026-11-13", "2026-11-17"]);
  });
  it("dias depois do envio contam no fuso de São Paulo", () => {
    const tarde = das("2026-11-30", { guias: [guia("2026-11-30", { enviadoEm: new Date("2026-11-11T01:30:00Z") })] }); // 10/11 22h30 em SP
    expect(rodar("2026-11-13", [tarde])).toEqual(["lembrete_das 2026-10-01"]);
    expect(rodar("2026-11-14", [tarde])).toEqual([]);
  });
  it("lista configurável: 3 e 5 dias depois", () => {
    expect(rodar("2026-11-15", [das("2026-11-30")], { lembretesDasAposEnvio: [3, 5] })).toEqual(["lembrete_das 2026-10-01"]);
  });
  it("mesmo dia nas duas regras: um aviso só", () => {
    expect(rodar("2026-11-13", [das("2026-11-16")])).toEqual(["lembrete_das 2026-10-01"]);
  });
  it("sem lembrete no dia do vencimento nem depois de vencido", () => {
    expect(rodar("2026-11-20", [das("2026-11-20")])).toEqual([]);
    expect(rodar("2026-11-21", [das("2026-11-20")])).toEqual([]);
    expect(rodar("2026-11-13", [das("2026-11-12")])).toEqual([]); // depois do envio, mas já vencido
  });
  it("vale para competências antigas e atravessa o mês", () => {
    const set = das("2026-11-02", { competencia: "2026-09-01", guias: [guia("2026-11-02", { enviadoEm: new Date("2026-10-20T12:00:00Z") })] });
    expect(rodar("2026-10-30", [set])).toEqual(["lembrete_das 2026-09-01"]);
  });
  it("guias pagas ou mês encerrado não lembram", () => {
    const paga = das("2026-11-20", { guias: [guia("2026-11-20", { pagoEm: new Date("2026-11-11T12:00:00Z") })] });
    expect(rodar("2026-11-13", [paga])).toEqual([]);
    expect(rodar("2026-11-17", [paga])).toEqual([]);
    expect(rodar("2026-11-13", [das("2026-11-20", { status: "das_pago" })])).toEqual([]);
    expect(rodar("2026-11-13", [das("2026-11-20", { status: "encerrado" })])).toEqual([]);
  });
  it("pedido do mês e guias do mês anterior no mesmo dia", () => {
    expect(rodar("2026-11-01", [das("2026-11-04", { competencia: "2026-09-01" })])).toEqual([
      "pedido_extrato 2026-10-01",
      "lembrete_das 2026-09-01",
    ]);
  });

  // DAS vence 20/11 e DARF previdenciário 23/11, enviados juntos em 10/11.
  const duas = (g: Partial<Record<"das" | "inss", { enviadoEm?: Date | null; pagoEm?: Date | null }>> = {}) =>
    outubro({ status: "das_enviado", extratoSolicitadoEm: pedido, guias: [guia("2026-11-20", g.das), guia("2026-11-23", g.inss)] });
  it("várias guias: um e-mail 3 dias depois do envio e um 3 dias antes do vencimento mais próximo", () => {
    expect(dias(11, 24).filter((d) => rodar(d, [duas()]).length)).toEqual(["2026-11-13", "2026-11-17"]);
  });
  it("com a primeira paga, o vencimento que conta é o da que falta", () => {
    const pagoDas = duas({ das: { pagoEm: new Date("2026-11-12T12:00:00Z") } });
    expect(dias(14, 24).filter((d) => rodar(d, [pagoDas]).length)).toEqual(["2026-11-20"]);
  });
  it("guia enviada depois tem os 3 dias contados do envio dela", () => {
    const extra = duas({ inss: { enviadoEm: new Date("2026-11-12T15:00:00Z") } });
    expect(dias(11, 16).filter((d) => rodar(d, [extra]).length)).toEqual(["2026-11-13", "2026-11-15"]);
  });
  it("rascunho não entra; o lembrete lista só as guias em aberto e não vencidas", () => {
    const g = [guia("2026-11-20"), guia("2026-11-23", { enviadoEm: null }), guia("2026-11-10"), guia("2026-11-21", { pagoEm: enviado })];
    expect(guiasDoLembrete(g, "2026-11-13").map((x) => x.vencimento)).toEqual(["2026-11-20"]);
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
      "Ao enviar as guias: o cliente recebe as guias do mês por e-mail",
      "3 dias depois: se não marcou como pago, lembramos",
      "3 dias antes do vencimento: último lembrete, se ainda não pagou",
    ]);
    const outra = etapasAvisos({ diaPedidoExtrato: 25, lembretesExtratoDias: [9], lembretesDasAposEnvio: [3, 5], diasAntesVencimentoDas: [] }, "2027-02-10");
    expect(outra.map((e) => e.quando)).toEqual(["Dia 25", "Dia 28", "Ao enviar as guias", "3 e 5 dias depois"]);
  });
  it("proximoPedido", () => {
    expect(proximoPedido("2026-11-13", 1)).toBe("2026-12-01");
    expect(proximoPedido("2026-11-13", 20)).toBe("2026-11-20");
    expect(proximoPedido("2026-11-20", 20)).toBe("2026-12-20");
    expect(proximoPedido("2026-12-05", 1)).toBe("2027-01-01");
  });
});

describe("avisosDoDia: mês encerrado sem guias", () => {
  const encerrado = (c: Partial<CicloAviso> = {}) => outubro({ status: "encerrado", ...c });
  it("não pede o extrato, nem no dia nem depois", () => {
    expect(rodar("2026-11-01", [encerrado()])).toEqual([]);
    expect(rodar("2026-11-03", [encerrado()])).toEqual([]);
  });
  it("não lembra o extrato", () => {
    expect(rodar("2026-11-05", [encerrado({ extratoSolicitadoEm: pedido })])).toEqual([]);
  });
  it("não lembra as guias, mesmo com guia enviada antes de encerrar", () => {
    const enviado = new Date("2026-11-10T18:00:00Z");
    expect(rodar("2026-11-13", [encerrado({ guias: [{ vencimento: "2026-11-20", enviadoEm: enviado, pagoEm: null }] })])).toEqual([]);
    expect(rodar("2026-11-17", [encerrado({ guias: [{ vencimento: "2026-11-20", enviadoEm: enviado, pagoEm: null }] })])).toEqual([]);
  });
});
