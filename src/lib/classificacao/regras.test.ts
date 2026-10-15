import { describe, expect, it } from "vitest";
import { aplicarTemplate, casaRegra, primeiraRegra, type RegraLike, type TransacaoLike } from "./regras";

const r = (o: Partial<RegraLike>): RegraLike => ({
  id: "r", tipoMatch: "memo_contem", padrao: "x", sinal: "qualquer", contaId: "c",
  historicoTemplate: "{memo}", prioridade: 100, ativa: true, createdAt: new Date("2026-01-01"), ...o,
});
const t = (o: Partial<TransacaoLike>): TransacaoLike => ({ memo: "PIX RECEBIDO", valor: "100.00", data: "2026-10-15", ...o });

describe("casaRegra", () => {
  it("memo_contem ignora maiúsculas", () => {
    expect(casaRegra(r({ padrao: "pix rec" }), t({}))).toBe(true);
    expect(casaRegra(r({ padrao: "TED" }), t({}))).toBe(false);
  });
  it("documento compara só dígitos", () => {
    const regra = r({ tipoMatch: "documento", padrao: "12345678000190" });
    expect(casaRegra(regra, t({ memo: "TED ACME 12.345.678/0001-90" }))).toBe(true);
    expect(casaRegra(regra, t({ memo: "TED ACME 12.345.678/0001-91" }))).toBe(false);
  });
  it("documento sem dígitos no padrão nunca casa", () => {
    expect(casaRegra(r({ tipoMatch: "documento", padrao: "abc" }), t({}))).toBe(false);
  });
  it("valor_exato aceita padrão BR e compara valor absoluto", () => {
    const regra = r({ tipoMatch: "valor_exato", padrao: "1.500,00" });
    expect(casaRegra(regra, t({ valor: "-1500.00" }))).toBe(true);
    expect(casaRegra(regra, t({ valor: "1500.01" }))).toBe(false);
    expect(casaRegra(r({ tipoMatch: "valor_exato", padrao: "1500.00" }), t({ valor: "1500" }))).toBe(true);
  });
  it("sinal filtra entrada/saída", () => {
    expect(casaRegra(r({ padrao: "pix", sinal: "saida" }), t({ valor: "100.00" }))).toBe(false);
    expect(casaRegra(r({ padrao: "pix", sinal: "saida" }), t({ valor: "-100.00" }))).toBe(true);
    expect(casaRegra(r({ padrao: "pix", sinal: "entrada" }), t({ valor: "-100.00" }))).toBe(false);
  });
  it("regra inativa não casa", () => {
    expect(casaRegra(r({ padrao: "pix", ativa: false }), t({}))).toBe(false);
  });
});

describe("primeiraRegra", () => {
  it("menor prioridade vence; empate pelo createdAt", () => {
    const regras = [
      r({ id: "b", padrao: "pix", prioridade: 10, createdAt: new Date("2026-02-01") }),
      r({ id: "c", padrao: "pix", prioridade: 50 }),
      r({ id: "a", padrao: "pix", prioridade: 10, createdAt: new Date("2026-01-01") }),
    ];
    expect(primeiraRegra(regras, t({}))?.id).toBe("a");
  });
  it("pula inativas e retorna null sem casamento", () => {
    expect(primeiraRegra([r({ id: "a", padrao: "pix", prioridade: 1, ativa: false }), r({ id: "b", padrao: "pix" })], t({}))?.id).toBe("b");
    expect(primeiraRegra([r({ padrao: "ted" })], t({}))).toBeNull();
  });
});

describe("aplicarTemplate", () => {
  it("substitui {memo}, {valor} e {data}", () => {
    expect(aplicarTemplate("Recebimento {memo} de {valor} em {data}", t({ valor: "-1500.5" }))).toBe(
      "Recebimento PIX RECEBIDO de 1.500,50 em 15/10/2026",
    );
  });
  it("substitui repetições e não interpreta $ do memo", () => {
    expect(aplicarTemplate("{memo} / {memo}", t({ memo: "A $& B" }))).toBe("A $& B / A $& B");
  });
});
