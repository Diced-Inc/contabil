import { describe, expect, it } from "vitest";
import {
  mesAnterior, mesesDoAno, motivoNaoApurar, motivoNaoFechar, motivoNaoReabrir, type EstadoFechamento,
} from "./fechamento";

const estado = (fechados: string[], primeiroAberto: string | null = null, apurados: number[] = []): EstadoFechamento => ({
  fechados: new Map(fechados.map((c) => [c, { fechadoEm: new Date(), fechadoPor: null }])),
  primeiroAberto,
  apurados: new Set(apurados),
});

describe("regras de fechamento", () => {
  it("mesAnterior vira o ano", () => {
    expect(mesAnterior("2026-01-01")).toBe("2025-12-01");
    expect(mesAnterior("2026-10-01")).toBe("2026-09-01");
  });

  it("fechar: primeiro fechamento livre se não há lançamento anterior em aberto", () => {
    expect(motivoNaoFechar("2026-03-01", estado([], "2026-03-10"))).toBeNull();
    expect(motivoNaoFechar("2026-03-01", estado([], "2026-02-10"))).toMatch(/02\/2026/);
    expect(motivoNaoFechar("2026-03-01", estado(["2026-02-01"], "2026-01-05"))).toBeNull();
    expect(motivoNaoFechar("2026-03-01", estado(["2026-03-01"]))).toMatch(/já está fechado/);
  });

  it("reabrir: só o último fechado e fora de exercício apurado", () => {
    expect(motivoNaoReabrir("2026-02-01", estado(["2026-01-01", "2026-02-01"]))).toBeNull();
    expect(motivoNaoReabrir("2026-01-01", estado(["2026-01-01", "2026-02-01"]))).toMatch(/seguintes/);
    expect(motivoNaoReabrir("2026-04-01", estado([]))).toMatch(/não está fechado/);
    expect(motivoNaoReabrir("2026-12-01", estado(mesesDoAno(2026), null, [2026]))).toMatch(/Reverta/);
  });

  it("apurar: 12 meses fechados e não apurado", () => {
    expect(motivoNaoApurar(2026, estado(mesesDoAno(2026)))).toBeNull();
    expect(motivoNaoApurar(2026, estado(mesesDoAno(2026).slice(0, 11)))).toMatch(/12 meses/);
    expect(motivoNaoApurar(2026, estado(mesesDoAno(2026), null, [2026]))).toMatch(/já apurado/);
  });
});
