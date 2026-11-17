import { describe, expect, it } from "vitest";
import {
  competenciaAtual, mimeDocumento, nomeParaPath, proximoStatus, situacaoDas, somarMeses, textoSituacaoDas, TransicaoInvalida,
} from "./ciclo";

describe("competenciaAtual", () => {
  it("é o mês anterior", () => {
    expect(competenciaAtual("2026-11-13")).toBe("2026-10-01");
    expect(competenciaAtual("2026-11-01")).toBe("2026-10-01");
    expect(competenciaAtual("2026-10-31")).toBe("2026-09-01");
  });
  it("janeiro volta para dezembro do ano anterior", () => {
    expect(competenciaAtual("2027-01-05")).toBe("2026-12-01");
  });
  it("somarMeses atravessa o ano", () => {
    expect(somarMeses("2026-12-01", 1)).toBe("2027-01-01");
    expect(somarMeses("2026-01-01", -1)).toBe("2025-12-01");
    expect(somarMeses("2026-10-01", 0)).toBe("2026-10-01");
  });
});

describe("proximoStatus", () => {
  it("fluxo feliz", () => {
    let s = proximoStatus("aguardando_extrato", "extrato_enviado");
    expect(s).toBe("extrato_recebido");
    s = proximoStatus(s, "processar");
    expect(s).toBe("em_processamento");
    s = proximoStatus(s, "concluir");
    expect(s).toBe("das_enviado");
    expect(proximoStatus(s, "pagar")).toBe("das_pago");
  });
  it("envio extra não regride o status", () => {
    expect(proximoStatus("em_processamento", "extrato_enviado")).toBe("em_processamento");
    expect(proximoStatus("das_pago", "processar")).toBe("das_pago");
  });
  it("contador conclui mesmo sem envio do cliente", () => {
    expect(proximoStatus("aguardando_extrato", "concluir")).toBe("das_enviado");
  });
  it("reabrir volta para processamento", () => {
    expect(proximoStatus("das_enviado", "reabrir")).toBe("em_processamento");
    expect(proximoStatus("das_pago", "reabrir")).toBe("em_processamento");
  });
  it("encerrar sem DAS de qualquer ponto antes do pagamento", () => {
    for (const s of ["aguardando_extrato", "extrato_recebido", "em_processamento", "das_enviado"] as const) {
      expect(proximoStatus(s, "encerrar")).toBe("encerrado");
    }
    expect(() => proximoStatus("das_pago", "encerrar")).toThrow(TransicaoInvalida);
    expect(() => proximoStatus("encerrado", "encerrar")).toThrow(TransicaoInvalida);
  });
  it("encerrado: reabre para processamento; cliente não envia nem paga; processar não mexe", () => {
    expect(proximoStatus("encerrado", "reabrir")).toBe("em_processamento");
    expect(proximoStatus("encerrado", "processar")).toBe("encerrado");
    expect(() => proximoStatus("encerrado", "extrato_enviado")).toThrow(TransicaoInvalida);
    expect(() => proximoStatus("encerrado", "pagar")).toThrow(TransicaoInvalida);
    expect(() => proximoStatus("encerrado", "concluir")).toThrow(TransicaoInvalida);
  });
  it("extrato por outro canal só enquanto aguarda o extrato", () => {
    expect(proximoStatus("aguardando_extrato", "extrato_por_fora")).toBe("extrato_recebido");
    expect(() => proximoStatus("extrato_recebido", "extrato_por_fora")).toThrow(TransicaoInvalida);
    expect(() => proximoStatus("encerrado", "extrato_por_fora")).toThrow(TransicaoInvalida);
  });
  it("transições inválidas lançam", () => {
    expect(() => proximoStatus("das_enviado", "extrato_enviado")).toThrow(TransicaoInvalida);
    expect(() => proximoStatus("em_processamento", "pagar")).toThrow(TransicaoInvalida);
    expect(() => proximoStatus("das_pago", "pagar")).toThrow(TransicaoInvalida);
    expect(() => proximoStatus("das_enviado", "concluir")).toThrow(TransicaoInvalida);
    expect(() => proximoStatus("extrato_recebido", "reabrir")).toThrow(TransicaoInvalida);
  });
});

describe("situacaoDas", () => {
  const das = (dasVencimento: string) => ({ status: "das_enviado" as const, dasVencimento });
  it("sem DAS é null", () => {
    expect(situacaoDas({ status: "em_processamento", dasVencimento: null }, "2026-11-13")).toBeNull();
  });
  it("aberto, hoje e vencido", () => {
    expect(situacaoDas(das("2026-11-20"), "2026-11-13")).toEqual({ tipo: "aberto", dias: 7 });
    expect(textoSituacaoDas(situacaoDas(das("2026-11-13"), "2026-11-13")!)).toBe("Vence hoje");
    expect(situacaoDas(das("2026-11-10"), "2026-11-13")).toEqual({ tipo: "vencido", dias: 3 });
  });
  it("pago ignora vencimento", () => {
    expect(situacaoDas({ status: "das_pago", dasVencimento: "2026-01-01" }, "2026-11-13")).toEqual({ tipo: "pago" });
  });
});

describe("arquivos", () => {
  it("mime pela extensão", () => {
    expect(mimeDocumento("Extrato.OFX")).toBe("application/x-ofx");
    expect(mimeDocumento("foto.jpeg")).toBe("image/jpeg");
    expect(mimeDocumento("planilha.xlsx")).toBeNull();
  });
  it("nome seguro para o path", () => {
    expect(nomeParaPath("Extrato Itaú/out 2026.ofx")).toBe("Extrato_Itau_out_2026.ofx");
  });
});
