import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { detectarCsv, parseCsv, parseValor, sugerirMapeamento } from "./csv";
import { atribuirFitids } from "./dedup";

const fixture = readFileSync("test/fixtures/extrato-banco.csv");

describe("detectarCsv", () => {
  it("fixture: separador, cabeçalho, colunas e amostra", () => {
    const d = detectarCsv(fixture);
    expect(d.encoding).toBe("utf8");
    expect(d.separador).toBe(";");
    expect(d.linhaCabecalho).toBe(5);
    expect(d.colunas).toEqual(["Data Lançamento", "Histórico", "Descrição", "Valor", "Saldo"]);
    expect(d.amostra).toHaveLength(10);
    expect(d.amostra[0][0]).toBe("30/10/2026");
  });
  it("sugere o mapeamento pelo cabeçalho", () => {
    expect(sugerirMapeamento(detectarCsv(fixture))).toMatchObject({ data: 0, historico: [1, 2], valor: 3, saldo: 4, formatoData: "DMY" });
  });
});

describe("parseCsv", () => {
  const r = parseCsv(fixture, sugerirMapeamento(detectarCsv(fixture)));
  it("fixture: 35 linhas, primeira, período e saldo", () => {
    expect(r.transacoes).toHaveLength(35);
    expect(r.transacoes[0]).toMatchObject({ data: "2026-10-30", valor: "-200.00", memo: "Pix enviado - Marcelo Barreira Rola Junior" });
    expect(r.transacoes[3]).toMatchObject({ valor: "10585.48", memo: "Pix recebido - Ouribank S.a." });
    expect(r.dtStart).toBe("2026-10-01");
    expect(r.dtEnd).toBe("2026-10-30");
    expect(r.saldoFinal).toBe("1400.00");
    expect(r.dataSaldo).toBe("2026-10-30");
  });
  it("vírgula + latin1 + débito/crédito + aspas + data YMD", () => {
    const txt = 'Data,Descrição,Débito,Crédito,Saldo\n2026-01-05,"Tarifa, pacote",12.90,,"1.000,00"\n2026-01-06,Depósito em espécie,,"1.500,00","2.487,10"\n2026-01-06,Depósito em espécie,,"1.500,00","3.987,10"\n';
    const buf = Buffer.from(txt, "latin1");
    const d = detectarCsv(buf);
    expect(d).toMatchObject({ encoding: "latin1", separador: ",", linhaCabecalho: 0 });
    const mp = sugerirMapeamento(d);
    expect(mp).toMatchObject({ data: 0, historico: [1], debito: 2, credito: 3, saldo: 4, formatoData: "YMD" });
    const p = parseCsv(buf, mp);
    expect(p.transacoes.map((t) => t.valor)).toEqual(["-12.90", "1500.00", "1500.00"]);
    expect(p.transacoes[0].memo).toBe("Tarifa, pacote");
    expect(p.saldoFinal).toBe("3987.10");
    expect(parseCsv(buf, { ...mp, sinalInvertido: true }).transacoes[0].valor).toBe("12.90");
    // Mesma data+valor+histórico no mesmo arquivo: #2 na segunda.
    const f = atribuirFitids("csv", p.transacoes);
    expect(f[1].fitid).toMatch(/^csv:[0-9a-f]{40}$/);
    expect(f[2].fitid).toBe(`${f[1].fitid}#2`);
    expect(f[0].fitid).not.toBe(f[1].fitid);
  });
});

it("parseValor", () => {
  expect(parseValor("1.000,00")).toBe("1000.00");
  expect(parseValor("-200,00")).toBe("-200.00");
  expect(parseValor("(200,00)")).toBe("-200.00");
  expect(parseValor("R$ 1.000,00")).toBe("1000.00");
  expect(parseValor("1000.00")).toBe("1000.00");
  expect(parseValor("1.000")).toBe("1000.00");
  expect(parseValor("200,00 D")).toBe("-200.00");
  expect(parseValor("-0,00")).toBe("0.00");
  expect(parseValor("abc")).toBeNull();
});

it("dedup: chave estável e normalizada", () => {
  const [a] = atribuirFitids("csv", [{ data: "2026-10-30", valor: "-200.00", memo: "Pix  enviado - X" }]);
  const [b] = atribuirFitids("csv", [{ data: "2026-10-30", valor: "-200", memo: "pix enviado - x " }]);
  const [c] = atribuirFitids("pdf", [{ data: "2026-10-30", valor: "-200", memo: "pix enviado - x" }]);
  expect(a.fitid).toBe(b.fitid);
  expect(c.fitid.startsWith("pdf:")).toBe(true);
});
