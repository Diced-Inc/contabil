/**
 * Saldos iniciais (puro, roda no cliente e no servidor): partidas do lançamento de abertura, leitura e casamento do
 * CSV do balancete com o plano, e saldo do extrato na data da abertura.
 */
import { dividir, parseValor } from "./csv";
import { cents, fmtValor, fromCents } from "./format";
import type { PartidaInput } from "./lancamentos";
import { norm } from "./tributos";

export type ContaAbertura = { id: string; codigo: string; nome: string; natureza: "D" | "C"; tipo: "analitica" | "sintetica" };
/** Só contas patrimoniais (classes 1 e 2) têm saldo inicial; o resultado começa zerado. */
export const patrimonial = (codigo: string) => /^[12](\.|$)/.test(codigo);

/** Saldo de uma conta em centavos, D − C (positivo devedor). */
export type SaldoConta = { contaId: string; saldo: number };

/**
 * Uma partida por conta com saldo. D ≠ C é erro, salvo `diferenca`: a sobra vai para Lucros acumulados (crédito, se
 * sobram débitos) ou Prejuízos acumulados (débito, se sobram créditos).
 */
export function partidasAbertura(saldos: SaldoConta[], diferenca?: { lucrosId: string; prejuizosId: string } | null) {
  const partidas: PartidaInput[] = [];
  let total = 0;
  for (const s of saldos) {
    if (!Number.isInteger(s.saldo)) throw new Error("Saldo inválido");
    if (s.saldo === 0) continue;
    partidas.push(s.saldo > 0 ? { contaId: s.contaId, debito: fromCents(s.saldo) } : { contaId: s.contaId, credito: fromCents(-s.saldo) });
    total += s.saldo;
  }
  if (total !== 0) {
    if (!diferenca)
      throw new Error(`Débitos e créditos não fecham (diferença de R$ ${fmtValor(fromCents(Math.abs(total)))}): corrija os saldos ou lance a diferença em Lucros/Prejuízos acumulados`);
    partidas.push(total > 0 ? { contaId: diferenca.lucrosId, credito: fromCents(total) } : { contaId: diferenca.prejuizosId, debito: fromCents(-total) });
  }
  if (partidas.length < 2) throw new Error("Informe o saldo de ao menos duas contas");
  return { partidas, diferenca: total };
}

export type LinhaCsv = { linha: number; codigo: string; nome: string; saldo: number; natureza: "D" | "C" | null };

const COLUNAS = {
  codigo: /^(cod|classifica)/,
  nome: /^(nome|descri|conta)/,
  saldo: /^(saldo|valor)/,
  natureza: /^(nat|d\/?c$|tipo)/,
} as const;

/** "D", "Devedor(a)" → D; "C", "Credor(a)" → C. */
const lado = (s: string): "D" | "C" | null => (/^d/i.test(s.trim()) ? "D" : /^c/i.test(s.trim()) ? "C" : null);

/**
 * CSV do balancete com cabeçalho: código e/ou nome, saldo e natureza (D/C, opcional). Separador ; , ou tab. Saldo pode
 * vir com o lado no fim ("1.234,56 D"). Linhas sem saldo ou com saldo zero são puladas.
 */
export function lerCsvAbertura(texto: string): LinhaCsv[] {
  const linhas = texto.replace(/^\uFEFF/, "").split(/\r?\n/);
  const i0 = linhas.findIndex((l) => l.trim());
  if (i0 < 0) throw new Error("Arquivo vazio");
  const sep = [";", "\t", ","].find((s) => linhas[i0].includes(s)) ?? ";";
  const cab = dividir(linhas[i0], sep).map(norm);
  const col = (re: RegExp, menos = -1) => cab.findIndex((c, i) => i !== menos && re.test(c));
  const codigo = col(COLUNAS.codigo);
  const nome = col(COLUNAS.nome, codigo);
  const saldo = col(COLUNAS.saldo);
  const natureza = col(COLUNAS.natureza);
  if (saldo < 0 || (codigo < 0 && nome < 0))
    throw new Error("Cabeçalho não reconhecido: use as colunas codigo (ou nome), saldo e natureza (D/C)");
  const out: LinhaCsv[] = [];
  linhas.forEach((l, i) => {
    if (i <= i0 || !l.trim()) return;
    const c = dividir(l, sep).map((x) => x.trim());
    let bruto = c[saldo] ?? "";
    let nat = natureza >= 0 ? lado(c[natureza] ?? "") : null;
    const sufixo = /\s*([DC])$/i.exec(bruto);
    if (sufixo) { nat ??= lado(sufixo[1]); bruto = bruto.slice(0, sufixo.index); }
    const v = parseValor(bruto);
    if (v === null || cents(v) === 0) return;
    const n = nome >= 0 ? c[nome] ?? "" : "";
    // coluna "Conta" com códigos: vale como código
    const cod = codigo >= 0 ? c[codigo] ?? "" : /^\d+(\.\d+)*$/.test(n) ? n : "";
    out.push({ linha: i + 1, codigo: cod, nome: cod === n ? "" : n, saldo: cents(v), natureza: nat });
  });
  return out;
}

export type Pendente = LinhaCsv & { motivo: string };

/**
 * Casa as linhas do CSV com as analíticas patrimoniais: pelo código, senão pelo nome normalizado (único). Saldo no
 * lado da natureza informada (sem ela, no da conta); negativo inverte. Linhas da mesma conta somam. Linhas de
 * sintéticas são totais do balancete e ficam de fora (`ignoradas`); o resto sem conta vai para `pendentes`.
 */
export function casarCsv(linhas: LinhaCsv[], contas: ContaAbertura[]) {
  const saldos = new Map<string, number>();
  const pendentes: Pendente[] = [];
  let ignoradas = 0;
  const porNome = (n: string) => {
    const xs = contas.filter((c) => c.tipo === "analitica" && patrimonial(c.codigo) && norm(c.nome) === norm(n));
    return xs.length === 1 ? xs[0] : null;
  };
  for (const l of linhas) {
    const pc = l.codigo ? contas.find((c) => c.codigo === l.codigo) : undefined;
    if (pc?.tipo === "sintetica") { ignoradas++; continue; }
    const conta = pc ?? (l.nome ? porNome(l.nome) : null);
    if (!conta) { pendentes.push({ ...l, motivo: "Sem conta no plano" }); continue; }
    if (!patrimonial(conta.codigo)) { pendentes.push({ ...l, motivo: `${conta.codigo} é de resultado: apure antes da abertura` }); continue; }
    const valor = l.saldo * ((l.natureza ?? conta.natureza) === "D" ? 1 : -1);
    saldos.set(conta.id, (saldos.get(conta.id) ?? 0) + valor);
  }
  return { saldos, pendentes, ignoradas };
}

/** Saldo do extrato no fim do dia `data`, a partir do saldo de um OFX (em `dataSaldo`) e dos movimentos por dia. */
export function saldoExtratoNaData(ref: { saldo: number; dataSaldo: string }, dias: { data: string; valor: number }[], data: string) {
  let s = ref.saldo;
  for (const d of dias) {
    if (d.data > data && d.data <= ref.dataSaldo) s -= d.valor;
    else if (d.data > ref.dataSaldo && d.data <= data) s += d.valor;
  }
  return s;
}
