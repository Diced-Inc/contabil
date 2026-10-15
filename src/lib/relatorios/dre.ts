import { cents, fromCents, GRUPOS_DRE } from "@/lib/format";
import { compararCodigo } from "./hierarquia";
import { saldos, type LinhaSaldo } from "./saldos";

export type GrupoDre = keyof typeof GRUPOS_DRE;
export type LinhaDre = { tipo: "grupo" | "conta" | "subtotal"; label: string; codigo?: string; atual: string; anterior: string };

/** Anexo 3 da ITG 1000. `acumula: false` = subtotal só dos grupos da etapa (resultado financeiro). */
const ETAPAS: { grupos: GrupoDre[]; subtotal: string; acumula: boolean }[] = [
  { grupos: ["receita_bruta", "deducoes"], subtotal: "Receita líquida", acumula: true },
  { grupos: ["custos"], subtotal: "Lucro bruto", acumula: true },
  { grupos: ["despesas_operacionais"], subtotal: "Resultado antes do financeiro", acumula: true },
  { grupos: ["receitas_financeiras", "despesas_financeiras"], subtotal: "Resultado financeiro", acumula: false },
  { grupos: ["outras_receitas", "outras_despesas"], subtotal: "Resultado antes dos tributos", acumula: true },
  { grupos: ["tributos_lucro"], subtotal: "Resultado líquido", acumula: true },
];

/** Valor de cada analítica de resultado no período: créditos − débitos (receita +, despesa −), em centavos. */
function valores(linhas: LinhaSaldo[]) {
  const m = new Map<string, { codigo: string; nome: string; grupo: GrupoDre; v: number }>();
  for (const l of linhas) {
    if (l.tipo !== "analitica" || !l.grupoDre || !l.codigo.startsWith("3")) continue;
    m.set(l.codigo, { codigo: l.codigo, nome: l.nome, grupo: l.grupoDre as GrupoDre, v: cents(l.creditos) - cents(l.debitos) });
  }
  return m;
}

export function montarDre(linhasAtual: LinhaSaldo[], linhasAnterior: LinhaSaldo[]): LinhaDre[] {
  const a = valores(linhasAtual), p = valores(linhasAnterior);
  const codigos = [...new Set([...a.keys(), ...p.keys()])].sort(compararCodigo);
  const out: LinhaDre[] = [];
  let accA = 0, accP = 0;
  for (const e of ETAPAS) {
    let etA = 0, etP = 0;
    for (const g of e.grupos) {
      const contas = codigos
        .map((c) => ({ c, x: a.get(c), y: p.get(c) }))
        .filter(({ x, y }) => (x ?? y)!.grupo === g && ((x?.v ?? 0) !== 0 || (y?.v ?? 0) !== 0));
      const gA = contas.reduce((s, k) => s + (k.x?.v ?? 0), 0);
      const gP = contas.reduce((s, k) => s + (k.y?.v ?? 0), 0);
      out.push({ tipo: "grupo", label: GRUPOS_DRE[g], atual: fromCents(gA), anterior: fromCents(gP) });
      for (const k of contas) {
        out.push({
          tipo: "conta", label: (k.x ?? k.y)!.nome, codigo: k.c,
          atual: fromCents(k.x?.v ?? 0), anterior: fromCents(k.y?.v ?? 0),
        });
      }
      etA += gA; etP += gP;
    }
    accA += etA; accP += etP;
    out.push({ tipo: "subtotal", label: e.subtotal, atual: fromCents(e.acumula ? accA : etA), anterior: fromCents(e.acumula ? accP : etP) });
  }
  return out;
}

/** Mesma data um ano antes; 29/02 vira 28/02 (o ano anterior a um bissexto não é bissexto). */
export function umAnoAntes(d: string) {
  const s = `${Number(d.slice(0, 4)) - 1}${d.slice(4)}`;
  return s.endsWith("-02-29") ? s.slice(0, -2) + "28" : s;
}

/** DRE do período e do mesmo intervalo um ano antes. Última linha = "Resultado líquido". */
export async function dre(empresaId: string, de: string, ate: string) {
  const op = { excluirApuracao: true };
  const [atual, anterior] = await Promise.all([
    saldos(empresaId, de, ate, undefined, op),
    saldos(empresaId, umAnoAntes(de), umAnoAntes(ate), undefined, op),
  ]);
  return montarDre(atual, anterior);
}
