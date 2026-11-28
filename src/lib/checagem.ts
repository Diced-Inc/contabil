import { sql } from "drizzle-orm";
import { db } from "@/db";
import { listarContasComSaldo, type ContaComSaldo } from "@/app/e/[id]/bancos/queries";
import { listarTransferenciasSemPar } from "@/app/e/[id]/conciliacao/queries";
import { carregarEstado, mesesDoAno } from "./fechamento";
import { cents, fmtCompetencia, fmtData, fmtValor, fromCents, hoje, primeiroDiaDoMes } from "./format";
import { adiantamentosAntigos, DIAS_ADIANTAMENTO_ANTIGO } from "./adiantamentos";
import { listarAdiantamentos } from "./adiantamentos-registro";
import { balanco, type TotaisBalanco } from "./relatorios/balanco";
import { saldos, type LinhaSaldo } from "./relatorios/saldos";
import { contaDeTitulo } from "./sem-titulo";

export type StatusChecagem = "ok" | "alerta" | "erro";
export type ItemChecagem = {
  id: string;
  titulo: string;
  status: StatusChecagem;
  detalhe: string;
  link?: string;
  /** Detalhamento opcional, cada linha com link; `grupo` agrupa as linhas na tela. */
  itens?: { texto: string; link: string; grupo?: string }[];
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

type LinhaRegra = Pick<LinhaSaldo, "id" | "codigo" | "nome" | "natureza" | "tipo" | "saldoAtual" | "papel">;
const semAcento = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const reais = (c: number) => `R$ ${fmtValor(Math.abs(c) / 100)}`;
const ladoSaldo = (c: number) => (c > 0 ? "devedor" : "credor");

/**
 * Regras patrimoniais (item 9 do Bruno) sobre os saldos analíticos no fim do período e os totais do balanço.
 * erro bloqueia a apuração: Ativo credor, Passivo + PL devedor, aplicação credora (impossível).
 * alerta pede revisão: Clientes credor, Fornecedores devedor, imposto a recolher devedor, transitória ≠ 0, sem capital
 * social, adiantamento a sócio em aberto e os demais saldos contra a natureza (têm casos transitórios legítimos,
 * e Fornecedores/adiantamento a sócio só fecham quando a obrigação/compensação for registrada).
 */
export function regrasPatrimoniais(linhas: LinhaRegra[], p: {
  base: string; ano: number; totais: TotaisBalanco; semPar?: { data: string; valor: string; memo: string; contaBancariaNome: string }[];
}): ItemChecagem[] {
  const an = linhas.filter((l) => l.tipo === "analitica");
  const s = (l: LinhaRegra) => cents(l.saldoAtual);
  const razao = (l: LinhaRegra) => `${p.base}/relatorios/razao?ano=${p.ano}&conta=${l.id}`;
  const linha = (l: LinhaRegra, grupo?: string) => ({
    texto: `${l.codigo} ${l.nome}: saldo ${ladoSaldo(s(l))} de ${reais(s(l))}`, link: razao(l), grupo,
  });
  const porValor = (ls: LinhaRegra[]) => [...ls].sort((a, b) => Math.abs(s(b)) - Math.abs(s(a)));
  const classe = (c: string) => (l: LinhaRegra) => l.codigo === c || l.codigo.startsWith(`${c}.`);
  /** `titulos`: [quando passa, quando falha] — o título descreve o problema, não a condição esperada. */
  const regra = (id: string, titulos: [string, string], ruim: LinhaRegra[], status: "alerta" | "erro", ok: string, ruimTxt: string): ItemChecagem => ({
    id, titulo: titulos[ruim.length ? 1 : 0], status: ruim.length ? status : "ok", detalhe: ruim.length ? ruimTxt : ok,
    itens: porValor(ruim).map((l) => linha(l)),
  });
  const itens: ItemChecagem[] = [];
  const { ativo, passivoPl } = p.totais;

  itens.push({
    id: "ativo-credor", titulo: ativo < 0 ? "Ativo total com saldo credor" : "Ativo total com saldo devedor", status: ativo < 0 ? "erro" : "ok",
    detalhe: ativo < 0
      ? `Ativo total credor de ${reais(ativo)}: há saldos credores no Ativo (ex.: recebimentos direto em Clientes, transferências sem par).`
      : `Ativo total devedor de ${reais(ativo)}.`,
    itens: ativo < 0 ? porValor(an.filter((l) => classe("1")(l) && s(l) < 0)).map((l) => linha(l)) : undefined,
  });
  itens.push({
    id: "passivo-devedor", titulo: passivoPl > 0 ? "Passivo + PL com saldo devedor" : "Passivo + PL com saldo credor", status: passivoPl > 0 ? "erro" : "ok",
    detalhe: passivoPl > 0 ? `Passivo + PL devedor de ${reais(passivoPl)}.` : `Passivo + PL credor de ${reais(passivoPl)}.`,
    itens: passivoPl > 0 ? porValor(an.filter((l) => classe("2")(l) && s(l) > 0)).map((l) => linha(l)) : undefined,
  });
  const statusBalanco = !p.totais.fecha ? "erro" : ativo < 0 || passivoPl > 0 ? "alerta" : "ok";
  itens.push({
    id: "balanco",
    titulo: {
      ok: "Balanço fecha (Ativo = Passivo + PL)", erro: "Balanço não fecha (Ativo ≠ Passivo + PL)",
      alerta: "Balanço fecha só porque saldos invertidos se compensam",
    }[statusBalanco],
    status: statusBalanco,
    detalhe: !p.totais.fecha
      ? `Ativo R$ ${fmtValor(ativo / 100)} × Passivo + PL R$ ${fmtValor(-passivoPl / 100)} (diferença R$ ${fmtValor((ativo + passivoPl) / 100)}).`
      : ativo < 0 || passivoPl > 0
        ? "Os totais batem, mas só porque saldos invertidos se compensam (veja Ativo e Passivo + PL): o balanço não é confiável."
        : `Ativo de R$ ${fmtValor(ativo / 100)} igual ao Passivo + PL.`,
    link: `${p.base}/relatorios/balanco?ano=${p.ano}`,
  });

  const cobertas = new Set<string>();
  const marcar = (ls: LinhaRegra[]) => (ls.forEach((l) => cobertas.add(l.id)), ls);
  const papel = (x: string) => an.filter((l) => l.papel === x);

  itens.push(regra("clientes-credor", ["Clientes sem saldo credor", "Clientes com saldo credor"], marcar(papel("clientes").filter((l) => s(l) < 0)), "alerta",
    "Clientes sem saldo credor.", "Recebido mais do que foi faturado: recebimentos direto em Clientes sem título. Reclassifique para a receita ou registre os títulos."));
  itens.push(regra("fornecedores-devedor", ["Fornecedores sem saldo devedor", "Fornecedores com saldo devedor"], marcar(papel("fornecedores").filter((l) => s(l) > 0)), "alerta",
    "Fornecedores sem saldo devedor.", "Pago mais do que foi reconhecido: falta registrar as obrigações (títulos/NF) desses pagamentos."));
  itens.push(regra("aplicacoes-credor", ["Aplicações financeiras sem saldo credor", "Aplicações financeiras com saldo credor"],
    marcar(an.filter((l) => classe("1")(l) && /aplica/.test(semAcento(l.nome)) && s(l) < 0)), "erro",
    "Nenhuma aplicação com saldo credor.", "Aplicação não pode ter saldo negativo: falta a aplicação inicial ou um resgate foi lançado a mais."));
  itens.push(regra("impostos-devedor", ["Impostos a recolher sem saldo devedor", "Impostos a recolher com saldo devedor"],
    marcar(an.filter((l) => contaDeTitulo(l) === "impostos" && s(l) > 0)), "alerta",
    "Nenhum imposto a recolher com saldo devedor.", "Guia paga sem a obrigação registrada: lance a provisão do imposto na competência."));

  const transitoria = papel("transferencias");
  if (transitoria.length) {
    const t = marcar(transitoria.filter((l) => s(l) !== 0));
    const total = transitoria.reduce((x, l) => x + s(l), 0);
    const tela = `${p.base}/conciliacao?ver=transferencias`;
    itens.push({
      id: "transferencias", titulo: t.length ? "Transferências entre contas com saldo (sem par)" : "Transferências entre contas zeradas",
      status: t.length ? "alerta" : "ok",
      detalhe: t.length
        ? `Saldo ${ladoSaldo(total)} de ${reais(total)} na conta de transferências, ${p.semPar?.length ?? 0} transação(ões) sem par. Cadastre a outra conta bancária e importe o extrato dela.`
        : "Conta de transferências zerada.",
      link: t.length ? tela : undefined,
      itens: t.length ? [
        ...t.map((l) => linha(l)),
        ...(p.semPar ?? []).map((x) => ({
          texto: `${fmtData(x.data)} · ${x.contaBancariaNome} · R$ ${fmtValor(x.valor)} · ${x.memo}`, link: tela, grupo: "Sem par",
        })),
      ] : undefined,
    });
  }

  const capital = an.filter((l) => classe("2.3.1")(l) || /capital social/.test(semAcento(l.nome)));
  const totalCapital = capital.reduce((x, l) => x + s(l), 0);
  itens.push({
    id: "capital-social", titulo: totalCapital === 0 ? "Capital social não registrado" : "Capital social registrado",
    status: totalCapital === 0 ? "alerta" : "ok",
    detalhe: totalCapital === 0
      ? "PL sem capital social: lance o saldo de abertura (capital subscrito e integralizado)."
      : `Capital social de ${reais(totalCapital)}.`,
    link: totalCapital === 0 ? `${p.base}/plano-de-contas` : undefined,
  });

  itens.push(regra("adiantamento-socios", ["Nenhum adiantamento a sócio em aberto", "Adiantamentos a sócios em aberto"],
    marcar(an.filter((l) => classe("1")(l) && /socio/.test(semAcento(l.nome)) && s(l) !== 0)), "alerta",
    "Nenhum adiantamento a sócio em aberto.", "Valores com sócio ainda não compensados: devolução, distribuição de lucros ou pró-labore."));

  const nomes = new Map(linhas.map((l) => [l.codigo, l.nome]));
  const grupoDe = (c: string) => {
    const g = c.split(".").slice(0, 2).join(".");
    return `${g} ${nomes.get(g) ?? ""}`.trim();
  };
  const outras = naturezaInvertida(an).filter((l) => !cobertas.has(l.id));
  itens.push({
    id: "natureza", titulo: outras.length ? "Outros saldos contrários à natureza da conta" : "Nenhum outro saldo contrário à natureza da conta",
    status: outras.length ? "alerta" : "ok",
    detalhe: outras.length ? `${outras.length} conta(s) analítica(s) com saldo invertido, além das acima.` : "Nenhuma outra conta com saldo invertido.",
    itens: [...outras].sort((a, b) => a.codigo.localeCompare(b.codigo, "pt-BR", { numeric: true })).map((l) => linha(l, grupoDe(l.codigo))),
  });
  return itens;
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

type BancoConferido = Pick<ContaComSaldo, "id" | "nome" | "saldoOfx" | "saldoContabil" | "pendentes" | "diferenca" | "dataSaldo">;

/**
 * Saldo contábil × OFX na data do último saldo. Diferença = OFX − contábil − pendentes; ignoradas (linhas de saldo do
 * dia, duplicadas) não são movimento e não entram. Pendentes aparecem à parte: fecham quando conciliadas.
 */
export function itemSaldoBanco(b: BancoConferido, base: string, fim: string): ItemChecagem {
  const item = { id: `banco-${b.id}`, link: `${base}/bancos` };
  if (b.diferenca === null || b.dataSaldo === null)
    return { ...item, titulo: `Saldo bancário sem OFX: ${b.nome}`, status: "alerta", detalhe: `Sem OFX com saldo até ${fmtData(fim)}.` };
  const d = cents(b.diferenca);
  const pend = cents(b.pendentes ?? 0);
  const r = (v: string | null) => `R$ ${fmtValor(v ?? 0)}`;
  const conta = `OFX de ${fmtData(b.dataSaldo)} ${r(b.saldoOfx)} × contábil ${r(b.saldoContabil)}`;
  if (d === 0 && pend === 0)
    return { ...item, titulo: `Saldo bancário confere: ${b.nome}`, status: "ok", detalhe: `${conta}. Ignoradas não entram na conta.` };
  if (d === 0)
    return {
      ...item, titulo: `Saldo bancário confere depois de conciliar as pendentes: ${b.nome}`, status: "alerta",
      detalhe: `${conta}; a diferença são as pendentes (${r(b.pendentes)}), que fecham quando conciliadas.`,
    };
  return {
    ...item, titulo: `Saldo bancário não confere: ${b.nome}`, status: "alerta",
    detalhe: `${conta}${pend ? ` e ${r(b.pendentes)} em pendentes` : ""}: sobram ${r(b.diferenca)} sem explicação (saldo inicial, lançamento fora do extrato ou movimento ignorado por engano).`,
  };
}

/** Alerta (revisão, não erro): adiantamentos com saldo há mais de 90 dias, que talvez já devessem ter sido compensados. */
export function itemAdiantamentosAntigos(
  ads: { tipo: "cliente" | "fornecedor"; contraparte: string; data: string; saldo: number }[], hojeISO: string, base: string,
): ItemChecagem {
  const antigos = adiantamentosAntigos(ads, hojeISO);
  const link = `${base}/titulos?tipo=adiantamentos`;
  return {
    id: "adiantamentos-antigos",
    titulo: antigos.length
      ? `Adiantamentos de clientes/a fornecedores em aberto há mais de ${DIAS_ADIANTAMENTO_ANTIGO} dias`
      : `Nenhum adiantamento em aberto há mais de ${DIAS_ADIANTAMENTO_ANTIGO} dias`,
    status: antigos.length ? "alerta" : "ok",
    detalhe: antigos.length
      ? `${antigos.length} adiantamento(s) sem compensação: confira se a nota/título da contraparte já foi registrado.`
      : "Os adiantamentos em aberto são recentes.",
    link: antigos.length ? link : undefined,
    itens: antigos.map((a) => ({
      texto: `${fmtData(a.data)} · ${a.tipo === "cliente" ? "de cliente" : "a fornecedor"} · ${a.contraparte} · R$ ${fmtValor(fromCents(a.saldo))}`, link,
    })),
  };
}

/** Checagens de consistência do exercício `ano` (até hoje, se for o ano corrente). */
export async function checar(empresaId: string, ano: number): Promise<ItemChecagem[]> {
  const ini = `${ano}-01-01`;
  const dez = `${ano}-12-31`;
  const fim = dez < hoje() ? dez : hoje();
  const base = `/e/${empresaId}`;

  const [bal, bancos, estado, linhas, pendentes, semDoc, porMes, socio, vencidos, inicio, semPar, ads] = await Promise.all([
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
      SELECT DISTINCT competencia::text AS mes FROM lancamentos
      WHERE empresa_id = ${empresaId} AND competencia BETWEEN ${ini} AND ${fim}`),
    db.execute<{ mes: string; status: "aprovado" | "estornado"; origem: string; socio: string; prolabore: string }>(sql`
      SELECT l.competencia::text AS mes, l.status, l.origem,
        coalesce(sum(p.debito) FILTER (WHERE pc.nome ~* 's[óo]cio'), 0)::text AS socio,
        coalesce(sum(p.debito) FILTER (WHERE pc.nome ~* 'pr[óo][- ]?labore'), 0)::text AS prolabore
      FROM lancamentos l JOIN partidas p ON p.lancamento_id = l.id JOIN plano_contas pc ON pc.id = p.conta_id
      WHERE l.empresa_id = ${empresaId} AND l.competencia BETWEEN ${ini} AND ${fim}
      GROUP BY 1, 2, 3`),
    db.execute<{ tipo: "receber" | "pagar"; n: number }>(sql`
      SELECT tipo, count(*)::int AS n FROM titulos
      WHERE empresa_id = ${empresaId} AND status IN ('aberto', 'parcial') AND vencimento < ${hoje()} AND vencimento <= ${fim}
      GROUP BY tipo`),
    // primeiro movimento da empresa (lançamento ou OFX); sem nenhum, a data de cadastro
    db.execute<{ d: string }>(sql`
      SELECT coalesce(
        least(
          (SELECT min(least(data, competencia)) FROM lancamentos WHERE empresa_id = ${empresaId} AND origem <> 'abertura'),
          (SELECT min(t.data) FROM transacoes_bancarias t JOIN contas_bancarias cb ON cb.id = t.conta_bancaria_id
           WHERE cb.empresa_id = ${empresaId})),
        (SELECT (created_at AT TIME ZONE 'America/Sao_Paulo')::date FROM empresas WHERE id = ${empresaId}))::text AS d`),
    listarTransferenciasSemPar(empresaId, fim),
    listarAdiantamentos(db, empresaId),
  ]);

  const itens: ItemChecagem[] = [];

  // 1. Balanço e regras patrimoniais (inclui a natureza invertida, por grupo e sem limite)
  itens.push(...regrasPatrimoniais(linhas, { base, ano, totais: bal.atual, semPar }));

  itens.push(itemAdiantamentosAntigos(ads, hoje(), base));

  // 2. Bancos
  for (const b of bancos.filter((b) => b.ativa)) itens.push(itemSaldoBanco(b, base, fim));

  // 3. Pendentes
  const pend = [...pendentes];
  const emFechados = pend.filter((p) => estado.fechados.has(p.mes));
  const nFechados = emFechados.reduce((s, p) => s + p.n, 0);
  const nTotal = pend.reduce((s, p) => s + p.n, 0);
  itens.push({
    id: "pendentes", titulo: nTotal ? "Transações pendentes de conciliação" : "Nenhuma transação pendente de conciliação",
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
      id: "resultado-zerado",
      titulo: resultado.length ? "Contas de resultado com saldo após a apuração" : "Contas de resultado zeradas após a apuração",
      status: resultado.length ? "erro" : "ok",
      detalhe: resultado.length ? `${resultado.length} conta(s) da classe 3 com saldo após a apuração.` : "Todas as contas da classe 3 estão zeradas.",
      itens: resultado.slice(0, 10).map((l) => ({
        texto: `${l.codigo} ${l.nome}: R$ ${fmtValor(l.saldoAtual)}`, link: `${base}/relatorios/razao?ano=${ano}&conta=${l.id}`,
      })),
    });
  } else {
    itens.push({
      id: "resultado-zerado", titulo: `Exercício ${ano} ainda não apurado`, status: "ok",
      detalhe: "O Balanço é provisório até a apuração do resultado.",
    });
  }

  // 6. Sem documento
  const nSemDoc = semDoc[0]?.n ?? 0;
  itens.push({
    id: "sem-documento",
    titulo: nSemDoc
      ? `Lançamentos sem documento a partir de R$ ${fmtValor(LIMITE_SEM_DOCUMENTO)}`
      : `Lançamentos a partir de R$ ${fmtValor(LIMITE_SEM_DOCUMENTO)} com documento`,
    status: nSemDoc ? "alerta" : "ok",
    detalhe: nSemDoc ? `${nSemDoc} lançamento(s) sem número de documento.` : "Todos os lançamentos relevantes têm documento.",
    link: nSemDoc ? `${base}/lancamentos?de=${ini}&ate=${fim}&semdoc=${LIMITE_SEM_DOCUMENTO}` : undefined,
  });

  // 7. Sócio sem pró-labore
  const semPL = mesesSocioSemProLabore(
    [...socio].map((s) => ({ ...s, socio: cents(s.socio), proLabore: cents(s.prolabore) })),
  ).sort();
  itens.push({
    id: "socio", titulo: semPL.length ? "Pagamentos a sócio sem pró-labore no mês" : "Pró-labore em todo mês com pagamento a sócio",
    status: semPL.length ? "alerta" : "ok",
    detalhe: semPL.length
      ? `Saída a sócio sem lançamento de pró-labore em ${listaMeses(semPL)}.`
      : "Nenhum mês com pagamento a sócio sem pró-labore.",
  });

  // 8. Meses sem lançamento
  const vazios = mesesSemLancamento(ano, [...porMes].map((m) => m.mes), { ate: fim, inicio: inicio[0]?.d ?? ini, hoje: hoje() });
  itens.push({
    id: "meses-vazios", titulo: vazios.length ? "Meses sem lançamentos" : "Todos os meses com lançamentos",
    status: vazios.length ? "alerta" : "ok",
    detalhe: vazios.length ? `Sem nenhum lançamento: ${listaMeses(vazios)}.` : "Todos os meses do período têm lançamentos.",
  });

  // 9. Títulos vencidos
  const venc = [...vencidos];
  const nVenc = venc.reduce((s, v) => s + v.n, 0);
  const qtd = (tp: string) => venc.find((v) => v.tipo === tp)?.n ?? 0;
  itens.push({
    id: "titulos-vencidos", titulo: nVenc ? "Títulos vencidos em aberto" : "Nenhum título vencido em aberto",
    status: nVenc ? "alerta" : "ok",
    detalhe: nVenc ? `${qtd("receber")} a receber e ${qtd("pagar")} a pagar vencidos.` : "Nenhum título vencido em aberto.",
    link: nVenc ? `${base}/titulos?tipo=${qtd("receber") ? "receber" : "pagar"}` : undefined,
  });

  return itens;
}
