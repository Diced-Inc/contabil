const brl = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const cents = (v: string | number) => Math.round(Number(v) * 100);
export const fromCents = (c: number) => (c / 100).toFixed(2);
export const fmtValor = (v: string | number) => brl.format(Number(v));
/** saldo = débito − crédito. Positivo → D, negativo → C, zero → natureza */
export function fmtSaldoDC(v: string | number, natureza: "D" | "C") {
  const n = Number(v);
  if (n === 0) return `0,00${natureza}`;
  return `${brl.format(Math.abs(n))}${n > 0 ? "D" : "C"}`;
}
export const fmtData = (d: string | Date) => new Date(typeof d === "string" ? d + "T00:00:00" : d).toLocaleDateString("pt-BR");
export const fmtCompetencia = (d: string) => `${d.slice(5, 7)}/${d.slice(0, 4)}`;
export const hoje = () => new Date().toISOString().slice(0, 10);
export const primeiroDiaDoMes = (d: string) => d.slice(0, 7) + "-01";
export const somenteDigitos = (s: string) => s.replace(/\D/g, "");
export function fmtCnpj(c: string) { return c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5"); }
export const REGIMES = { simples: "Simples Nacional", presumido: "Lucro Presumido", real: "Lucro Real" } as const;
