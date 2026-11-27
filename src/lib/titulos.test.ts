import { describe, expect, it } from "vitest";
import { validarPartidas } from "./lancamentos";
import { distribuirBaixa, partidasBaixas, statusPorBaixas, totalBaixa } from "./operacoes";

const BANCO = "banco", PAPEL = "papel", JUROS = "juros", DESC = "desconto";
const base = { contaBancoId: BANCO, contaPapelId: PAPEL, contaJurosId: JUROS, contaDescontoId: DESC };

describe("partidasBaixas", () => {
  it("receber exato: D Banco / C Clientes", () => {
    expect(partidasBaixas({ ...base, tipo: "receber", itens: [{ valor: "100" }] })).toEqual([
      { contaId: BANCO, debito: "100.00" },
      { contaId: PAPEL, credito: "100.00" },
    ]);
  });
  it("receber com desconto: D Banco líquido + D desconto / C Clientes cheio", () => {
    const ps = partidasBaixas({ ...base, tipo: "receber", itens: [{ valor: "100", desconto: "4.50" }] });
    expect(ps).toEqual([
      { contaId: BANCO, debito: "95.50" }, { contaId: DESC, debito: "4.50" }, { contaId: PAPEL, credito: "100.00" },
    ]);
    expect(validarPartidas(ps).total).toBe(10000);
  });
  it("pagar com juros: D Fornecedores + D juros / C Banco", () => {
    const ps = partidasBaixas({ ...base, tipo: "pagar", itens: [{ valor: "100", juros: "2.30" }] });
    expect(ps).toEqual([
      { contaId: PAPEL, debito: "100.00" }, { contaId: JUROS, debito: "2.30" }, { contaId: BANCO, credito: "102.30" },
    ]);
  });
  it("vários títulos numa transação: soma os abatimentos num lançamento só", () => {
    const itens = [{ valor: "60" }, { valor: "40.10", juros: "1" }, { valor: "25", desconto: "5" }];
    const ps = partidasBaixas({ ...base, tipo: "pagar", itens });
    expect(ps).toContainEqual({ contaId: PAPEL, debito: "125.10" });
    expect(ps).toContainEqual({ contaId: BANCO, credito: "121.10" });
    expect(totalBaixa(itens)).toBe(12110);
    expect(validarPartidas(ps).total).toBe(12610);
  });
  it("exige conta de juros/desconto quando há diferença e valor > 0", () => {
    expect(() => partidasBaixas({ tipo: "receber", contaBancoId: BANCO, contaPapelId: PAPEL, itens: [{ valor: "10", juros: "1" }] })).toThrow(/juros/);
    expect(() => partidasBaixas({ ...base, tipo: "receber", itens: [{ valor: "0" }] })).toThrow(/maior que zero/);
    expect(() => partidasBaixas({ ...base, tipo: "receber", itens: [] })).toThrow();
  });
});

describe("statusPorBaixas", () => {
  it("aberto sem baixa, parcial até o valor, quitado ao completar", () => {
    expect(statusPorBaixas("100.00", 0)).toBe("aberto");
    expect(statusPorBaixas("100.00", 4000)).toBe("parcial");
    expect(statusPorBaixas("100.00", 10000)).toBe("quitado");
  });
  it("desfazer uma das baixas parciais volta o status pela soma que sobrou", () => {
    // título de 100 baixado por duas transações (60 + 40); desfazer a de 40 reabre como parcial, a de 60 também → aberto
    const baixas = [6000, 4000];
    expect(statusPorBaixas("100", baixas.reduce((s, v) => s + v, 0))).toBe("quitado");
    expect(statusPorBaixas("100", baixas[0])).toBe("parcial");
    expect(statusPorBaixas("100", 0)).toBe("aberto");
  });
});

describe("distribuirBaixa", () => {
  it("preenche os títulos até o saldo; sobra vira juros no último", () => {
    expect(distribuirBaixa([5000, 3000], 8000)).toEqual([{ valor: 5000, juros: 0 }, { valor: 3000, juros: 0 }]);
    expect(distribuirBaixa([5000, 3000], 6000)).toEqual([{ valor: 5000, juros: 0 }, { valor: 1000, juros: 0 }]);
    expect(distribuirBaixa([5000], 5200)).toEqual([{ valor: 5000, juros: 200 }]);
  });
});
