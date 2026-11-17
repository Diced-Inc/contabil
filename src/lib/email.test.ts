import { afterEach, describe, expect, it, vi } from "vitest";
import {
  emailConvite, emailExtratoPorFora, emailExtratoRecebido, emailGuiaPaga, emailGuiasDisponiveis, emailLembreteGuias, emailPedidoExtrato,
  emailRecuperacaoSenha, enviarEmail,
} from "./email";

// toLocaleString("pt-BR") separa "R$" do número com espaço não separável.
const R$ = (v: string) => `R$ ${v}`;

describe("email", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("sem chave não envia", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    expect(await enviarEmail({ para: "a@b.com", assunto: "x", html: "x", texto: "x" })).toEqual({ status: "nao_configurado" });
  });

  it("convite escapa nome/empresa no HTML, mantém o link e identifica a marca antes da empresa", () => {
    const e = emailConvite({ nome: "<b>Ana</b>", empresa: "A & B Ltda", link: "https://x.dev/c?a=1&b=2" });
    expect(e.html).toContain("&lt;b&gt;Ana&lt;/b&gt;");
    expect(e.html).toContain("A &amp; B Ltda");
    expect(e.html).toContain('href="https://x.dev/c?a=1&amp;b=2"');
    expect(e.html).toContain('src="https://app.dbcontador.com.br/logo.png"');
    expect(e.html).toMatch(/DB Contador<\/span><span[^>]*>&nbsp;&middot;&nbsp;A &amp; B Ltda/);
    expect(e.texto).toContain("https://x.dev/c?a=1&b=2");
    expect(e.assunto).toBe("Seu acesso ao DB Contador está pronto · A & B Ltda");
  });
});

describe("templates do ciclo", () => {
  const das = { nome: "DAS", valor: "1250.5", vencimento: "2026-11-20" };
  const inss = { nome: "DARF previdenciário (INSS)", valor: "330.6", vencimento: "2026-11-23" };
  const base = { empresa: "Diced", competencia: "outubro de 2026", link: "https://x.dev/p" };
  it("guias_disponiveis com uma guia destaca valor, vencimento e período", () => {
    const e = emailGuiasDisponiveis({ ...base, guias: [das] });
    expect(e.assunto).toBe(`Seu DAS de outubro está disponível: ${R$("1.250,50")}, vence 20/11 · DB Contador`);
    expect(e.html).toContain(R$("1.250,50"));
    expect(e.html).toContain("20/11/2026");
    expect(e.html).toContain("Período de apuração");
    expect(e.html).toContain("Baixar a guia");
    expect(e.texto).not.toContain("Total");
  });
  it("guias_disponiveis lista todas com o total; guia enviada depois sai como nova", () => {
    const e = emailGuiasDisponiveis({ ...base, guias: [das, inss] });
    expect(e.assunto).toBe(`Suas guias de outubro estão disponíveis: 2 guias, ${R$("1.581,10")} · DB Contador`);
    expect(e.html).toContain("Total do mês");
    expect(e.html).toContain("DARF previdenciário (INSS)");
    expect(e.texto).toContain(`- DARF previdenciário (INSS): ${R$("330,60")}, vence 23/11/2026`);
    expect(e.texto).toContain(`Total: ${R$("1.581,10")}`);
    expect(e.html).toContain("Baixar as guias");
    const x = emailGuiasDisponiveis({ ...base, guias: [inss], extra: true });
    expect(x.assunto).toBe(`Nova guia: DARF previdenciário (INSS) de outubro: ${R$("330,60")}, vence 23/11 · DB Contador`);
    expect(x.texto).toContain("enviou mais uma guia");
  });
  it("lembrete das guias: uma ou várias em aberto", () => {
    const um = emailLembreteGuias({ ...base, guias: [das], dias: 3 });
    expect(um.assunto).toBe(`Lembrete: seu DAS de outubro vence em 3 dias (${R$("1.250,50")}) · DB Contador`);
    const varias = emailLembreteGuias({ ...base, guias: [das, inss], dias: 0 });
    expect(varias.assunto).toBe("Lembrete: 2 guias de outubro em aberto, a primeira vence hoje · DB Contador");
    expect(varias.html).toContain("Em aberto");
  });
  it("extrato_recebido escapa observação e usa rodapé do contador", () => {
    const e = emailExtratoRecebido({ empresa: "Diced", competencia: "outubro de 2026", arquivos: ["a.ofx", "b.pdf"], quem: "Ana", observacao: "<x>", link: "https://x.dev/d" });
    expect(e.assunto).toBe("Extratos de outubro recebidos: Diced (2 arquivos) · DB Contador");
    expect(e.html).toContain("&lt;x&gt;");
    expect(e.html).not.toContain("liberou seu acesso");
  });
  it("assuntos começam pela ação e terminam com a marca; razão social como cadastrada", () => {
    const base = { empresa: "DICED DESENVOLVIMENTO DIGITAL LTDA", competencia: "outubro de 2026", link: "https://x.dev/p" };
    expect(emailPedidoExtrato(base).assunto).toBe("Envie os extratos de outubro · DB Contador");
    expect(emailPedidoExtrato({ ...base, lembrete: true }).assunto).toBe("Lembrete: faltam os extratos de outubro · DB Contador");
    const das = emailLembreteGuias({ ...base, guias: [{ nome: "DAS", valor: "1585.01", vencimento: "2026-11-20" }], dias: 3 });
    expect(das.assunto).toBe(`Lembrete: seu DAS de outubro vence em 3 dias (${R$("1.585,01")}) · DB Contador`);
    expect(das.html).toContain("DICED DESENVOLVIMENTO DIGITAL LTDA");
    expect(emailRecuperacaoSenha({ link: "https://x.dev/r" }).assunto).toBe("Redefina sua senha · DB Contador");
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
  it("extrato_por_fora com e sem nota", () => {
    const e = emailExtratoPorFora({ empresa: "Diced", mes: "outubro de 2026", quem: "Marcelo", nota: "Mandei pelo <WhatsApp>", link: "https://x.dev/f" });
    expect(e.texto).toContain("Marcelo avisou que enviou os extratos de outubro de 2026 da Diced por outro canal: Mandei pelo <WhatsApp>");
    expect(e.html).toContain("Mandei pelo &lt;WhatsApp&gt;");
    const s = emailExtratoPorFora({ empresa: "Diced", mes: "outubro de 2026", quem: "Marcelo", nota: null, link: "https://x.dev/f" });
    expect(s.texto).toContain("por outro canal.");
  });
  it("guia paga traz qual guia, valor, quando e se ainda falta alguma", () => {
    const base = { empresa: "Diced", competencia: "outubro de 2026", guia: { nome: "DAS", valor: "99.9" }, quem: "Ana", quando: "16/11/2026 10:00", link: "https://x.dev/f" };
    const e = emailGuiaPaga({ ...base, faltam: ["DARF previdenciário (INSS)"] });
    expect(e.assunto).toBe(`DAS de outubro pago: Diced (${R$("99,90")}) · DB Contador`);
    expect(e.texto).toContain("Informado em: 16/11/2026 10:00");
    expect(e.texto).toContain("Ainda em aberto: DARF previdenciário (INSS).");
    const todas = emailGuiaPaga({ ...base, faltam: [] });
    expect(todas.texto).toContain("Todas as guias do mês estão pagas.");
    expect(todas.html).toContain("Todas as guias pagas");
  });
});
