import { describe, expect, it } from "vitest";
import { parearTransferencias, type TxCand } from "./transferencias";

const tx = (id: string, contaBancariaId: string, data: string, valor: string): TxCand => ({ id, contaBancariaId, data, valor });

describe("parearTransferencias", () => {
  it("pareia valor igual em contas diferentes a 1 dia", () => {
    expect(parearTransferencias([tx("s", "A", "2026-03-10", "-500.00"), tx("e", "B", "2026-03-11", "500.00")])).toEqual([["s", "e"]]);
  });
  it("não pareia na mesma conta", () => {
    expect(parearTransferencias([tx("s", "A", "2026-03-10", "-500.00"), tx("e", "A", "2026-03-10", "500.00")])).toEqual([]);
  });
  it("não pareia a 3 dias", () => {
    expect(parearTransferencias([tx("s", "A", "2026-03-10", "-500.00"), tx("e", "B", "2026-03-13", "500.00")])).toEqual([]);
  });
  it("pareia a 2 dias atravessando horário de verão", () => {
    expect(parearTransferencias([tx("s", "A", "2026-10-31", "-1.00"), tx("e", "B", "2026-11-02", "1.00")])).toEqual([["s", "e"]]);
  });
  it("cada transação é usada uma vez quando há duas candidatas", () => {
    const pares = parearTransferencias([
      tx("s1", "A", "2026-03-10", "-200.00"),
      tx("s2", "C", "2026-03-10", "-200.00"),
      tx("e1", "B", "2026-03-10", "200.00"),
    ]);
    expect(pares).toEqual([["s1", "e1"]]);
  });
});
