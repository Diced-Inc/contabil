import { describe, expect, it } from "vitest";
import { linhaDeSaldo } from "./saldo-dia";

describe("linhaDeSaldo", () => {
  it.each([
    "SALDO TOTAL DISPONÍVEL DIA", "SALDO TOTAL DISPONIVEL DIA", "  saldo   total disponível dia ", "SALDO ANTERIOR",
    "SALDO DO DIA", "SALDO FINAL", "SALDO EM C/C", "SALDO EM CC", "SALDO DISPONIVEL",
  ])("ignora %s", (m) => expect(linhaDeSaldo(m)).toBe(true));
  it.each([
    "PIX SALDO DEVEDOR", "TED 341 FULANO SALDO", "SALDO DEVEDOR JUROS", "SALDOS DIVERSOS", "RESGATE SALDO APLIC",
    "SALDO TOTAL", "SALDO FINALIZADO CONTA", "PIX ENVIADO SALDO DO DIA", "",
  ])("não ignora %s", (m) => expect(linhaDeSaldo(m)).toBe(false));
});
