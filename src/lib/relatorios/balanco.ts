import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { apuracoes } from "@/db/schema";
import { cents, fromCents } from "@/lib/format";
import { agregar, compararCodigo, nivel } from "./hierarquia";
import { saldos, type LinhaSaldo } from "./saldos";

export type LinhaBalanco = Pick<LinhaSaldo, "codigo" | "nome" | "natureza" | "tipo"> & {
  atual: string; anterior: string; virtual?: boolean;
};
/** Em centavos, saldo D − C: ativo positivo, passivoPl negativo. */
export type TotaisBalanco = { ativo: number; passivoPl: number; fecha: boolean };

const patrimonial = (c: string) => /^[12](\.|$)/.test(c);

/** Classes 1 e 2 agregadas; sem apuração, o resultado acumulado (Σ saldo da classe 3) entra como 2.3.9 virtual. */
function ano(linhas: LinhaSaldo[], apurado: boolean) {
  const base = linhas.filter((l) => patrimonial(l.codigo));
  if (!apurado) {
    const r = linhas.filter((l) => l.tipo === "analitica" && /^3(\.|$)/.test(l.codigo)).reduce((s, l) => s + cents(l.saldoAtual), 0);
    if (r !== 0) {
      base.push({
        id: "resultado-exercicio", codigo: "2.3.9", nome: "Resultado do exercício", natureza: "C", tipo: "analitica",
        parentId: null, grupoDre: null, saldoAnterior: "0.00", debitos: "0.00", creditos: "0.00", saldoAtual: fromCents(r),
      });
    }
  }
  const agg = agregar(base);
  const saldo = (c: string) => cents(agg.find((l) => l.codigo === c)?.saldoAtual ?? 0);
  const totais: TotaisBalanco = { ativo: saldo("1"), passivoPl: saldo("2"), fecha: saldo("1") + saldo("2") === 0 };
  return { agg, totais };
}

export function montarBalanco(atual: LinhaSaldo[], anterior: LinhaSaldo[], apuradoAtual: boolean, apuradoAnterior: boolean) {
  const a = ano(atual, apuradoAtual), p = ano(anterior, apuradoAnterior);
  const linhas = new Map<string, LinhaBalanco>();
  for (const [lado, agg] of [["atual", a.agg], ["anterior", p.agg]] as const) {
    for (const l of agg) {
      const x = linhas.get(l.codigo) ?? {
        codigo: l.codigo, nome: l.nome, natureza: l.natureza, tipo: l.tipo, atual: "0.00", anterior: "0.00",
        ...(l.id === "resultado-exercicio" && { virtual: true }),
      };
      x[lado] = l.saldoAtual;
      linhas.set(l.codigo, x);
    }
  }
  return {
    linhas: [...linhas.values()]
      .filter((l) => nivel(l.codigo) === 1 || cents(l.atual) !== 0 || cents(l.anterior) !== 0)
      .sort((x, y) => compararCodigo(x.codigo, y.codigo)),
    atual: a.totais,
    anterior: p.totais,
  };
}

/** Balanço em 31/12 do ano e do anterior. */
export async function balanco(empresaId: string, ano: number) {
  const [atual, anterior, aps] = await Promise.all([
    saldos(empresaId, `${ano}-01-01`, `${ano}-12-31`),
    saldos(empresaId, `${ano - 1}-01-01`, `${ano - 1}-12-31`),
    db.select({ exercicio: apuracoes.exercicio }).from(apuracoes)
      .where(and(eq(apuracoes.empresaId, empresaId), inArray(apuracoes.exercicio, [ano, ano - 1]))),
  ]);
  const apurado = (a: number) => aps.some((x) => x.exercicio === a);
  return montarBalanco(atual, anterior, apurado(ano), apurado(ano - 1));
}
