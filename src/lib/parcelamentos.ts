/**
 * Parcelamento de tributos: reconhece a dívida consolidada (principal + multa + juros) em Parcelamentos de Tributos,
 * curto prazo (as próximas 12 parcelas) e longo prazo (o resto); cada parcela é um título a pagar na conta dela, baixado
 * pela conciliação. "Transferir para curto prazo" leva do LP para o CP as parcelas que vencem em até 12 meses.
 */
import { cents, fromCents, somarMeses } from "./format";
import type { PartidaInput } from "./lancamentos";

export const PARCELAS_CP = 12;

export type Parcela = { numero: number; vencimento: string; valor: number };

/** Parcelas mensais (centavos): n − 1 no valor informado e a última com o resto, para somar o total exato. */
export function parcelasDoParcelamento(p: { total: number; n: number; valorParcela: number; primeiroVencimento: string }): Parcela[] {
  if (!Number.isInteger(p.n) || p.n < 1 || p.n > 240) throw new Error("Número de parcelas entre 1 e 240");
  if (!(p.total > 0)) throw new Error("A dívida consolidada precisa ser maior que zero");
  if (!(p.valorParcela > 0)) throw new Error("Valor da parcela precisa ser maior que zero");
  const ultima = p.total - (p.n - 1) * p.valorParcela;
  if (ultima <= 0) throw new Error(`${p.n} parcelas de ${fromCents(p.valorParcela)} passam da dívida consolidada (${fromCents(p.total)}): reduza o valor ou as parcelas`);
  return Array.from({ length: p.n }, (_, i) => ({
    numero: i + 1, vencimento: somarMeses(p.primeiroVencimento, i), valor: i === p.n - 1 ? ultima : p.valorParcela,
  }));
}

/** Valor sugerido da parcela: o total dividido igualmente (centavos, arredondado). */
export const parcelaSugerida = (total: number, n: number) => (n > 0 ? Math.round(total / n) : 0);

/** CP = as próximas 12 parcelas; LP = o resto (centavos). */
export function divisaoCpLp(parcelas: Parcela[]) {
  const cp = parcelas.slice(0, PARCELAS_CP).reduce((s, x) => s + x.valor, 0);
  const lp = parcelas.slice(PARCELAS_CP).reduce((s, x) => s + x.valor, 0);
  return { cp, lp };
}

/**
 * Reconhecimento: D principal (a obrigação original, se já reconhecida, ou a despesa do tributo) + D multa + D juros /
 * C Parcelamentos CP + C Parcelamentos LP.
 */
export function partidasParcelamento(p: {
  principal: number; multa: number; juros: number; cp: number; lp: number;
  contaPrincipalId: string; contaMultaId: string | null; contaJurosId: string | null; contaCpId: string; contaLpId: string;
}): PartidaInput[] {
  if (p.principal + p.multa + p.juros !== p.cp + p.lp) throw new Error("Principal + multa + juros difere da soma das parcelas");
  if (p.multa && !p.contaMultaId) throw new Error("Escolha a conta da multa");
  if (p.juros && !p.contaJurosId) throw new Error("Escolha a conta dos juros");
  const f = fromCents;
  return [
    ...(p.principal ? [{ contaId: p.contaPrincipalId, debito: f(p.principal) }] : []),
    ...(p.multa ? [{ contaId: p.contaMultaId!, debito: f(p.multa) }] : []),
    ...(p.juros ? [{ contaId: p.contaJurosId!, debito: f(p.juros) }] : []),
    ...(p.cp ? [{ contaId: p.contaCpId, credito: f(p.cp) }] : []),
    ...(p.lp ? [{ contaId: p.contaLpId, credito: f(p.lp) }] : []),
  ];
}

export type ParcelaAberta = { id: string; vencimento: string | null; contaId: string | null; saldo: number };

/** Parcelas no LP com saldo que vencem em até 12 meses da data (inclusive): vão para o CP. */
export function parcelasParaCurtoPrazo<T extends ParcelaAberta>(ps: T[], contaLpId: string, data: string) {
  const limite = somarMeses(data, PARCELAS_CP);
  return ps.filter((x) => x.contaId === contaLpId && x.saldo > 0 && !!x.vencimento && x.vencimento <= limite);
}

export type ParcelamentoInput = {
  empresaId: string; descricao: string; principal: string; multa: string; juros: string; nParcelas: number; valorParcela: string;
  primeiroVencimento: string; data: string; contaPrincipalId: string; contaMultaId: string | null; contaJurosId: string | null;
  contaCpId: string; contaLpId: string; contraparte?: string; usuarioId?: string | null;
};

/** Parcelas, divisão CP/LP e partidas do parcelamento (puro: a prévia do cliente usa o mesmo). */
export function montarParcelamento(p: Omit<ParcelamentoInput, "empresaId" | "usuarioId">) {
  const principal = cents(p.principal), multa = cents(p.multa || 0), juros = cents(p.juros || 0);
  if ([principal, multa, juros].some((x) => Number.isNaN(x) || x < 0)) throw new Error("Principal, multa e juros: zero ou mais");
  if (p.contaCpId === p.contaLpId) throw new Error("Contas de curto e longo prazo precisam ser diferentes");
  const parcelas = parcelasDoParcelamento({ total: principal + multa + juros, n: p.nParcelas, valorParcela: cents(p.valorParcela), primeiroVencimento: p.primeiroVencimento });
  const { cp, lp } = divisaoCpLp(parcelas);
  const ps = partidasParcelamento({
    principal, multa, juros, cp, lp, contaPrincipalId: p.contaPrincipalId, contaMultaId: p.contaMultaId, contaJurosId: p.contaJurosId,
    contaCpId: p.contaCpId, contaLpId: p.contaLpId,
  });
  return { parcelas, cp, lp, partidas: ps, historico: `Parcelamento: ${p.descricao} (${p.nParcelas} parcelas)` };
}

export type MovimentoCurtoPrazo = { parcelamentoId: string; descricao: string; parcelas: number[]; valor: number; contaLpId: string; contaCpId: string };

