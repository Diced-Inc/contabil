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
      body: JSON.stringify({ from, to: [para], subject: assunto, html, text: texto }),
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

const MARCA = "#0f6e56";

/** Moldura com a marca: título, parágrafos, botão e link de reserva em texto. */
const RODAPE_CLIENTE = "Você recebeu este e-mail porque seu contador liberou seu acesso. Se não esperava por ele, pode ignorar.";

function layout({ titulo, paragrafos, botao, link, rodape = RODAPE_CLIENTE }: {
  titulo: string; paragrafos: string[]; botao: string; link: string; rodape?: string;
}) {
  const href = esc(link);
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f4f6f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c2321">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
<tr><td style="padding:0 4px 20px;font-size:17px"><span style="display:inline-block;width:28px;height:28px;border-radius:7px;background:${MARCA};color:#fff;font-weight:700;text-align:center;line-height:28px;vertical-align:middle">B</span>
<span style="vertical-align:middle;margin-left:8px">Bruno <b>Contábil</b></span></td></tr>
<tr><td style="background:#fff;border:1px solid #e3e8e6;border-radius:16px;padding:32px">
<h1 style="margin:0 0 12px;font-size:22px;line-height:1.3">${esc(titulo)}</h1>
${paragrafos.map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#3d4744">${p}</p>`).join("")}
<p style="margin:24px 0"><a href="${href}" style="display:inline-block;background:${MARCA};color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:10px">${esc(botao)}</a></p>
<p style="margin:0;font-size:13px;line-height:1.5;color:#6b7673">Se o botão não funcionar, copie e cole este endereço no navegador:<br><a href="${href}" style="color:${MARCA};word-break:break-all">${href}</a></p>
</td></tr>
<tr><td style="padding:16px 4px 0;font-size:12px;color:#8a9491">${esc(rodape)}</td></tr>
</table></td></tr></table></body></html>`;
}

export function emailConvite({ nome, empresa, link }: { nome: string | null; empresa: string; link: string }) {
  const saudacao = nome ? `Olá, ${nome}!` : "Olá!";
  const assunto = `Seu acesso ao portal da ${empresa}`;
  const html = layout({
    titulo: saudacao,
    paragrafos: [
      `Seu contador liberou o acesso ao portal da <b>${esc(empresa)}</b>. Por lá você vai enviar os extratos do mês e receber a guia do DAS.`,
      "Clique no botão abaixo para criar sua senha. O link vale por 24 horas.",
    ],
    botao: "Criar minha senha",
    link,
  });
  const texto = `${saudacao}\n\nSeu contador liberou o acesso ao portal da ${empresa}. Por lá você vai enviar os extratos do mês e receber a guia do DAS.\n\nCrie sua senha neste link (vale por 24 horas):\n${link}\n\nSe não esperava este e-mail, pode ignorar.`;
  return { assunto, html, texto };
}

const brl = (v: string | number) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBR = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

/** Para o contador: o cliente enviou arquivos da competência. */
export function emailExtratoRecebido({ empresa, competencia, arquivos, quem, observacao, link }: {
  empresa: string; competencia: string; arquivos: string[]; quem: string; observacao: string | null; link: string;
}) {
  const n = arquivos.length;
  const qtd = n === 1 ? "1 arquivo" : `${n} arquivos`;
  const assunto = `${empresa}: ${qtd} de ${competencia}`;
  const lista = arquivos.map((a) => `&bull; ${esc(a)}`).join("<br>");
  const html = layout({
    titulo: "Extratos recebidos",
    paragrafos: [
      `<b>${esc(quem)}</b> enviou ${qtd} da <b>${esc(empresa)}</b>, competência ${esc(competencia)}:`,
      lista,
      ...(observacao ? [`Observação do cliente: <i>${esc(observacao)}</i>`] : []),
    ],
    botao: "Abrir documentos",
    link,
    rodape: "Aviso automático do portal do cliente.",
  });
  const texto = `${quem} enviou ${qtd} da ${empresa}, competência ${competencia}:\n${arquivos.map((a) => `- ${a}`).join("\n")}\n${
    observacao ? `\nObservação do cliente: ${observacao}\n` : ""
  }\nAbrir documentos: ${link}`;
  return { assunto, html, texto };
}

/** Para o cliente: mês concluído, guia do DAS disponível no portal. */
export function emailDasDisponivel({ empresa, competencia, valor, vencimento, link }: {
  empresa: string; competencia: string; valor: string; vencimento: string; link: string;
}) {
  const assunto = `DAS de ${competencia} disponível: ${brl(valor)}, vence ${dataBR(vencimento)}`;
  const html = layout({
    titulo: "Seu DAS está pronto",
    paragrafos: [
      `O contador concluiu o mês de <b>${esc(competencia)}</b> da <b>${esc(empresa)}</b>.`,
      `Valor do DAS: <b>${brl(valor)}</b><br>Vencimento: <b>${dataBR(vencimento)}</b>`,
      "Baixe a guia no portal e, depois de pagar, clique em \"Já paguei\" para avisar o contador.",
    ],
    botao: "Baixar a guia",
    link,
  });
  const texto = `O contador concluiu o mês de ${competencia} da ${empresa}.\n\nValor do DAS: ${brl(valor)}\nVencimento: ${dataBR(vencimento)}\n\nBaixe a guia no portal e, depois de pagar, clique em "Já paguei":\n${link}`;
  return { assunto, html, texto };
}

/** Para o cliente: pedido mensal dos extratos (lembrete = mesmo pedido, tom de reforço). */
export function emailPedidoExtrato({ empresa, competencia, link, lembrete = false }: {
  empresa: string; competencia: string; link: string; lembrete?: boolean;
}) {
  const assunto = lembrete
    ? `Lembrete: extratos de ${competencia} da ${empresa}`
    : `Envie os extratos de ${competencia} da ${empresa}`;
  const abertura = lembrete
    ? `Ainda não recebemos os extratos de <b>${esc(competencia)}</b> da <b>${esc(empresa)}</b>.`
    : `Chegou a hora de enviar os extratos de <b>${esc(competencia)}</b> da <b>${esc(empresa)}</b>.`;
  const corpo = "Mande pelo portal os extratos bancários do mês (OFX, CSV ou PDF). Com eles o contador fecha o mês e envia a guia do DAS.";
  const html = layout({
    titulo: lembrete ? "Faltam os extratos do mês" : "Hora de enviar os extratos",
    paragrafos: [abertura, corpo],
    botao: "Enviar extratos",
    link,
  });
  const texto = `${abertura.replace(/<\/?b>/g, "")}\n\n${corpo}\n\nEnviar extratos: ${link}`;
  return { assunto, html, texto };
}

/** Para o cliente: DAS em aberto perto do vencimento (dias = vencimento - hoje; negativo = vencido). */
export function emailLembreteDas({ empresa, competencia, valor, vencimento, dias, link }: {
  empresa: string; competencia: string; valor: string; vencimento: string; dias: number; link: string;
}) {
  const quando = dias < 0 ? "venceu ontem" : dias === 0 ? "vence hoje" : dias === 1 ? "vence amanhã" : `vence em ${dias} dias`;
  const assunto = `DAS de ${competencia} ${quando}: ${brl(valor)}`;
  const html = layout({
    titulo: dias < 0 ? "Seu DAS venceu" : "Lembrete do DAS",
    paragrafos: [
      `O DAS de <b>${esc(competencia)}</b> da <b>${esc(empresa)}</b> ${quando}.`,
      `Valor: <b>${brl(valor)}</b><br>Vencimento: <b>${dataBR(vencimento)}</b>`,
      dias < 0
        ? "Se ainda não pagou, fale com o contador para gerar uma guia atualizada. Se já pagou, clique em \"Já paguei\" no portal."
        : "Baixe a guia no portal e, depois de pagar, clique em \"Já paguei\" para avisar o contador.",
    ],
    botao: "Abrir o portal",
    link,
  });
  const texto = `O DAS de ${competencia} da ${empresa} ${quando}.\n\nValor: ${brl(valor)}\nVencimento: ${dataBR(vencimento)}\n\nPortal: ${link}`;
  return { assunto, html, texto };
}

/** Link de redefinição de senha (substitui o e-mail do Supabase quando o Resend está configurado). */
export function emailRecuperacaoSenha({ link }: { link: string }) {
  const assunto = "Redefinir sua senha";
  const html = layout({
    titulo: "Redefinir sua senha",
    paragrafos: ["Recebemos um pedido para redefinir a senha da sua conta.", "Clique no botão abaixo para criar uma nova senha. O link vale por 24 horas."],
    botao: "Criar nova senha",
    link,
    rodape: "Se você não pediu, pode ignorar este e-mail: sua senha continua a mesma.",
  });
  const texto = `Recebemos um pedido para redefinir a senha da sua conta.\n\nCrie uma nova senha neste link (vale por 24 horas):\n${link}\n\nSe você não pediu, pode ignorar este e-mail.`;
  return { assunto, html, texto };
}
