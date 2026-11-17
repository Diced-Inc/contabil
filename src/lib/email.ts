/** Envio de e-mail pela API REST do Resend (sem SDK). Sem RESEND_API_KEY/EMAIL_FROM, nada sai e o status é nao_configurado. */
export type ResultadoEmail = { status: "enviado" | "erro" | "nao_configurado"; id?: string; erro?: string };
export type Email = { para: string; assunto: string; html: string; texto: string };

export const emailConfigurado = () => !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

export async function enviarEmail({ para, assunto, html, texto }: Email): Promise<ResultadoEmail> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) return { status: "nao_configurado" };
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [para], subject: assunto, html, text: texto, reply_to: process.env.EMAIL_REPLY_TO || undefined }),
    });
    const corpo = (await r.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!r.ok) return { status: "erro", erro: corpo.message ?? `HTTP ${r.status}` };
    return { status: "enviado", id: corpo.id };
  } catch (e) {
    return { status: "erro", erro: e instanceof Error ? e.message : String(e) };
  }
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const MARCA = "DB Contador";
const CONTATO = "contato@dbcontador.com.br";
/** PNG 96×96 gerado por scripts/icones.mjs (cliente de e-mail não mostra SVG). */
const LOGO_PNG = "https://app.dbcontador.com.br/logo.png";
const FONTE = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const C = {
  marca: "#1f4fd8", texto: "#0f1a33", suave: "#4a5468", fraco: "#6b7488", fundo: "#f3f5f9", borda: "#e3e7ee", caixa: "#f4f7fe", caixaBorda: "#d6e0fb",
};

const RODAPE_CLIENTE = "Você recebe este e-mail porque seu contador liberou seu acesso ao portal da empresa.";
const RODAPE_CONTADOR = "Aviso automático do portal do cliente, enviado aos contadores do escritório.";

/** Bloco em destaque: número grande opcional, pares lado a lado (curtos) e linhas rótulo/valor (valor já em HTML escapado). */
type Destaque = { grande?: { rotulo: string; valor: string }; lado?: [[string, string], [string, string]]; linhas?: [string, string][] };

function blocoDestaque({ grande, lado, linhas = [] }: Destaque) {
  const celula = (pad: string, conteudo: string) =>
    `<tr><td style="padding:${pad};font-family:${FONTE}">${conteudo}</td></tr>`;
  const topo = grande
    ? celula(
        `20px 22px ${linhas.length || lado ? "14px" : "20px"}`,
        `<div class="dbc-suave" style="font-size:12px;line-height:16px;letter-spacing:.05em;text-transform:uppercase;color:${C.suave}">${esc(grande.rotulo)}</div>
<div class="dbc-texto" style="margin-top:4px;font-size:30px;line-height:36px;font-weight:700;color:${C.texto};letter-spacing:-.01em">${esc(grande.valor)}</div>`,
      )
    : "";
  const item = ([r, v]: [string, string]) =>
    `<div class="dbc-suave" style="font-size:12px;line-height:16px;color:${C.suave}">${esc(r)}</div>
<div class="dbc-texto" style="font-size:15px;line-height:22px;font-weight:600;color:${C.texto}">${v}</div>`;
  const meio = lado
    ? celula(
        `${grande ? "0" : "18px"} 22px ${linhas.length ? "12px" : "18px"}`,
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${lado
          .map((x, i) => `<td width="50%" style="vertical-align:top;font-family:${FONTE}${i ? ";padding-left:12px" : ""}">${item(x)}</td>`)
          .join("")}</tr></table>`,
      )
    : "";
  const resto = linhas
    .map(([r, v], i) =>
      celula(
        `${i === 0 && !grande ? "18px" : "0"} 22px ${i === linhas.length - 1 ? "18px" : "12px"}`,
        item([r, v]),
      ),
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="dbc-caixa" style="margin:6px 0 22px;background:${C.caixa};border:1px solid ${C.caixaBorda};border-left:4px solid ${C.marca};border-radius:6px;border-collapse:separate">${topo}${meio}${resto}</table>`;
}

/** Botão à prova de cliente: a célula tem a cor (Outlook), o link tem o padding (área de clique). */
function botao(rotulo: string, href: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px"><tr>
<td align="center" bgcolor="${C.marca}" style="border-radius:6px;background:${C.marca}">
<a href="${href}" target="_blank" style="display:inline-block;padding:13px 26px;font-family:${FONTE};font-size:15px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px">${esc(rotulo)}</a>
</td></tr></table>`;
}

const paragrafo = (html: string) =>
  `<p class="dbc-suave" style="margin:0 0 14px;font-size:15px;line-height:24px;color:${C.suave}">${html}</p>`;

/**
 * Moldura única: marca + contexto ("DB Contador · EMPRESA"), título, texto, destaque, botão, link de reserva e rodapé.
 * Tabelas e estilos inline (Gmail, Outlook, Apple Mail); o <style> só refina o modo escuro e o celular onde há suporte.
 */
function layout({ empresa, previa, titulo, antes, destaque, depois = [], botao: rotulo, link, rodape = RODAPE_CLIENTE }: {
  empresa: string | null; previa: string; titulo: string; antes: string[]; destaque?: Destaque; depois?: string[];
  botao: string; link: string; rodape?: string;
}) {
  const href = esc(link);
  const contexto = `<span class="dbc-texto" style="color:${C.texto};font-weight:700">${MARCA}</span>${
    empresa ? `<span class="dbc-fraco" style="color:${C.fraco}">&nbsp;&middot;&nbsp;${esc(empresa)}</span>` : ""
  }`;
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<title>${esc(titulo)}</title>
<style>
:root{color-scheme:light dark;supported-color-schemes:light dark}
@media (prefers-color-scheme:dark){
.dbc-fundo{background:#0b1220!important}.dbc-cartao{background:#131c2e!important;border-color:#26324a!important}
.dbc-texto{color:#eef2f8!important}.dbc-suave{color:#b6c0d4!important}.dbc-fraco{color:#8b96ad!important}
.dbc-caixa{background:#15234a!important;border-color:#2a3f7a!important}.dbc-link{color:#8aa8ff!important}
}
@media (max-width:600px){.dbc-cartao{padding:26px 22px!important}.dbc-externo{padding:20px 12px!important}}
</style></head>
<body class="dbc-fundo" style="margin:0;padding:0;background:${C.fundo};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(previa)}&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="dbc-fundo" style="background:${C.fundo}"><tr>
<td align="center" class="dbc-externo" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 4px 18px;font-family:${FONTE}">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="vertical-align:middle;padding-right:12px"><img src="${LOGO_PNG}" width="36" height="36" alt="DB" style="display:block;border:0"></td>
<td style="vertical-align:middle;font-size:14px;line-height:20px">${contexto}</td>
</tr></table>
</td></tr>
<tr><td class="dbc-cartao" style="background:#ffffff;border:1px solid ${C.borda};border-radius:8px;padding:34px 36px;font-family:${FONTE}">
<h1 class="dbc-texto" style="margin:0 0 14px;font-size:23px;line-height:30px;font-weight:700;color:${C.texto};letter-spacing:-.01em">${esc(titulo)}</h1>
${antes.map(paragrafo).join("\n")}
${destaque ? blocoDestaque(destaque) : ""}
${depois.map(paragrafo).join("\n")}
${botao(rotulo, href)}
<p class="dbc-fraco" style="margin:0;font-size:13px;line-height:20px;color:${C.fraco}">Se o botão não abrir, use este endereço:<br><a href="${href}" class="dbc-link" style="color:${C.marca};word-break:break-all">${href}</a></p>
</td></tr>
<tr><td class="dbc-fraco" style="padding:20px 6px 0;font-family:${FONTE};font-size:12px;line-height:18px;color:${C.fraco}">
<b style="font-weight:600">${MARCA}</b> &middot; <a href="mailto:${CONTATO}" class="dbc-fraco" style="color:${C.fraco};text-decoration:underline">${CONTATO}</a><br>${esc(rodape)}
</td></tr>
</table></td></tr></table></body></html>`;
}

/** Versão em texto puro: blocos separados por linha em branco, com a assinatura no fim. */
const corpoTexto = (...partes: (string | false | null | undefined)[]) =>
  [...partes.filter((x): x is string => !!x), `--\n${MARCA} · ${CONTATO}`].join("\n\n");

const brl = (v: string | number) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBR = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const diaMes = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
/** "outubro de 2026" → "outubro" (assuntos curtos). */
const mesDe = (competencia: string) => competencia.replace(/ de \d{4}$/, "");
const comMarca = (assunto: string) => `${assunto} · ${MARCA}`;

export function emailConvite({ nome, empresa, link }: { nome: string | null; empresa: string; link: string }) {
  const saudacao = nome ? `Olá, ${nome}!` : "Olá!";
  const html = layout({
    empresa,
    previa: "Crie sua senha para enviar os extratos e receber as guias de imposto pelo portal.",
    titulo: saudacao,
    antes: [
      `Seu contador liberou seu acesso ao portal da <b>${esc(empresa)}</b> no ${MARCA}. Por lá você envia os extratos do mês e recebe as guias de imposto.`,
      "Para entrar, crie sua senha. O link vale por 24 horas.",
    ],
    botao: "Criar minha senha",
    link,
  });
  return {
    assunto: `Seu acesso ao ${MARCA} está pronto · ${empresa}`,
    html,
    texto: corpoTexto(
      saudacao,
      `Seu contador liberou seu acesso ao portal da ${empresa} no ${MARCA}. Por lá você envia os extratos do mês e recebe as guias de imposto.`,
      `Crie sua senha neste link (vale por 24 horas):\n${link}`,
      "Se não esperava este e-mail, pode ignorar.",
    ),
  };
}

/** Para o contador: o cliente enviou arquivos da competência. */
export function emailExtratoRecebido({ empresa, competencia, arquivos, quem, observacao, link }: {
  empresa: string; competencia: string; arquivos: string[]; quem: string; observacao: string | null; link: string;
}) {
  const n = arquivos.length;
  const qtd = n === 1 ? "1 arquivo" : `${n} arquivos`;
  const html = layout({
    empresa,
    previa: `${quem} enviou ${qtd} de ${competencia}.`,
    titulo: "Extratos recebidos",
    antes: [`<b>${esc(quem)}</b> enviou ${qtd} pelo portal.`],
    destaque: {
      linhas: [
        ["Competência", esc(competencia)],
        [n === 1 ? "Arquivo" : "Arquivos", arquivos.map(esc).join("<br>")],
        ...(observacao ? [["Observação do cliente", `<i style="font-weight:400">${esc(observacao)}</i>`] as [string, string]] : []),
      ],
    },
    botao: "Abrir documentos",
    link,
    rodape: RODAPE_CONTADOR,
  });
  return {
    assunto: comMarca(`Extratos de ${mesDe(competencia)} recebidos: ${empresa} (${qtd})`),
    html,
    texto: corpoTexto(
      `${quem} enviou ${qtd} da ${empresa}, competência ${competencia}:\n${arquivos.map((a) => `- ${a}`).join("\n")}`,
      observacao && `Observação do cliente: ${observacao}`,
      `Abrir documentos: ${link}`,
    ),
  };
}

/** Para o contador: o cliente avisou que mandou os extratos por WhatsApp/e-mail (sem arquivo no portal). */
export function emailExtratoPorFora({ empresa, mes, quem, nota, link }: {
  empresa: string; mes: string; quem: string; nota: string | null; link: string;
}) {
  const html = layout({
    empresa,
    previa: `${quem} avisou que mandou os extratos por WhatsApp ou e-mail.`,
    titulo: "Extratos por outro canal",
    antes: [
      `<b>${esc(quem)}</b> avisou que enviou os extratos de <b>${esc(mes)}</b> por outro canal. Nenhum arquivo foi anexado no portal: confira no WhatsApp ou no e-mail.`,
    ],
    destaque: nota ? { linhas: [["Recado do cliente", `<i style="font-weight:400">${esc(nota)}</i>`]] } : undefined,
    botao: "Abrir o fechamento",
    link,
    rodape: RODAPE_CONTADOR,
  });
  return {
    assunto: comMarca(`Extratos de ${mesDe(mes)} enviados por outro canal: ${empresa}`),
    html,
    texto: corpoTexto(
      `${quem} avisou que enviou os extratos de ${mes} da ${empresa} por outro canal${nota ? `: ${nota}` : "."}`,
      "Nenhum arquivo foi anexado no portal. Confira no WhatsApp ou no e-mail.",
      `Abrir o fechamento: ${link}`,
    ),
  };
}

/** Guia num e-mail: nome (DAS, DARF previdenciário...), valor e vencimento. */
export type GuiaEmail = { nome: string; valor: string; vencimento: string };

/** Soma em centavos (sem erro de ponto flutuante). */
const somaGuias = (gs: { valor: string }[]) => gs.reduce((s, g) => s + Math.round(Number(g.valor) * 100), 0) / 100;
const umaOuVarias = (gs: unknown[], uma: string, varias: string) => (gs.length === 1 ? uma : varias);

/** Destaque das guias: com uma, valor grande + vencimento e período; com várias, o total grande e uma linha por guia. */
function destaqueGuias(gs: GuiaEmail[], competencia: string, rotuloTotal: string): Destaque {
  if (gs.length === 1) {
    const [g] = gs;
    return { grande: { rotulo: `Valor do ${g.nome}`, valor: brl(g.valor) }, lado: [["Vencimento", dataBR(g.vencimento)], ["Período de apuração", esc(competencia)]] };
  }
  return {
    grande: { rotulo: rotuloTotal, valor: brl(somaGuias(gs)) },
    linhas: gs.map((g) => [g.nome, `${brl(g.valor)} <span style="font-weight:400">&middot; vence ${dataBR(g.vencimento)}</span>`]),
  };
}

const textoGuias = (gs: GuiaEmail[]) =>
  [...gs.map((g) => `- ${g.nome}: ${brl(g.valor)}, vence ${dataBR(g.vencimento)}`), ...(gs.length > 1 ? [`Total: ${brl(somaGuias(gs))}`] : [])].join("\n");

/** Para o contador: o cliente clicou em "Já paguei" numa guia. `faltam` = guias enviadas ainda em aberto. */
export function emailGuiaPaga({ empresa, competencia, guia, faltam, quem, quando, link }: {
  empresa: string; competencia: string; guia: { nome: string; valor: string }; faltam: string[]; quem: string; quando: string; link: string;
}) {
  const situacao = faltam.length === 0 ? "Todas as guias do mês estão pagas." : `Ainda em aberto: ${faltam.join(", ")}.`;
  const html = layout({
    empresa,
    previa: `${quem} marcou o ${guia.nome} de ${competencia} como pago. ${situacao}`,
    titulo: faltam.length === 0 ? "Todas as guias pagas" : "Guia paga pelo cliente",
    antes: [`<b>${esc(quem)}</b> marcou como pago o <b>${esc(guia.nome)}</b> de <b>${esc(competencia)}</b>.`],
    destaque: {
      grande: { rotulo: `Valor do ${guia.nome}`, valor: brl(guia.valor) },
      lado: [["Competência", esc(competencia)], ["Informado em", esc(quando)]],
      linhas: [["Situação do mês", esc(situacao)]],
    },
    botao: "Abrir o fechamento",
    link,
    rodape: RODAPE_CONTADOR,
  });
  return {
    assunto: comMarca(`${guia.nome} de ${mesDe(competencia)} pago: ${empresa} (${brl(guia.valor)})`),
    html,
    texto: corpoTexto(
      `${quem} marcou como pago o ${guia.nome} de ${competencia} da ${empresa}.`,
      `Valor: ${brl(guia.valor)}\nInformado em: ${quando}`,
      situacao,
      `Abrir o fechamento: ${link}`,
    ),
  };
}

/** Para o cliente: guias do mês disponíveis no portal. `extra` = guia enviada depois do primeiro envio. */
export function emailGuiasDisponiveis({ empresa, competencia, guias, extra = false, link }: {
  empresa: string; competencia: string; guias: GuiaEmail[]; extra?: boolean; link: string;
}) {
  const [g] = guias;
  const varias = guias.length > 1;
  const abertura = extra
    ? `O contador enviou ${umaOuVarias(guias, "mais uma guia", `mais ${guias.length} guias`)} de <b>${esc(competencia)}</b>. Já está no portal.`
    : `O contador concluiu o mês de <b>${esc(competencia)}</b>. ${umaOuVarias(guias, "A guia já está", `As ${guias.length} guias já estão`)} no portal.`;
  const fim = `Baixe ${umaOuVarias(guias, "a guia", "cada guia")}, pague até o vencimento e clique em <b>Já paguei</b> no portal para avisar o contador.`;
  const html = layout({
    empresa,
    previa: varias
      ? `${guias.length} guias, total de ${brl(somaGuias(guias))}. A primeira vence em ${dataBR(g.vencimento)}.`
      : `${brl(g.valor)} com vencimento em ${dataBR(g.vencimento)}. A guia já está no portal.`,
    titulo: extra ? "Nova guia disponível" : umaOuVarias(guias, `Seu ${g.nome} está pronto`, "Suas guias estão prontas"),
    antes: [abertura],
    destaque: destaqueGuias(guias, competencia, "Total do mês"),
    depois: [fim],
    botao: umaOuVarias(guias, "Baixar a guia", "Baixar as guias"),
    link,
  });
  return {
    assunto: comMarca(
      varias
        ? `Suas guias de ${mesDe(competencia)} estão disponíveis: ${guias.length} guias, ${brl(somaGuias(guias))}`
        : `${extra ? "Nova guia: " : "Seu "}${g.nome} de ${mesDe(competencia)}${extra ? "" : " está disponível"}: ${brl(g.valor)}, vence ${diaMes(g.vencimento)}`,
    ),
    html,
    texto: corpoTexto(abertura.replace(/<\/?b>/g, ""), textoGuias(guias), `${fim.replace(/<\/?b>/g, "")}\n${link}`),
  };
}

/** Para o cliente: guias em aberto do mês (só as não pagas). `dias` = vencimento mais próximo - hoje (negativo = vencida). */
export function emailLembreteGuias({ empresa, competencia, guias, dias, link }: {
  empresa: string; competencia: string; guias: GuiaEmail[]; dias: number; link: string;
}) {
  const [g] = guias;
  const varias = guias.length > 1;
  const quando = dias < 0 ? "venceu" : dias === 0 ? "vence hoje" : dias === 1 ? "vence amanhã" : `vence em ${dias} dias`;
  const html = layout({
    empresa,
    previa: varias
      ? `${guias.length} guias em aberto, ${brl(somaGuias(guias))}. Já pagou? Avise pelo portal.`
      : `${brl(g.valor)}, vencimento em ${dataBR(g.vencimento)}. Já pagou? Avise pelo portal.`,
    titulo: varias ? `Suas guias: a primeira ${quando}` : `Seu ${g.nome} ${quando}`,
    antes: [
      varias
        ? `Ainda não vimos o pagamento de ${guias.length} guias de <b>${esc(competencia)}</b>.`
        : `Ainda não vimos o pagamento do ${esc(g.nome)} de <b>${esc(competencia)}</b>.`,
    ],
    destaque: destaqueGuias(guias, competencia, "Em aberto"),
    depois: [
      dias < 0
        ? "Se ainda não pagou, fale com o contador para gerar uma guia atualizada. Se já pagou, clique em <b>Já paguei</b> no portal."
        : "Já pagou? Clique em <b>Já paguei</b> no portal e os lembretes param.",
    ],
    botao: dias < 0 ? "Abrir o portal" : umaOuVarias(guias, "Baixar a guia", "Baixar as guias"),
    link,
  });
  return {
    assunto: comMarca(
      varias
        ? `Lembrete: ${guias.length} guias de ${mesDe(competencia)} em aberto, a primeira ${quando}`
        : `Lembrete: seu ${g.nome} de ${mesDe(competencia)} ${quando} (${brl(g.valor)})`,
    ),
    html,
    texto: corpoTexto(
      varias ? `Guias de ${competencia} da ${empresa} em aberto; a primeira ${quando}.` : `O ${g.nome} de ${competencia} da ${empresa} ${quando}.`,
      textoGuias(guias),
      `Portal: ${link}`,
    ),
  };
}

/** Para o cliente: pedido mensal dos extratos (lembrete = mesmo pedido, tom de reforço). */
export function emailPedidoExtrato({ empresa, competencia, link, lembrete = false }: {
  empresa: string; competencia: string; link: string; lembrete?: boolean;
}) {
  const mes = mesDe(competencia);
  const abertura = lembrete
    ? `Ainda não recebemos os extratos de <b>${esc(competencia)}</b>.`
    : `Chegou a hora de enviar os extratos de <b>${esc(competencia)}</b>.`;
  const corpo = "Com eles o contador fecha o mês e envia as guias de imposto.";
  const html = layout({
    empresa,
    previa: lembrete ? `Ainda faltam os extratos de ${competencia}.` : `Mande pelo portal os extratos bancários de ${competencia}.`,
    titulo: lembrete ? "Faltam os extratos do mês" : "Hora de enviar os extratos",
    antes: [`${abertura} ${corpo}`],
    destaque: {
      linhas: [
        ["Mês pedido", esc(competencia)],
        ["O que enviar", `Extratos de todas as contas da empresa<br><span style="font-weight:400">OFX, CSV ou PDF</span>`],
      ],
    },
    depois: ["Já mandou por WhatsApp ou e-mail? Avise pelo portal em <b>Já enviei por outro canal</b>."],
    botao: "Enviar extratos",
    link,
  });
  return {
    assunto: comMarca(lembrete ? `Lembrete: faltam os extratos de ${mes}` : `Envie os extratos de ${mes}`),
    html,
    texto: corpoTexto(
      `${abertura.replace(/<\/?b>/g, "")} ${corpo}`,
      `Mês pedido: ${competencia}\nO que enviar: extratos de todas as contas da empresa (OFX, CSV ou PDF)`,
      `Enviar extratos: ${link}`,
    ),
  };
}

/** Link de redefinição de senha (substitui o e-mail do Supabase quando o Resend está configurado). */
export function emailRecuperacaoSenha({ link }: { link: string }) {
  const html = layout({
    empresa: null,
    previa: "Use o link para criar uma nova senha. Ele vale por 24 horas.",
    titulo: "Redefinir sua senha",
    antes: ["Recebemos um pedido para redefinir a senha da sua conta.", "Clique no botão abaixo para criar uma nova senha. O link vale por 24 horas."],
    botao: "Criar nova senha",
    link,
    rodape: "Se você não pediu, pode ignorar este e-mail: sua senha continua a mesma.",
  });
  return {
    assunto: comMarca("Redefina sua senha"),
    html,
    texto: corpoTexto(
      "Recebemos um pedido para redefinir a senha da sua conta.",
      `Crie uma nova senha neste link (vale por 24 horas):\n${link}`,
      "Se você não pediu, pode ignorar este e-mail.",
    ),
  };
}

export type LicitacaoEmail = { objeto: string; orgao: string; local: string; modalidade: string; valor: string | null; encerramento: string };

/** Para o contador: licitações novas de uma busca salva (encerramento já formatado, "dd/mm/aaaa hh:mm"). */
export function emailLicitacoesNovas({ busca, empresa, itens, link }: {
  busca: string; empresa: string | null; itens: LicitacaoEmail[]; link: string;
}) {
  const MAX = 10;
  const n = itens.length;
  const qtd = n === 1 ? "1 licitação nova" : `${n} licitações novas`;
  const corta = (s: string) => (s.length > 180 ? s.slice(0, 177).trimEnd() + "..." : s);
  const detalhe = (l: LicitacaoEmail) => [l.modalidade, l.valor ? brl(l.valor) : "valor não informado", `propostas até ${l.encerramento}`].join(" · ");
  const html = layout({
    empresa,
    previa: `${qtd} com propostas abertas na busca "${busca}".`,
    titulo: n === 1 ? "Licitação nova para acompanhar" : "Licitações novas para acompanhar",
    antes: [`A busca <b>${esc(busca)}</b> encontrou ${qtd} no PNCP com propostas abertas.`],
    destaque: {
      linhas: itens.slice(0, MAX).map((l) => [
        `${l.orgao} · ${l.local}`,
        `${esc(corta(l.objeto))}<br><span style="font-weight:400;font-size:13px">${esc(detalhe(l))}</span>`,
      ]),
    },
    depois: n > MAX ? [`E mais ${n - MAX} no painel.`] : [],
    botao: "Abrir licitações",
    link,
    rodape: "Alerta das buscas salvas no painel de licitações, enviado aos contadores do escritório.",
  });
  return {
    assunto: comMarca(`${qtd}: ${busca}`),
    html,
    texto: corpoTexto(
      `A busca "${busca}" encontrou ${qtd} no PNCP com propostas abertas${empresa ? ` (${empresa})` : ""}:`,
      itens.slice(0, MAX).map((l) => `- ${corta(l.objeto)}\n  ${l.orgao} · ${l.local}\n  ${detalhe(l)}`).join("\n\n"),
      n > MAX && `E mais ${n - MAX} no painel.`,
      `Abrir licitações: ${link}`,
    ),
  };
}
