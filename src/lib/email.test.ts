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
