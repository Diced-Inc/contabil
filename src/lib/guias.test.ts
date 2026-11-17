import { describe, expect, it } from "vitest";
import {
  arquivoGuia, emAberto, guiasEsperadas, guiasFaltando, listaTipos, nomeTipoGuia, resumoGuias, rotuloGuia, situacaoGuia, textoSituacao,
  tipoDetectado, TIPOS_GUIA,
} from "./guias";

describe("guiasEsperadas", () => {
  it("simples: DAS, mais o DARF previdenciário com pró-labore", () => {
    expect(guiasEsperadas({ regime: "simples", temProLabore: false })).toEqual(["das"]);
    expect(guiasEsperadas({ regime: "simples", temProLabore: true })).toEqual(["das", "darf_previdenciario"]);
  });
  it("MEI: só o DAS-MEI", () => {
    expect(guiasEsperadas({ regime: "mei", temProLabore: true })).toEqual(["das_mei"]);
  });
  it("presumido e real: DARF de impostos, mais o previdenciário com pró-labore", () => {
    expect(guiasEsperadas({ regime: "presumido", temProLabore: false })).toEqual(["darf_impostos"]);
    expect(guiasEsperadas({ regime: "real", temProLabore: true })).toEqual(["darf_impostos", "darf_previdenciario"]);
  });
  it("faltando e lista em português", () => {
    expect(guiasFaltando(["das", "darf_previdenciario"], [{ tipo: "das" }, { tipo: "outra" }])).toEqual(["darf_previdenciario"]);
    expect(listaTipos(["das", "darf_previdenciario"])).toBe("DAS e DARF previdenciário (INSS)");
  });
});

describe("nomes", () => {
  it("rótulos", () => {
    expect(TIPOS_GUIA.map(nomeTipoGuia)).toEqual(["DAS", "DAS-MEI", "DARF previdenciário (INSS)", "DARF de impostos", "Outra guia"]);
    expect(rotuloGuia({ tipo: "outra", descricao: "Parcelamento" })).toBe("Parcelamento");
    expect(rotuloGuia({ tipo: "das", descricao: null })).toBe("DAS");
    expect(arquivoGuia("darf_previdenciario", "2026-10-01")).toBe("DARF-INSS-2026-10.pdf");
  });
});

describe("tipoDetectado", () => {
  it("DAS pelo regime, DARF pelo previdenciário", () => {
    expect(tipoDetectado({ tipo: "DAS" }, "simples")).toBe("das");
    expect(tipoDetectado({ tipo: "DAS" }, "mei")).toBe("das_mei");
    expect(tipoDetectado({ tipo: "DARF", previdenciario: true }, "simples")).toBe("darf_previdenciario");
    expect(tipoDetectado({ tipo: "DARF", previdenciario: false }, "presumido")).toBe("darf_impostos");
    expect(tipoDetectado({ tipo: null }, "simples")).toBeNull();
  });
});

describe("situação e resumo", () => {
  const g = (valor: string, vencimento: string, pagoEm: string | null = null) => ({ valor, vencimento, pagoEm });
  it("aberta, hoje, vencida e paga", () => {
    expect(situacaoGuia(g("1", "2026-11-20"), "2026-11-13")).toEqual({ tipo: "aberta", dias: 7 });
    expect(textoSituacao(situacaoGuia(g("1", "2026-11-13"), "2026-11-13"))).toBe("Vence hoje");
    expect(situacaoGuia(g("1", "2026-11-10"), "2026-11-13")).toEqual({ tipo: "vencida", dias: 3 });
    expect(situacaoGuia(g("1", "2026-01-01", "2026-01-02"), "2026-11-13")).toEqual({ tipo: "paga" });
  });
  it("conta por guia e soma sem erro de arredondamento", () => {
    const gs = [g("0.10", "2026-11-20"), g("0.20", "2026-11-10"), g("100.05", "2026-11-23", "2026-11-12")];
    expect(resumoGuias(gs, "2026-11-13")).toEqual({ qtd: 3, abertas: 1, vencidas: 1, pagas: 1, total: 100.35, emAberto: 0.3 });
    expect(emAberto(gs).map((x) => x.vencimento)).toEqual(["2026-11-10", "2026-11-20"]);
  });
});
