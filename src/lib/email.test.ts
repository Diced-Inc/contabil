import { afterEach, describe, expect, it, vi } from "vitest";
import { emailConvite, enviarEmail } from "./email";

describe("email", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("sem chave não envia", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    expect(await enviarEmail({ para: "a@b.com", assunto: "x", html: "x", texto: "x" })).toEqual({ status: "nao_configurado" });
  });

  it("convite escapa nome/empresa no HTML e mantém o link", () => {
    const e = emailConvite({ nome: "<b>Ana</b>", empresa: "A & B Ltda", link: "https://x.dev/c?a=1&b=2" });
    expect(e.html).toContain("&lt;b&gt;Ana&lt;/b&gt;");
    expect(e.html).toContain("A &amp; B Ltda");
    expect(e.html).toContain('href="https://x.dev/c?a=1&amp;b=2"');
    expect(e.texto).toContain("https://x.dev/c?a=1&b=2");
    expect(e.assunto).toBe("Seu acesso ao portal da A & B Ltda");
  });
});

describe("templates do ciclo", () => {
  it("das_disponivel formata valor e vencimento", async () => {
    const { emailDasDisponivel } = await import("./email");
    const e = emailDasDisponivel({ empresa: "Diced", competencia: "outubro de 2026", valor: "1250.5", vencimento: "2026-11-20", link: "https://x.dev/p" });
    expect(e.assunto).toBe("DAS de outubro de 2026 disponível: R$ 1.250,50, vence 20/11/2026");
    expect(e.html).toContain("Baixar a guia");
  });
  it("extrato_recebido escapa observação e usa rodapé do contador", async () => {
    const { emailExtratoRecebido } = await import("./email");
    const e = emailExtratoRecebido({ empresa: "Diced", competencia: "outubro de 2026", arquivos: ["a.ofx", "b.pdf"], quem: "Ana", observacao: "<x>", link: "https://x.dev/d" });
    expect(e.assunto).toBe("Diced: 2 arquivos de outubro de 2026");
    expect(e.html).toContain("&lt;x&gt;");
    expect(e.html).not.toContain("liberou seu acesso");
  });
});

describe("reply-to", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  const corpoEnviado = async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ id: "r1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("RESEND_API_KEY", "k");
    vi.stubEnv("EMAIL_FROM", "A <a@b.com>");
    expect(await enviarEmail({ para: "c@d.com", assunto: "x", html: "x", texto: "x" })).toEqual({ status: "enviado", id: "r1" });
    return JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
  };
  it("usa EMAIL_REPLY_TO quando configurado", async () => {
    vi.stubEnv("EMAIL_REPLY_TO", "contato@x.com");
    expect((await corpoEnviado()).reply_to).toBe("contato@x.com");
  });
  it("sem EMAIL_REPLY_TO não manda o campo", async () => {
    vi.stubEnv("EMAIL_REPLY_TO", "");
    expect(await corpoEnviado()).not.toHaveProperty("reply_to");
  });
});

describe("templates para o contador", () => {
  it("extrato_por_fora com e sem nota", async () => {
    const { emailExtratoPorFora } = await import("./email");
    const e = emailExtratoPorFora({ empresa: "Diced", mes: "outubro de 2026", quem: "Marcelo", nota: "Mandei pelo <WhatsApp>", link: "https://x.dev/f" });
    expect(e.texto).toContain("Marcelo avisou que enviou os extratos de outubro de 2026 da Diced por outro canal: Mandei pelo <WhatsApp>");
    expect(e.html).toContain("Mandei pelo &lt;WhatsApp&gt;");
    const s = emailExtratoPorFora({ empresa: "Diced", mes: "outubro de 2026", quem: "Marcelo", nota: null, link: "https://x.dev/f" });
    expect(s.texto).toContain("por outro canal.");
  });
  it("das_pago traz valor e quando", async () => {
    const { emailDasPago } = await import("./email");
    const e = emailDasPago({ empresa: "Diced", competencia: "outubro de 2026", valor: "99.9", quem: "Ana", quando: "16/11/2026 10:00", link: "https://x.dev/f" });
    expect(e.assunto).toMatch(/^Diced: DAS de outubro de 2026 pago \(R\$\s99,90\)$/);
    expect(e.texto).toContain("Informado em: 16/11/2026 10:00");
  });
});
