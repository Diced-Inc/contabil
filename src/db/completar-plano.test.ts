import { describe, expect, it } from "vitest";
import { normalizarNome, planejarComplemento, type ContaExistente } from "./completar-plano";
import { PLANO_ITG1000, parentCodigo } from "./seed-plano";
import { NOVAS_CONTAS } from "./completar-plano";

const novas = new Set([...NOVAS_CONTAS, "1.1.5"]);
const comFilho = new Set(PLANO_ITG1000.map((r) => parentCodigo(r[0])));
/** Plano antigo (seed sem as contas novas), ids = código. */
const antigo = (): ContaExistente[] => PLANO_ITG1000.filter((r) => !novas.has(r[0])).map(([codigo, nome, , , papel]) => ({
  id: codigo, codigo, nome, tipo: comFilho.has(codigo) && codigo !== "1.1.5" ? "sintetica" : "analitica", papel: papel ?? null,
}));
let n = 0;
const novoId = () => `novo-${++n}`;
const criadas = (a: ReturnType<typeof planejarComplemento>) => a.flatMap((x) => (x.acao === "criar" ? [x.codigo] : []));

describe("planejarComplemento", () => {
  it("empresa com o plano antigo: cria o grupo de transferências e as 10 analíticas nos códigos do seed", () => {
    const a = planejarComplemento(antigo(), undefined, novoId);
    expect(criadas(a)).toEqual(["1.1.4.06", "1.1.5", "1.1.5.01", "2.1.3.06", "2.1.3.07", "2.1.3.08", "2.1.3.09", "2.1.3.10", "2.2.2.02", "2.3.3.03", "3.2.2.12"]);
    const t = a.find((x) => x.acao === "criar" && x.codigo === "1.1.5.01");
    const g = a.find((x) => x.acao === "criar" && x.codigo === "1.1.5");
    expect(t).toMatchObject({ papel: "transferencias", tipo: "analitica", parentId: g && "id" in g ? g.id : "?" });
    expect(g).toMatchObject({ tipo: "sintetica", parentId: "1.1" });
    expect(a.find((x) => x.acao === "criar" && x.codigo === "3.2.2.12")).toMatchObject({ grupoDre: "despesas_operacionais" });
  });

  it("reaproveita contas criadas à mão (TAVAPPS): transferências analítica 1.1.5 ganha o papel, adiantamento não duplica", () => {
    const contas = [
      ...antigo(),
      { id: "tav-adiant", codigo: "1.1.4.06", nome: "Adiantamentos a sócios", tipo: "analitica" as const, papel: null },
      { id: "tav-transf", codigo: "1.1.5", nome: "Transferencias entre contas bancarias", tipo: "analitica" as const, papel: null },
    ];
    const a = planejarComplemento(contas, undefined, novoId);
    expect(a).toContainEqual({ acao: "papel", id: "tav-transf", codigo: "1.1.5", nome: "Transferencias entre contas bancarias", papel: "transferencias" });
    expect(a).toContainEqual({ acao: "existe", codigo: "1.1.4.06", nome: "Adiantamentos a sócios", seed: "1.1.4.06" });
    expect(criadas(a)).not.toContain("1.1.5");
    expect(criadas(a)).not.toContain("1.1.5.01");
    expect(criadas(a)).not.toContain("1.1.4.06");
  });

  it("idempotente: depois de aplicar, não cria nem altera nada", () => {
    const contas = antigo();
    for (const x of planejarComplemento(contas, undefined, novoId))
      if (x.acao === "criar") contas.push({ id: x.id, codigo: x.codigo, nome: x.nome, tipo: x.tipo, papel: x.papel });
    expect(planejarComplemento(contas, undefined, novoId).every((x) => x.acao === "existe")).toBe(true);
  });

  it("não casa nomes de outro grupo nem conceitos diferentes", () => {
    const a = planejarComplemento(antigo(), undefined, novoId);
    // IRPJ/CSLL (3.2.5) e Valores a Receber de Sócios / Lucros a Distribuir não contam como as contas novas
    expect(criadas(a)).toEqual(expect.arrayContaining(["2.1.3.08", "2.1.3.09", "1.1.4.06", "2.3.3.03"]));
  });

  it("código ocupado por outra conta: usa o próximo livre do mesmo pai, sem renumerar", () => {
    const contas = [...antigo(), { id: "x", codigo: "2.1.3.06", nome: "ISS Retido", tipo: "analitica" as const, papel: null }];
    const a = planejarComplemento(contas, ["2.1.3.06"], novoId);
    expect(criadas(a)).toEqual(["2.1.3.07"]);
  });

  it("grupo ocupado por analítica: avisa em vez de criar filho sob analítica", () => {
    const contas = [...antigo(), { id: "x", codigo: "1.1.5", nome: "Numerário", tipo: "analitica" as const, papel: null }];
    const a = planejarComplemento(contas, ["1.1.5.01"], novoId);
    expect(a).toEqual([{ acao: "aviso", codigo: "1.1.5.01", nome: "Transferências entre Contas", motivo: expect.stringContaining("1.1.5") }]);
  });

  it("papel já usado em outra conta: cria sem papel e avisa", () => {
    const contas = antigo().map((c) => (c.codigo === "1.1.1.03" ? { ...c, papel: "transferencias" as const } : c));
    const a = planejarComplemento(contas, ["1.1.5.01"], novoId);
    expect(a.find((x) => x.acao === "criar" && x.codigo === "1.1.5.01")).toMatchObject({ papel: null });
    expect(a.some((x) => x.acao === "aviso")).toBe(true);
  });

  it("normalizarNome", () => expect(normalizarNome("(-) Lucros  Distribuídos")).toBe("lucros distribuidos"));
});
