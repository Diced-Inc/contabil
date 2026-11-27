import { describe, expect, it } from "vitest";
import { avisosSemTitulo, contaDeTitulo, vetadaParaIA } from "./sem-titulo";

const c = (codigo: string, nome: string, papel: string | null = null) => ({ codigo, nome, papel });

describe("contaDeTitulo", () => {
  it("Clientes e Fornecedores pelo papel, não pelo nome", () => {
    expect(contaDeTitulo(c("1.1.2.01", "Clientes", "clientes"))).toBe("clientes");
    expect(contaDeTitulo(c("2.1.1.01", "Fornecedores Nacionais", "fornecedores"))).toBe("fornecedores");
    expect(contaDeTitulo(c("2.1.5.05", "Adiantamentos de Clientes"))).toBeNull();
  });
  it("impostos: passivo 'a recolher', com ou sem acento; despesa de imposto não conta", () => {
    expect(contaDeTitulo(c("2.1.3.01", "Simples Nacional a Recolher"))).toBe("impostos");
    expect(contaDeTitulo(c("2.1.4.04", "INSS A RECOLHER"))).toBe("impostos");
    expect(contaDeTitulo(c("3.2.5.01", "IRPJ"))).toBeNull();
    expect(contaDeTitulo(c("1.1.4.02", "Impostos a Recuperar"))).toBeNull();
    expect(contaDeTitulo(undefined)).toBeNull();
  });
});

describe("avisosSemTitulo e vetadaParaIA", () => {
  it("ordena do mais grave e deduplica", () => {
    expect(avisosSemTitulo([c("2.1.1.01", "F", "fornecedores"), c("3.1.1.03", "Venda"), c("1.1.2.01", "C", "clientes"), c("1.1.2.01", "C", "clientes")]))
      .toEqual(["clientes", "fornecedores"]);
  });
  it("IA: veta Clientes e impostos, libera Fornecedores", () => {
    expect(vetadaParaIA(c("1.1.2.01", "Clientes", "clientes"))).toBe(true);
    expect(vetadaParaIA(c("2.1.3.06", "PIS a Recolher"))).toBe(true);
    expect(vetadaParaIA(c("2.1.1.01", "Fornecedores Nacionais", "fornecedores"))).toBe(false);
  });
});
