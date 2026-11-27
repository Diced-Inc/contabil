import type { ContaOpcao } from "@/components/conta-select";
import { cents, fromCents } from "@/lib/format";
import { historicoTitulo, partidasTitulo, type LancPrevia, type TipoTitulo } from "@/lib/operacoes";
import { dataDaNota } from "@/lib/notas";
import { acharConta, contaRetencao, NOMES_RETENCAO, type TipoRetencao } from "@/lib/tributos";

export type RetencaoEscolha = { tipo: TipoRetencao; valor: string; contaId?: string | null };

/**
 * Conta de cada retenção: a escolhida, a do mapa no plano, ou uma "nova" (o servidor cria na hora de registrar).
 * Sem conta possível (Outras retenções), lança pedindo a escolha.
 */
export function contasDasRetencoes(tipo: TipoTitulo, rs: RetencaoEscolha[], contas: ContaOpcao[]) {
  const novas: ContaOpcao[] = [];
  const ids = rs.map((r) => {
    if (r.contaId) return r.contaId;
    const alvo = contaRetencao(tipo, r.tipo);
    const c = acharConta(contas, alvo);
    if (c) return c.id;
    if (!alvo?.criar) throw new Error(`Escolha a conta de ${NOMES_RETENCAO[r.tipo]}.`);
    const id = `nova:${alvo.criar.nome}`;
    if (!novas.some((n) => n.id === id)) novas.push({ id, codigo: `${alvo.criar.pai}.nova`, nome: `${alvo.criar.nome} (será criada)` });
    return id;
  });
  return { ids, novas };
}

/** Prévia dos reconhecimentos da nota (um por parcela; retenções na primeira), com as mesmas funções do servidor. */
export function previaNota(p: {
  tipo: TipoTitulo; contas: ContaOpcao[]; contaResultadoId: string | null; emissao: string; competencia: string; contraparte: string;
  rotulo: string; retencoes: RetencaoEscolha[]; parcelas: { valor: string }[];
}): { previa: LancPrevia[]; novas: ContaOpcao[] } {
  if (!p.contaResultadoId) throw new Error(`Escolha a conta de ${p.tipo === "receber" ? "receita" : "custo ou despesa"}.`);
  const papel = p.contas.find((c) => c.papel === (p.tipo === "receber" ? "clientes" : "fornecedores"));
  if (!papel) throw new Error(`Marque a conta de papel ${p.tipo === "receber" ? "Clientes" : "Fornecedores"} no plano de contas.`);
  if (!p.emissao || !/^\d{4}-\d{2}-01$/.test(p.competencia)) throw new Error("Informe a emissão e a competência.");
  const rs = p.retencoes.filter((r) => cents(r.valor) > 0);
  const { ids, novas } = contasDasRetencoes(p.tipo, rs, p.contas);
  const data = dataDaNota(p.emissao, p.competencia);
  const varias = p.parcelas.length > 1;
  return {
    novas,
    previa: p.parcelas.map((x, i) => ({
      data, competencia: p.competencia,
      historico: historicoTitulo(p.tipo, p.contraparte, varias ? `${p.rotulo} ${i + 1}/${p.parcelas.length}` : p.rotulo),
      partidas: partidasTitulo(p.tipo, papel.id, p.contaResultadoId!, fromCents(cents(x.valor)),
        i === 0 ? rs.map((r, k) => ({ contaId: ids[k], valor: r.valor })) : []),
    })),
  };
}
