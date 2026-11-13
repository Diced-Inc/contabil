/** Envio de e-mail pela API REST do Resend (sem SDK). Sem RESEND_API_KEY/EMAIL_FROM, nada sai e o status é nao_configurado. */
export type ResultadoEmail = { status: "enviado" | "erro" | "nao_configurado"; id?: string; erro?: string };
export type Email = { para: string; assunto: string; html: string; texto: string };

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
function layout({ titulo, paragrafos, botao, link }: { titulo: string; paragrafos: string[]; botao: string; link: string }) {
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
<tr><td style="padding:16px 4px 0;font-size:12px;color:#8a9491">Você recebeu este e-mail porque seu contador liberou seu acesso. Se não esperava por ele, pode ignorar.</td></tr>
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
