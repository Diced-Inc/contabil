/**
 * Adiantamentos (puro): recebimento antes da receita (de cliente, passivo) e pagamento antes da despesa (a fornecedor,
 * ativo), a compensação com o título da contraparte e o saldo em aberto. Decisão do Bruno: receita não reconhecida
 * (competência depois do extrato) vai para Adiantamentos de Clientes, nunca para Clientes.
 */
import { cents, fromCents } from "./format";
import type { PartidaInput } from "./lancamentos";
import { similaridadeNome, type TipoTitulo } from "./operacoes";
import type { AlvoConta } from "./tributos";

export type TipoAdiantamento = "cliente" | "fornecedor";
export const tipoDoTitulo = (t: TipoTitulo): TipoAdiantamento => (t === "receber" ? "cliente" : "fornecedor");
export const tipoDaEntrada = (entrada: boolean): TipoAdiantamento => (entrada ? "cliente" : "fornecedor");
export const NOMES_ADIANTAMENTO: Record<TipoAdiantamento, string> = { cliente: "Adiantamentos de Clientes", fornecedor: "Adiantamentos a Fornecedores" };

/** Conta do adiantamento: a do seed (2.1.5.05 / 1.1.4.04) pelo nome, ou criada sob demanda no grupo. */
export const CONTA_ADIANTAMENTO: Record<TipoAdiantamento, AlvoConta> = {
  cliente: { prefixo: "2.1", re: /^adiantamentos? de clientes?$/, criar: { pai: "2.1.5", nome: NOMES_ADIANTAMENTO.cliente, natureza: "C" } },
  fornecedor: { prefixo: "1.1", re: /^adiantamentos? a fornecedor(es)?$/, criar: { pai: "1.1.4", nome: NOMES_ADIANTAMENTO.fornecedor, natureza: "D" } },
};

/** CPF/CNPJ no memo do extrato (com ou sem máscara), só dígitos; o primeiro que aparecer. */
export function documentoDoMemo(memo: string) {
  const m = /\b(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}|\d{3}\.?\d{3}\.?\d{3}-?\d{2})\b/.exec(memo);
  return m ? m[1].replace(/\D/g, "") : null;
}

/** Adiantamento pelo banco: de cliente D Banco / C Adiantamentos de Clientes; a fornecedor D Adiantamentos a Fornecedores / C Banco. */
export function partidasAdiantamento(tipo: TipoAdiantamento, contaBancoId: string, contaAdiantamentoId: string, valor: string): PartidaInput[] {
  const v = fromCents(Math.abs(cents(valor)));
  if (!(cents(v) > 0)) throw new Error("Valor do adiantamento deve ser maior que zero");
  return tipo === "cliente"
    ? [{ contaId: contaBancoId, debito: v }, { contaId: contaAdiantamentoId, credito: v }]
    : [{ contaId: contaAdiantamentoId, debito: v }, { contaId: contaBancoId, credito: v }];
}

/**
 * Compensação com o título (sem banco), na competência do título: a receber D Adiantamentos de Clientes / C Clientes;
 * a pagar D Fornecedores / C Adiantamentos a Fornecedores.
 */
export function partidasCompensacao(tipo: TipoTitulo, contaTituloId: string, contaAdiantamentoId: string, valor: string): PartidaInput[] {
  const v = fromCents(cents(valor));
  if (!(cents(v) > 0)) throw new Error("Valor a compensar deve ser maior que zero");
  return tipo === "receber"
    ? [{ contaId: contaAdiantamentoId, debito: v }, { contaId: contaTituloId, credito: v }]
    : [{ contaId: contaTituloId, debito: v }, { contaId: contaAdiantamentoId, credito: v }];
}

/** Saldo em aberto (centavos): adiantado − compensado. */
export const saldoAdiantamento = (valor: string | number, compensado: string | number) => cents(valor) - cents(compensado);

/**
 * Valor a compensar: o informado, ou o menor entre os saldos; recusa o que passa do título ou do adiantamento.
 * Saldos e valor em centavos.
 */
export function valorCompensacao(saldoTitulo: number, saldoAdiant: number, informado?: number) {
  const v = informado ?? Math.min(saldoTitulo, saldoAdiant);
  if (!(v > 0)) throw new Error("Nada a compensar: título ou adiantamento sem saldo");
  if (v > saldoTitulo) throw new Error(`Compensação de ${fromCents(v)} passa do saldo do título (${fromCents(saldoTitulo)})`);
  if (v > saldoAdiant) throw new Error(`Compensação de ${fromCents(v)} passa do saldo do adiantamento (${fromCents(saldoAdiant)})`);
  return v;
}

type Parte = { contraparte: string; contraparteDocumento?: string | null };
const doc = (s?: string | null) => (s ?? "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();

/** Mesma contraparte: CPF/CNPJ iguais quando os dois têm; senão o nome (palavras de 3+ letras) parecido nos dois sentidos. */
export function mesmaContraparte(a: Parte, b: Parte) {
  const da = doc(a.contraparteDocumento), db = doc(b.contraparteDocumento);
  if (da && db) return da === db;
  return Math.min(similaridadeNome(a.contraparte, b.contraparte), similaridadeNome(b.contraparte, a.contraparte)) >= 0.6;
}

/** Adiantamentos com saldo da contraparte do título, do tipo certo (receber ↔ cliente, pagar ↔ fornecedor). */
export function adiantamentosDoTitulo<T extends Parte & { tipo: TipoAdiantamento; saldo: number }>(titulo: Parte & { tipo: TipoTitulo }, ads: T[]) {
  return ads.filter((a) => a.tipo === tipoDoTitulo(titulo.tipo) && a.saldo > 0 && mesmaContraparte(titulo, a));
}

export const DIAS_ADIANTAMENTO_ANTIGO = 90;

/** Adiantamentos com saldo há mais de `dias` (data ≤ hoje − dias). */
export function adiantamentosAntigos<T extends { data: string; saldo: number }>(ads: T[], hoje: string, dias = DIAS_ADIANTAMENTO_ANTIGO) {
  const limite = new Date(Date.parse(`${hoje}T00:00:00Z`) - dias * 86_400_000).toISOString().slice(0, 10);
  return ads.filter((a) => a.saldo > 0 && a.data <= limite);
}
