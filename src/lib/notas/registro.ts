/**
 * Registro da nota fiscal (XML importado ou cadastro manual): um título por duplicata/parcela, cada um com o seu
 * reconhecimento na competência (mês aberto); as retenções entram no reconhecimento da primeira.
 */
import { and, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { partidas, planoContas, titulos } from "@/db/schema";
import { cents, fmtCompetencia, fromCents, primeiroDiaDoMes } from "../format";
import { mesesFechados } from "../lancamentos";
import { contaSobDemanda } from "../conciliacao";
import { acharConta, contaRetencao, NOMES_RETENCAO, type TipoRetencao } from "../tributos";
import { criarTitulo } from "../titulos";
import { dataDaNota, rotuloNota, type Direcao, type OrigemNota, type Parte } from "./index";

export class NotaDuplicada extends Error {}

export type NotaParaRegistrar = {
  empresaId: string; origem: OrigemNota | "manual"; tipo: Direcao; chave: string; numero: string; serie: string | null;
  emissao: string; competencia: string; contraparte: Parte; bruto: string;
  retencoes: { tipo: TipoRetencao; valor: string; contaId?: string | null }[];
  contaResultadoId: string; parcelas: { valor: string; vencimento: string | null }[]; descricao?: string | null;
  usuarioId?: string | null;
};

/** Chaves que já têm título não cancelado. */
export async function chavesRegistradas(tx: Pick<Tx, "selectDistinct">, empresaId: string, chaves: string[]) {
  if (!chaves.length) return new Set<string>();
  const rs = await tx.selectDistinct({ chave: titulos.documentoChave }).from(titulos)
    .where(and(eq(titulos.empresaId, empresaId), inArray(titulos.documentoChave, chaves), ne(titulos.status, "cancelado")));
  return new Set(rs.map((r) => r.chave!));
}

/** Última contrapartida usada numa nota (receita das emitidas, custo/despesa das recebidas): o padrão da próxima. */
export async function contrapartidasLembradas(tx: Pick<Tx, "select">, empresaId: string) {
  const ultima = async (tipo: Direcao) => {
    const [r] = await tx.select({ contaId: partidas.contaId }).from(titulos)
      .innerJoin(partidas, eq(partidas.lancamentoId, titulos.lancamentoId))
      .where(and(
        eq(titulos.empresaId, empresaId), eq(titulos.tipo, tipo), isNotNull(titulos.documentoChave), inArray(titulos.origem, ["manual", "nfe", "nfse"]),
        tipo === "receber" ? sql`${partidas.credito} > 0` : sql`${partidas.debito} > 0`,
        sql`not exists (select 1 from plano_contas pc where pc.id = ${partidas.contaId} and (pc.papel is not null or pc.codigo like '2%' or pc.codigo like '1%'))`,
      ))
      .orderBy(desc(titulos.createdAt)).limit(1);
    return r?.contaId ?? null;
  };
  return { receber: await ultima("receber"), pagar: await ultima("pagar") };
}

export async function registrarNota(tx: Tx, n: NotaParaRegistrar) {
  const retencoes = n.retencoes.filter((r) => cents(r.valor) !== 0);
  if (retencoes.some((r) => !(cents(r.valor) > 0))) throw new Error("Retenção precisa ser maior que zero");
  const liquido = cents(n.bruto) - retencoes.reduce((s, r) => s + cents(r.valor), 0);
  if (!(liquido > 0)) throw new Error("Retenções não podem passar do valor bruto");
  const somaParcelas = n.parcelas.reduce((s, p) => s + cents(p.valor), 0);
  if (!n.parcelas.length || somaParcelas !== liquido || n.parcelas.some((p) => !(cents(p.valor) > 0)))
    throw new Error(`Parcelas somam ${fromCents(somaParcelas)}; o líquido da nota é ${fromCents(liquido)}`);
  const data = dataDaNota(n.emissao, n.competencia);
  if ((await mesesFechados(tx, n.empresaId)).has(primeiroDiaDoMes(data)))
    throw new Error(`O mês ${fmtCompetencia(data)} está fechado: reabra-o em Fechamento para registrar a nota`);
  if ((await chavesRegistradas(tx, n.empresaId, [n.chave])).size) throw new NotaDuplicada("Nota já registrada");

  const contas = await tx
    .select({ id: planoContas.id, codigo: planoContas.codigo, nome: planoContas.nome, papel: planoContas.papel })
    .from(planoContas)
    .where(and(eq(planoContas.empresaId, n.empresaId), eq(planoContas.tipo, "analitica"), eq(planoContas.ativa, true)));
  const contasRet = [];
  for (const r of retencoes) {
    let contaId = r.contaId ?? null;
    if (!contaId) {
      const alvo = contaRetencao(n.tipo, r.tipo);
      contaId = acharConta(contas, alvo)?.id
        ?? (alvo?.criar ? (await contaSobDemanda(tx, n.empresaId, { paiCodigo: alvo.criar.pai, nome: alvo.criar.nome, natureza: alvo.criar.natureza })).id : null);
    }
    if (!contaId) throw new Error(`Escolha a conta de ${NOMES_RETENCAO[r.tipo]}`);
    contasRet.push({ contaId, valor: fromCents(cents(r.valor)) });
  }

  const rotulo = rotuloNota(n.origem, n.numero, n.serie);
  const varias = n.parcelas.length > 1;
  const ts = [];
  for (const [i, p] of n.parcelas.entries())
    ts.push(await criarTitulo(tx, {
      empresaId: n.empresaId, tipo: n.tipo, contraparte: n.contraparte.nome || n.contraparte.documento,
      contraparteDocumento: n.contraparte.documento || null, documento: varias ? `${rotulo} ${i + 1}/${n.parcelas.length}` : rotulo,
      descricao: n.descricao?.trim() || rotulo, valor: p.valor, competencia: data, vencimento: p.vencimento,
      contaResultadoId: n.contaResultadoId, retencoes: i === 0 ? contasRet : [], origem: n.origem, documentoChave: n.chave,
      parcela: varias ? i + 1 : null, usuarioId: n.usuarioId,
    }));
  return ts;
}
