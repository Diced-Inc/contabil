import { describe, expect, it } from "vitest";
import { partidasApuracao, saldosDeResultado } from "@/lib/apuracao";
import { cents, fromCents } from "@/lib/format";
import type { LinhaSaldo } from "./saldos";
import { montarBalanco } from "./balanco";
import { montarDre } from "./dre";

const l = (codigo: string, tipo: LinhaSaldo["tipo"], saldoAtual = "0.00", natureza: "D" | "C" = "D"): LinhaSaldo => ({
  id: codigo, codigo, nome: codigo, natureza, tipo, parentId: null, grupoDre: null,
  saldoAnterior: "0.00", debitos: "0.00", creditos: "0.00", saldoAtual,
});
const plano = (ativo: string, capital: string, receita: string) => [
  l("1", "sintetica"), l("1.1", "sintetica"), l("1.1.1", "analitica", ativo),
  l("2", "sintetica", "0.00", "C"), l("2.3", "sintetica", "0.00", "C"), l("2.3.1", "analitica", capital, "C"),
  l("3", "sintetica", "0.00", "C"), l("3.1", "analitica", receita, "C"),
];

describe("montarBalanco", () => {
  it("fecha com resultado zero e sem linha virtual", () => {
    const b = montarBalanco(plano("1000.00", "-1000.00", "0.00"), []);
    expect(b.atual).toEqual({ ativo: 100000, passivoPl: -100000, fecha: true });
    expect(b.linhas.some((x) => x.virtual)).toBe(false);
    expect(b.linhas.some((x) => x.codigo.startsWith("3"))).toBe(false);
  });

  it("resultado não apurado entra no PL como linha virtual", () => {
    const b = montarBalanco(plano("500.00", "0.00", "-500.00"), plano("0.00", "0.00", "0.00"));
    const v = b.linhas.find((x) => x.virtual)!;
    expect(v).toMatchObject({ chave: "__resultado", codigo: "2.3.9", nome: "Resultado do exercício", natureza: "C", atual: "-500.00", anterior: "0.00" });
    expect(b.linhas.find((x) => x.codigo === "2.3")?.atual).toBe("-500.00");
    expect(b.linhas.map((x) => x.codigo)).toEqual(["1", "1.1", "1.1.1", "2", "2.3", "2.3.9"]);
    expect(b.atual).toEqual({ ativo: 50000, passivoPl: -50000, fecha: true });
    expect(b.anterior.fecha).toBe(true);
  });

  it("2.3.9 real: virtual sem código, sem colidir, por último em 2.3", () => {
    const b = montarBalanco([...plano("700.00", "0.00", "-500.00"), l("2.3.9", "analitica", "-200.00", "C")], []);
    expect(b.linhas.map((x) => x.chave)).toEqual(["1", "1.1", "1.1.1", "2", "2.3", "2.3.9", "__resultado"]);
    expect(b.linhas.find((x) => x.chave === "2.3.9")?.atual).toBe("-200.00");
    expect(b.linhas.find((x) => x.virtual)).toMatchObject({ codigo: "", atual: "-500.00" });
    expect(b.atual.fecha).toBe(true);
  });
});

/** Plano mínimo + lançamentos em memória, reproduzindo saldos() (com ou sem a apuração). */
describe("cenário: receita 3715 C, tarifa 203.39 D", () => {
  type P = { conta: string; d?: string; c?: string };
  const contas: [string, LinhaSaldo["tipo"], string | null][] = [
    ["1", "sintetica", null], ["1.1", "sintetica", null], ["1.1.1", "analitica", null],
    ["2", "sintetica", null], ["2.3", "sintetica", null], ["2.3.1", "analitica", null], ["2.3.2", "analitica", null],
    ["3", "sintetica", null], ["3.1", "analitica", "receita_bruta"], ["3.2", "analitica", "despesas_financeiras"],
  ];
  const saldos = (lancs: { apuracao?: boolean; ps: P[] }[], excluirApuracao = false): LinhaSaldo[] =>
    contas.map(([codigo, tipo, grupoDre]) => {
      let d = 0, c = 0;
      for (const x of lancs) {
        if (excluirApuracao && x.apuracao) continue;
        for (const p of x.ps) if (p.conta === codigo) { d += cents(p.d ?? 0); c += cents(p.c ?? 0); }
      }
      return {
        ...l(codigo, tipo), grupoDre, debitos: fromCents(d), creditos: fromCents(c), saldoAtual: fromCents(d - c),
      };
    });
  const lancs: { apuracao?: boolean; ps: P[] }[] = [
    { ps: [{ conta: "1.1.1", d: "3715.00" }, { conta: "3.1", c: "3715.00" }] },
    { ps: [{ conta: "3.2", d: "203.39" }, { conta: "1.1.1", c: "203.39" }] },
  ];
  const dreLiquido = (ls: { apuracao?: boolean; ps: P[] }[]) => montarDre(saldos(ls, true), []).at(-1)!.atual;

  it("DRE e balanço antes da apuração", () => {
    expect(dreLiquido(lancs)).toBe("3511.61");
    const b = montarBalanco(saldos(lancs), []);
    expect(b.atual).toEqual({ ativo: 351161, passivoPl: -351161, fecha: true });
    expect(b.linhas.find((x) => x.virtual)?.atual).toBe("-3511.61");
  });

  it("apuração zera a classe 3; DRE igual; balanço fecha sem virtual; reversão volta ao início", () => {
    const ap = partidasApuracao(saldosDeResultado(saldos(lancs)), "2.3.1", "2.3.2");
    expect(ap.resultado).toBe("3511.61");
    const ps = ap.partidas.map((p) => ({ conta: p.contaId, d: p.debito, c: p.credito }));
    const apurado = [...lancs, { apuracao: true, ps }];

    expect(saldos(apurado).filter((x) => x.codigo.startsWith("3")).every((x) => x.saldoAtual === "0.00")).toBe(true);
    expect(dreLiquido(apurado)).toBe("3511.61");
    const b = montarBalanco(saldos(apurado), []);
    expect(b.atual).toEqual({ ativo: 351161, passivoPl: -351161, fecha: true });
    expect(b.linhas.some((x) => x.virtual)).toBe(false);
    expect(b.linhas.find((x) => x.codigo === "2.3.1")?.atual).toBe("-3511.61");

    // Estorno da apuração também é origem "apuracao".
    const revertido = [...apurado, { apuracao: true, ps: ps.map((p) => ({ conta: p.conta, d: p.c, c: p.d })) }];
    expect(dreLiquido(revertido)).toBe("3511.61");
    expect(montarBalanco(saldos(revertido), []).linhas.find((x) => x.virtual)?.atual).toBe("-3511.61");
  });

  it("apuração usa o saldo acumulado, não o movimento do ano", () => {
    const linhas = saldos(lancs).map((x) => (x.codigo === "3.1" ? { ...x, saldoAnterior: "-100.00", saldoAtual: "-3815.00" } : x));
    expect(saldosDeResultado(linhas).find((s) => s.codigo === "3.1")?.saldo).toBe("-3815.00");
  });
});
