import { z } from "zod";

const brl = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const cents = (v: string | number) => Math.round(Number(v) * 100);
export const fromCents = (c: number) => (c / 100).toFixed(2);
/** "1.234,56" → "1234.56"; sem vírgula, o ponto é decimal ("1234.56"). */
export function parseValorBR(s: string) {
  const t = s.replace(/\s/g, "");
  return t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
}
/** "1234.5" → "1234,50" para inputs editáveis; zero vira "". */
export const valorParaInput = (v: string | number) => (Number(v) ? Number(v).toFixed(2).replace(".", ",") : "");
export const fmtValor = (v: string | number) => brl.format(Number(v));
/** saldo = débito − crédito. Positivo → D, negativo → C, zero → natureza */
export function fmtSaldoDC(v: string | number, natureza: "D" | "C") {
  const n = Number(v);
  if (n === 0) return `0,00${natureza}`;
  return `${brl.format(Math.abs(n))}${n > 0 ? "D" : "C"}`;
}
export const fmtData = (d: string | Date) => new Date(typeof d === "string" ? d + "T00:00:00" : d).toLocaleDateString("pt-BR");
export const fmtCompetencia = (d: string) => `${d.slice(5, 7)}/${d.slice(0, 4)}`;
const diaSP = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
});
/** Data de hoje em São Paulo, "YYYY-MM-DD" (UTC vira o dia às 21h). */
export const hoje = () => diaSP.format(new Date());
const dataSchema = z.iso.date();
const anoSchema = z.coerce.number().int().min(1900).max(2200);
/** searchParam com data real "YYYY-MM-DD", ou undefined. */
export const isoData = (s: unknown) => (dataSchema.safeParse(s).success ? (s as string) : undefined);
/** searchParam de ano (1900–2200), ou o ano corrente. */
export function lerAno(s: unknown) {
  const r = anoSchema.safeParse(typeof s === "string" ? s : undefined);
  return r.success ? r.data : Number(hoje().slice(0, 4));
}
export const primeiroDiaDoMes = (d: string) => d.slice(0, 7) + "-01";
export const somenteDigitos = (s: string) => s.replace(/\D/g, "");
export function fmtCnpj(c: string) { return c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5"); }
export function fmtCpf(c: string) { return c.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4"); }
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
/** "2025-12-31" → "31 de dezembro de 2025". */
export const fmtDataExtenso = (d: string) => `${Number(d.slice(8, 10))} de ${MESES[Number(d.slice(5, 7)) - 1]} de ${d.slice(0, 4)}`;
export const REGIMES = { simples: "Simples Nacional", presumido: "Lucro Presumido", real: "Lucro Real" } as const;
export const NATUREZAS = { D: "Devedora", C: "Credora" } as const;
export const GRUPOS_DRE = {
  receita_bruta: "Receita bruta",
  deducoes: "Deduções",
  custos: "Custos",
  despesas_operacionais: "Despesas operacionais",
  receitas_financeiras: "Receitas financeiras",
  despesas_financeiras: "Despesas financeiras",
  outras_receitas: "Outras receitas",
  outras_despesas: "Outras despesas",
  tributos_lucro: "Tributos sobre o lucro",
} as const;
export const PAPEIS = {
  lucros_acumulados: "Lucros acumulados",
  prejuizos_acumulados: "Prejuízos acumulados",
  clientes: "Clientes",
  fornecedores: "Fornecedores",
} as const;
