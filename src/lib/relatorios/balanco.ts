import { cents, fromCents } from "@/lib/format";
import { agregar, compararCodigo, nivel } from "./hierarquia";
import { saldos, type LinhaSaldo } from "./saldos";

export type LinhaBalanco = Pick<LinhaSaldo, "codigo" | "nome" | "natureza" | "tipo"> & {
  /** Chave única da linha (código, ou VIRTUAL para o resultado do exercício). */
  chave: string; atual: string; anterior: string; virtual?: boolean;
  /** Id da conta no plano (ausente na linha virtual). */
  id?: string;
};
/** Em centavos, saldo D − C: ativo positivo, passivoPl negativo. */
export type TotaisBalanco = { ativo: number; passivoPl: number; fecha: boolean };

const VIRTUAL = "__resultado";
const patrimonial = (c: string) => /^[12](\.|$)/.test(c);

/**
 * Classes 1 e 2 agregadas. O saldo acumulado da classe 3 (resultado ainda não apurado) soma no PL (2 e 2.3)
 * e volta à parte como `resultado`; depois da apuração ele é zero e o valor já está em lucros/prejuízos.
 */
function ano(linhas: LinhaSaldo[]) {
  const resultado = linhas
    .filter((l) => l.tipo === "analitica" && /^3(\.|$)/.test(l.codigo))
    .reduce((s, l) => s + cents(l.saldoAtual), 0);
  const agg = agregar(linhas.filter((l) => patrimonial(l.codigo))).map((l) =>
    resultado !== 0 && (l.codigo === "2" || l.codigo === "2.3")
      ? { ...l, saldoAtual: fromCents(cents(l.saldoAtual) + resultado) }
      : l,
  );
  const saldo = (c: string) => cents(agg.find((l) => l.codigo === c)?.saldoAtual ?? 0);
  const totais: TotaisBalanco = { ativo: saldo("1"), passivoPl: saldo("2"), fecha: saldo("1") + saldo("2") === 0 };
  return { agg, resultado, totais };
}

export function montarBalanco(atual: LinhaSaldo[], anterior: LinhaSaldo[]) {
  const a = ano(atual), p = ano(anterior);
  const linhas = new Map<string, LinhaBalanco>();
  for (const [lado, agg] of [["atual", a.agg], ["anterior", p.agg]] as const) {
    for (const l of agg) {
      const x = linhas.get(l.codigo) ?? {
        chave: l.codigo, id: l.id, codigo: l.codigo, nome: l.nome, natureza: l.natureza, tipo: l.tipo, atual: "0.00", anterior: "0.00",
      };
      x[lado] = l.saldoAtual;
      linhas.set(l.codigo, x);
    }
  }
  if (a.resultado !== 0 || p.resultado !== 0) {
    const existe = [...atual, ...anterior].some((l) => l.codigo === "2.3.9");
    linhas.set(VIRTUAL, {
      chave: VIRTUAL, codigo: existe ? "" : "2.3.9", nome: "Resultado do exercício", natureza: "C", tipo: "analitica",
      atual: fromCents(a.resultado), anterior: fromCents(p.resultado), virtual: true,
    });
  }
  // Virtual por último dentro de 2.3.
  const ordem = (l: LinhaBalanco) => (l.virtual ? `2.3.${Number.MAX_SAFE_INTEGER}` : l.codigo);
  return {
    linhas: [...linhas.values()]
      .filter((l) => l.virtual || nivel(l.codigo) === 1 || cents(l.atual) !== 0 || cents(l.anterior) !== 0)
      .sort((x, y) => compararCodigo(ordem(x), ordem(y))),
    atual: a.totais,
    anterior: p.totais,
  };
}

/** Balanço em 31/12 do ano e do anterior (saldos acumulados, com a apuração quando houver). */
export async function balanco(empresaId: string, ano: number) {
  const [atual, anterior] = await Promise.all([
    saldos(empresaId, `${ano}-01-01`, `${ano}-12-31`),
    saldos(empresaId, `${ano - 1}-01-01`, `${ano - 1}-12-31`),
  ]);
  return montarBalanco(atual, anterior);
}
