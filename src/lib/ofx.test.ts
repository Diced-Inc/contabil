import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { normalizarIdOfx, parseOfx } from "./ofx";
const sgml = readFileSync("test/fixtures/extrato-sgml.ofx");
const xml = readFileSync("test/fixtures/extrato-xml.ofx");

describe("parseOfx", () => {
  for (const [nome, buf] of [["sgml", sgml], ["xml", xml]] as const) {
    it(`${nome}: cabeçalho e transações`, () => {
      const r = parseOfx(buf);
      expect(r.bankId).toBe("0341"); expect(r.acctId).toBe("12345-6");
      expect(r.dtStart).toBe("2026-01-01"); expect(r.dtEnd).toBe("2026-01-31");
      expect(r.saldoFinal).toBe("3511.61"); expect(r.dataSaldo).toBe("2026-01-31");
      expect(r.transacoes).toHaveLength(2);
      expect(r.transacoes[0]).toMatchObject({ fitid: "2026010501", data: "2026-01-05", valor: "3715.00", tipo: "CREDIT" });
      expect(r.transacoes[0].memo).toContain("CLIENTE XYZ");
      expect(r.transacoes[1]).toMatchObject({ data: "2026-01-10", valor: "-203.39" });
      expect(r.transacoes[1].memo).toBe("TARIFA BANCÁRIA");
    });
  }
  it("latin1 sem charset declarado", () => {
    const txt = sgml.toString("latin1").replace("CHARSET:1252", "CHARSET:NONE");
    const r = parseOfx(Buffer.from(txt, "latin1"));
    expect(r.transacoes[1].memo).toBe("TARIFA BANCÁRIA");
  });
  it("sem MEMO usa NAME; data com sufixo [-3:BRT]", () => {
    const txt = sgml.toString("latin1").replace(
      "<MEMO>TARIFA BANCÁRIA",
      "<NAME>TED ENVIADA FORNECEDOR",
    ).replace("<DTPOSTED>20260110<", "<DTPOSTED>20260110235959[-3:BRT]<");
    const r = parseOfx(Buffer.from(txt, "latin1"));
    expect(r.transacoes[1]).toMatchObject({ memo: "TED ENVIADA FORNECEDOR", data: "2026-01-10" });
  });
  it("cartão de crédito dá erro claro", () => {
    const txt = sgml.toString("latin1").replace("<STMTRS>", "<CCSTMTRS>").replace("BANKACCTFROM", "CCACCTFROM");
    expect(() => parseOfx(Buffer.from(txt, "latin1"))).toThrow(/cart[ãa]o de cr[ée]dito/i);
  });
  it("sem STMTTRN dá erro", () => expect(() => parseOfx(Buffer.from("<OFX></OFX>"))).toThrow());
});

it("normalizarIdOfx ignora zeros à esquerda e pontuação", () => {
  expect(normalizarIdOfx("0341")).toBe(normalizarIdOfx("341"));
  expect(normalizarIdOfx("012345-6")).toBe(normalizarIdOfx("12345.6"));
  expect(normalizarIdOfx("12345-6")).not.toBe(normalizarIdOfx("12345-7"));
});
