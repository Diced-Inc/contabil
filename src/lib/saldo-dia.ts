/** Motivo gravado nas linhas de saldo ignoradas na importação (aparece na aba Ignoradas). */
export const MOTIVO_SALDO_DIA = "Saldo do dia (ignorado automaticamente na importação)";

const SALDO = /^saldo (total )?(disponivel|anterior|do dia|final|em c\/?c)\b/;

/**
 * Linha de saldo que o banco põe no extrato como se fosse movimento ("SALDO TOTAL DISPONÍVEL DIA" do Itaú,
 * "SALDO ANTERIOR"...). Ancorado no começo do memo: "PIX SALDO DEVEDOR" ou "TED ... SALDO" não casam.
 */
export function linhaDeSaldo(memo: string) {
  const m = memo.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
  return SALDO.test(m);
}
