import { describe, expect, it } from "vitest";
import { parearTransferencias, pareceTransferenciaPropria, type TxCand } from "./transferencias";

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

describe("pareceTransferenciaPropria", () => {
  const tav = { cnpj: "29711356000115", razaoSocial: "TAVAPPS SOLUCOES DIGITAIS LTDA" };
  const iago = { cnpj: "37969323000106", razaoSocial: "IAGO FERREIRA LIMA SERVICOS DE INFORMATICA LTDA" };
  it("CNPJ formatado no memo ou o nome da empresa (mesmo colado em data)", () => {
    expect(pareceTransferenciaPropria("PIX ENVIADO TAVAPPS 29.711.356/0001-15", tav)).toBe(true);
    expect(pareceTransferenciaPropria("PIX ENVIADO PIX ENVIADO TAVAPPS SOLU", tav)).toBe(true);
    expect(pareceTransferenciaPropria("PIX RECEBIDO TAVAPPS09/06", tav)).toBe(true);
    expect(pareceTransferenciaPropria("PIX ENVIADO 37.969.323/0001-06", iago)).toBe(true);
  });
  it("não pega outras contrapartes nem o sócio (CPF, nome curto)", () => {
    expect(pareceTransferenciaPropria("BOLETO PAGO BANCO BV", tav)).toBe(false);
    expect(pareceTransferenciaPropria("PIX ENVIADO TAVAPPS FULANO 123.456.789-00", tav)).toBe(false);
    expect(pareceTransferenciaPropria("PIX ENVIADO IAGO FERREIRA LIMA", iago)).toBe(false);
  });
});
