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
