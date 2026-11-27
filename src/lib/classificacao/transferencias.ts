export type TxCand = { id: string; contaBancariaId: string; data: string; valor: string };

const utc = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const dias = (a: string, b: string) => Math.abs(utc(a) - utc(b)) / 86400000;
const centavos = (v: string) => Math.round(Number(v) * 100);

/** Pares [saída, entrada] entre contas diferentes, mesmo valor invertido, até 2 dias. Cada transação entra em no máximo um par. */
export function parearTransferencias(txs: TxCand[]): Array<[string, string]> {
  const usados = new Set<string>();
  const pares: Array<[string, string]> = [];
  const entradas = txs.filter((t) => centavos(t.valor) > 0);
  for (const s of txs) {
    const v = centavos(s.valor);
    if (v >= 0) continue;
    const e = entradas.find((x) => !usados.has(x.id) && x.contaBancariaId !== s.contaBancariaId
      && centavos(x.valor) === -v && dias(x.data, s.data) <= 2);
    if (e) { usados.add(e.id); pares.push([s.id, e.id]); }
  }
  return pares;
}

const CPF = /\d{3}\.?\d{3}\.?\d{3}-\d{2}/;
const semAcento = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/**
 * Pendente que parece transferência para/da própria empresa: CNPJ da empresa no memo, ou o primeiro nome da razão
 * social (5+ letras) sem CPF no memo (empresa com o nome do sócio: o PIX ao sócio traz o CPF dele).
 */
export function pareceTransferenciaPropria(memo: string, empresa: { cnpj: string; razaoSocial: string }) {
  const cnpj = empresa.cnpj.replace(/\D/g, "");
  if (cnpj.length === 14 && memo.replace(/\D/g, "").includes(cnpj)) return true;
  if (CPF.test(memo)) return false;
  const nome = semAcento(empresa.razaoSocial).match(/[a-z]+/)?.[0] ?? "";
  return nome.length >= 5 && semAcento(memo).replace(/\d+/g, " ").split(/[^a-z]+/).includes(nome);
}

/** Contrapartida do "Zerar manualmente" enquanto a outra conta bancária não é cadastrada. */
export const NOME_OUTRA_CONTA = "Bancos – Outra Conta (a cadastrar)";
