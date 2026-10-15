import { describe, it, expect } from "vitest";
import { PLANO_ITG1000, parentCodigo } from "./seed-plano";

describe("PLANO_ITG1000", () => {
  const codigos = new Set(PLANO_ITG1000.map((r) => r[0]));
  it("todo código tem pai existente (exceto raízes)", () => {
    for (const [c] of PLANO_ITG1000) { const p = parentCodigo(c); if (p) expect(codigos.has(p), c).toBe(true); }
  });
  it("sem códigos duplicados", () => expect(codigos.size).toBe(PLANO_ITG1000.length));
  it("toda analítica da classe 3 tem grupo_dre", () => {
    const temFilho = (c: string) => [...codigos].some((o) => parentCodigo(o) === c);
    for (const [c, , , g] of PLANO_ITG1000) if (c.startsWith("3") && !temFilho(c)) expect(g, c).toBeTruthy();
  });
  it("papéis únicos e presentes", () => {
    const papeis = PLANO_ITG1000.map((r) => r[4]).filter(Boolean);
    expect(new Set(papeis).size).toBe(papeis.length);
    expect(papeis.sort()).toEqual(["clientes", "fornecedores", "lucros_acumulados", "prejuizos_acumulados"]);
  });
});
