import { describe, expect, it } from "vitest";
import { correr, semEstornos } from "./movimentos";

const m = (lancamentoId: string, debito: string, credito: string, estornoDeId: string | null = null) =>
  ({ lancamentoId, estornoDeId, debito, credito });

describe("razão: estornos", () => {
  const movs = [m("a", "100.00", "0"), m("b", "0", "30.00"), m("c", "30.00", "0", "b"), m("d", "0", "50.00", "fora")];

  it("tira o par estornado + estorno, mantém estorno cujo original está fora do período", () => {
    expect(semEstornos(movs).map((x) => x.lancamentoId)).toEqual(["a", "d"]);
  });

  it("saldo final igual com ou sem os pares; totais e saldo corrente recalculados", () => {
    const todos = correr(movs, "10.00");
    const limpos = correr(semEstornos(movs), "10.00");
    expect(limpos.saldoFinal).toBe(todos.saldoFinal);
    expect(limpos.totais).toEqual({ debitos: "100.00", creditos: "50.00" });
    expect(limpos.movimentos.map((x) => x.saldo)).toEqual(["110.00", "60.00"]);
  });
});
