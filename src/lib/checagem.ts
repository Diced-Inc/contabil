import { sql } from "drizzle-orm";
import { db } from "@/db";
import { listarContasComSaldo } from "@/app/e/[id]/bancos/queries";
import { carregarEstado, mesesDoAno } from "./fechamento";
import { cents, fmtCompetencia, fmtData, fmtValor, hoje, primeiroDiaDoMes } from "./format";
import { balanco } from "./relatorios/balanco";
import { saldos, type LinhaSaldo } from "./relatorios/saldos";

export type StatusChecagem = "ok" | "alerta" | "erro";
export type ItemChecagem = {
  id: string;
  titulo: string;
  status: StatusChecagem;
  detalhe: string;
  link?: string;
  /** Detalhamento opcional (até 10 linhas), cada uma com link. */
  itens?: { texto: string; link: string }[];
};

const LIMITE_SEM_DOCUMENTO = 1000;

/** Analíticas com saldo contrário à natureza (D com saldo credor, C com saldo devedor); retificadoras já têm a natureza certa. */
export function naturezaInvertida(linhas: Pick<LinhaSaldo, "id" | "codigo" | "nome" | "natureza" | "tipo" | "saldoAtual">[]) {
  return linhas.filter((l) => {
    if (l.tipo !== "analitica") return false;
    const s = cents(l.saldoAtual);
    return l.natureza === "D" ? s < 0 : s > 0;
  });
}

/**
 * Competências "YYYY-MM-01" do ano sem nenhum lançamento, do mês de `inicio` (primeiro lançamento/OFX da empresa)
 * até `ate`; o mês de `hoje` só conta a partir do dia 10.
 */
export function mesesSemLancamento(ano: number, comLancamento: Iterable<string>, p: { ate: string; inicio: string; hoje: string }) {
  const com = new Set(comLancamento);
  const desde = primeiroDiaDoMes(p.inicio);
  const mesHoje = Number(p.hoje.slice(8, 10)) < 10 ? primeiroDiaDoMes(p.hoje) : "";
  return mesesDoAno(ano).filter((m) => m >= desde && m <= p.ate && m !== mesHoje && !com.has(m));
}

type SocioMes = { mes: string; status: "aprovado" | "estornado"; origem: string; socio: number; proLabore: number };
/** Meses com saída a sócio (débito em conta de sócio) e nenhum débito em pró-labore; ignora estornados, estornos e apuração. */
export function mesesSocioSemProLabore(linhas: SocioMes[]) {
  const porMes = new Map<string, { socio: number; proLabore: number }>();
  for (const l of linhas) {
    if (l.status === "estornado" || l.origem === "estorno" || l.origem === "apuracao") continue;
    const m = porMes.get(l.mes) ?? { socio: 0, proLabore: 0 };
    porMes.set(l.mes, { socio: m.socio + l.socio, proLabore: m.proLabore + l.proLabore });
  }
  return [...porMes].filter(([, m]) => m.socio > 0 && m.proLabore === 0).map(([mes]) => mes);
}

export function resumir(itens: ItemChecagem[]) {
  const n = (s: StatusChecagem) => itens.filter((i) => i.status === s).length;
  return { ok: n("ok"), alerta: n("alerta"), erro: n("erro") };
}

const listaMeses = (ms: string[]) => ms.map(fmtCompetencia).join(", ");

/** Checagens de consistência do exercício `ano` (até hoje, se for o ano corrente). */
export async function checar(empresaId: string, ano: number): Promise<ItemChecagem[]> {
  const ini = `${ano}-01-01`;
  const dez = `${ano}-12-31`;
  const fim = dez < hoje() ? dez : hoje();
  const base = `/e/${empresaId}`;

  const [bal, bancos, estado, linhas, pendentes, semDoc, porMes, socio, vencidos, inicio] = await Promise.all([
    balanco(empresaId, ano),
    listarContasComSaldo(empresaId, fim),
    carregarEstado(db, empresaId),
    saldos(empresaId, ini, fim),
    db.execute<{ mes: string; n: number }>(sql`
      SELECT date_trunc('month', t.data)::date::text AS mes, count(*)::int AS n
      FROM transacoes_bancarias t JOIN contas_bancarias cb ON cb.id = t.conta_bancaria_id
      WHERE cb.empresa_id = ${empresaId} AND t.status = 'pendente' AND t.data BETWEEN ${ini} AND ${fim}
      GROUP BY 1`),
    db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM lancamentos l
      WHERE l.empresa_id = ${empresaId} AND l.status = 'aprovado' AND l.origem NOT IN ('apuracao', 'estorno')
        AND coalesce(trim(l.documento), '') = '' AND l.data BETWEEN ${ini} AND ${fim}
        AND (SELECT sum(p.debito) FROM partidas p WHERE p.lancamento_id = l.id) >= ${LIMITE_SEM_DOCUMENTO}`),
    db.execute<{ mes: string }>(sql`
      SELECT DISTINCT date_trunc('month', data)::date::text AS mes FROM lancamentos
      WHERE empresa_id = ${empresaId} AND data BETWEEN ${ini} AND ${fim}`),
    db.execute<{ mes: string; status: "aprovado" | "estornado"; origem: string; socio: string; prolabore: string }>(sql`
      SELECT date_trunc('month', l.data)::date::text AS mes, l.status, l.origem,
        coalesce(sum(p.debito) FILTER (WHERE pc.nome ~* 's[óo]cio'), 0)::text AS socio,
        coalesce(sum(p.debito) FILTER (WHERE pc.nome ~* 'pr[óo][- ]?labore'), 0)::text AS prolabore
      FROM lancamentos l JOIN partidas p ON p.lancamento_id = l.id JOIN plano_contas pc ON pc.id = p.conta_id
      WHERE l.empresa_id = ${empresaId} AND l.data BETWEEN ${ini} AND ${fim}
      GROUP BY 1, 2, 3`),
    db.execute<{ tipo: "receber" | "pagar"; n: number }>(sql`
      SELECT tipo, count(*)::int AS n FROM titulos
      WHERE empresa_id = ${empresaId} AND status = 'aberto' AND vencimento < ${hoje()} AND vencimento <= ${fim}
      GROUP BY tipo`),
    // primeiro movimento da empresa (lançamento ou OFX); sem nenhum, a data de cadastro
    db.execute<{ d: string }>(sql`
      SELECT coalesce(
        least(
          (SELECT min(data) FROM lancamentos WHERE empresa_id = ${empresaId}),
          (SELECT min(t.data) FROM transacoes_bancarias t JOIN contas_bancarias cb ON cb.id = t.conta_bancaria_id
           WHERE cb.empresa_id = ${empresaId})),
        (SELECT (created_at AT TIME ZONE 'America/Sao_Paulo')::date FROM empresas WHERE id = ${empresaId}))::text AS d`),
  ]);

  const itens: ItemChecagem[] = [];

  // 1. Balanço
  const t = bal.atual;
  itens.push({
    id: "balanco", titulo: "Balanço fecha (Ativo = Passivo + PL)",
    status: t.fecha ? "ok" : "erro",
    detalhe: t.fecha
      ? `Ativo de R$ ${fmtValor(t.ativo / 100)} igual ao Passivo + PL.`
      : `Ativo R$ ${fmtValor(t.ativo / 100)} × Passivo + PL R$ ${fmtValor(-t.passivoPl / 100)} (diferença R$ ${fmtValor((t.ativo + t.passivoPl) / 100)}).`,
    link: `${base}/relatorios/balanco?ano=${ano}`,
  });

  // 2. Bancos
  for (const b of bancos.filter((b) => b.ativa)) {
    const item = { id: `banco-${b.id}`, titulo: `Saldo bancário: ${b.nome}`, link: `${base}/bancos` };
    if (b.diferenca === null) {
      itens.push({ ...item, status: "alerta", detalhe: `Sem OFX até ${fmtData(fim)}.` });
    } else {
      const d = cents(b.diferenca);
      itens.push({
        ...item, status: d === 0 ? "ok" : "alerta",
        detalhe: d === 0
          ? `Saldo contábil confere com o OFX de ${fmtData(b.dataSaldo!)} (descontados pendentes e ignoradas).`
          : `Diferença de R$ ${fmtValor(b.diferenca)} entre saldo OFX (R$ ${fmtValor(b.saldoOfx!)}) e contábil (R$ ${fmtValor(b.saldoContabil!)}) + pendentes + ignoradas.`,
      });
    }
  }

  // 3. Pendentes
  const pend = [...pendentes];
  const emFechados = pend.filter((p) => estado.fechados.has(p.mes));
  const nFechados = emFechados.reduce((s, p) => s + p.n, 0);
  const nTotal = pend.reduce((s, p) => s + p.n, 0);
  itens.push({
    id: "pendentes", titulo: "Transações pendentes de conciliação",
    status: nFechados ? "erro" : nTotal ? "alerta" : "ok",
    detalhe: nFechados
      ? `${nFechados} pendente(s) em meses fechados (${listaMeses(emFechados.map((p) => p.mes).sort())}); ${nTotal} no período.`
      : nTotal ? `${nTotal} pendente(s) no período.` : "Nenhuma transação pendente no período.",
    link: nTotal ? `${base}/conciliacao?de=${ini}&ate=${fim}` : undefined,
  });

  // 4. Resultado zerado após apuração
  const resultado = linhas.filter((l) => l.tipo === "analitica" && /^3(\.|$)/.test(l.codigo) && cents(l.saldoAtual) !== 0);
  if (estado.apurados.has(ano)) {
    itens.push({
      id: "resultado-zerado", titulo: "Contas de resultado zeradas após a apuração",
      status: resultado.length ? "erro" : "ok",
      detalhe: resultado.length ? `${resultado.length} conta(s) da classe 3 com saldo após a apuração.` : "Todas as contas da classe 3 estão zeradas.",
      itens: resultado.slice(0, 10).map((l) => ({
        texto: `${l.codigo} ${l.nome}: R$ ${fmtValor(l.saldoAtual)}`, link: `${base}/relatorios/razao?ano=${ano}&conta=${l.id}`,
      })),
    });
  } else {
    itens.push({ id: "resultado-zerado", titulo: "Contas de resultado zeradas após a apuração", status: "ok", detalhe: `Exercício ${ano} ainda não apurado.` });
  }

  // 5. Natureza invertida
  const inv = naturezaInvertida(linhas);
  itens.push({
    id: "natureza", titulo: "Saldos contrários à natureza da conta",
    status: inv.length ? "alerta" : "ok",
    detalhe: inv.length ? `${inv.length} conta(s) analítica(s) com saldo invertido.` : "Nenhuma conta com saldo invertido.",
    itens: inv.slice(0, 10).map((l) => ({
      texto: `${l.codigo} ${l.nome}: saldo ${cents(l.saldoAtual) > 0 ? "devedor" : "credor"} de R$ ${fmtValor(Math.abs(Number(l.saldoAtual)))}`,
      link: `${base}/relatorios/razao?ano=${ano}&conta=${l.id}`,
    })),
  });

  // 6. Sem documento
  const nSemDoc = semDoc[0]?.n ?? 0;
  itens.push({
    id: "sem-documento", titulo: `Lançamentos sem documento a partir de R$ ${fmtValor(LIMITE_SEM_DOCUMENTO)}`,
    status: nSemDoc ? "alerta" : "ok",
    detalhe: nSemDoc ? `${nSemDoc} lançamento(s) sem número de documento.` : "Todos os lançamentos relevantes têm documento.",
    link: nSemDoc ? `${base}/lancamentos?de=${ini}&ate=${fim}&semdoc=${LIMITE_SEM_DOCUMENTO}` : undefined,
  });

  // 7. Sócio sem pró-labore
  const semPL = mesesSocioSemProLabore(
    [...socio].map((s) => ({ ...s, socio: cents(s.socio), proLabore: cents(s.prolabore) })),
  ).sort();
  itens.push({
    id: "socio", titulo: "Pagamentos a sócio sem pró-labore no mês",
    status: semPL.length ? "alerta" : "ok",
    detalhe: semPL.length
      ? `Saída a sócio sem lançamento de pró-labore em ${listaMeses(semPL)}.`
      : "Nenhum mês com pagamento a sócio sem pró-labore.",
  });

  // 8. Meses sem lançamento
  const vazios = mesesSemLancamento(ano, [...porMes].map((m) => m.mes), { ate: fim, inicio: inicio[0]?.d ?? ini, hoje: hoje() });
  itens.push({
    id: "meses-vazios", titulo: "Meses sem lançamentos",
    status: vazios.length ? "alerta" : "ok",
    detalhe: vazios.length ? `Sem nenhum lançamento: ${listaMeses(vazios)}.` : "Todos os meses do período têm lançamentos.",
  });

  // 9. Títulos vencidos
  const venc = [...vencidos];
  const nVenc = venc.reduce((s, v) => s + v.n, 0);
  const qtd = (tp: string) => venc.find((v) => v.tipo === tp)?.n ?? 0;
  itens.push({
    id: "titulos-vencidos", titulo: "Títulos vencidos em aberto",
    status: nVenc ? "alerta" : "ok",
    detalhe: nVenc ? `${qtd("receber")} a receber e ${qtd("pagar")} a pagar vencidos.` : "Nenhum título vencido em aberto.",
    link: nVenc ? `${base}/titulos?tipo=${qtd("receber") ? "receber" : "pagar"}` : undefined,
  });

  return itens;
}
