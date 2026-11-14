import { describe, expect, it } from "vitest";
import { corpoRegra, mapearCatchAll, mapearRegras, normalizarLocal, traduzirErro, validarLocal } from "./email-routing";

describe("validarLocal", () => {
  it("aceita nomes comuns", () => {
    for (const l of ["contato", "david.bruno", "fin-2026", "a_b", "x"]) expect(validarLocal(l)).toBeNull();
  });
  it("recusa vazio, acento, espaço, maiúscula, longo e pontos nas pontas", () => {
    for (const l of ["", "joão", "a b", "Contato", "a".repeat(41), ".a", "a.", "a..b", "a+b"]) expect(validarLocal(l)).not.toBeNull();
  });
  it("recusa reservados", () => {
    for (const l of ["avisos", "postmaster", "abuse"]) expect(validarLocal(l)).toMatch(/reservado/);
  });
  it("normaliza o que o contador digita", () => {
    expect(normalizarLocal("  Contato@dbcontador.com.br ")).toBe("contato");
    expect(validarLocal(normalizarLocal("Financeiro"))).toBeNull();
  });
});

// Formato real de GET /zones/{zone}/email/routing/rules
const FIXTURE = [
  {
    id: "r1",
    name: "Rule created at 2026-11-13T21:00:00.000Z",
    enabled: true,
    priority: 0,
    matchers: [{ type: "literal", field: "to", value: "Contato@dbcontador.com.br" }],
    actions: [{ type: "forward", value: ["contatodavidbruno@gmail.com"] }],
  },
  {
    id: "r2",
    name: "Financeiro",
    enabled: false,
    matchers: [{ type: "literal", field: "to", value: "financeiro@dbcontador.com.br" }],
    actions: [{ type: "forward", value: ["fin@gmail.com"] }],
  },
  { id: "r3", name: "worker", enabled: true, matchers: [{ type: "literal", field: "to", value: "bot@dbcontador.com.br" }], actions: [{ type: "worker", value: ["w"] }] },
  { id: "r4", name: "catch", enabled: true, matchers: [{ type: "all" }], actions: [{ type: "drop" }] },
];

describe("mapearRegras", () => {
  it("só regras literal to + forward, em ordem, com nome automático limpo", () => {
    expect(mapearRegras(FIXTURE)).toEqual([
      { id: "r1", endereco: "contato@dbcontador.com.br", local: "contato", destinos: ["contatodavidbruno@gmail.com"], ativo: true, nome: "" },
      { id: "r2", endereco: "financeiro@dbcontador.com.br", local: "financeiro", destinos: ["fin@gmail.com"], ativo: false, nome: "Financeiro" },
    ]);
  });
  it("corpoRegra volta como o mesmo endereço", () => {
    const corpo = corpoRegra("contato@dbcontador.com.br", "x@gmail.com", "Contato");
    expect(mapearRegras([{ id: "n", ...corpo }])[0]).toMatchObject({ endereco: "contato@dbcontador.com.br", destinos: ["x@gmail.com"], nome: "Contato" });
  });
});

describe("mapearCatchAll", () => {
  it("descarta, encaminha e ausente", () => {
    expect(mapearCatchAll(FIXTURE[3])).toEqual({ ativo: true, acao: "descartar", destinos: [] });
    expect(mapearCatchAll({ id: "c", enabled: false, matchers: [{ type: "all" }], actions: [{ type: "forward", value: ["a@b.com"] }] })).toEqual({
      ativo: false, acao: "encaminhar", destinos: ["a@b.com"],
    });
    expect(mapearCatchAll(null)).toBeNull();
  });
});

describe("traduzirErro", () => {
  it("10000/9109 nas regras vira permissao_regras com o nome da permissão", () => {
    const r = traduzirErro(403, [{ code: 10000, message: "Authentication error" }], "regras");
    expect(r.erro).toBe("permissao_regras");
    expect(r.mensagem).toContain("Zone › Email Routing Rules › Edit");
    expect(traduzirErro(400, [{ code: 9109, message: "Unauthorized" }], "destinos").erro).toBe("permissao_destinos");
  });
  it("5xx é indisponível; 4xx comum repassa a mensagem", () => {
    expect(traduzirErro(502, [], "regras").erro).toBe("indisponivel");
    expect(traduzirErro(400, [{ code: 2020, message: "Invalid rule" }], "regras")).toEqual({ erro: "outro", mensagem: "O Cloudflare recusou: Invalid rule" });
  });
});
