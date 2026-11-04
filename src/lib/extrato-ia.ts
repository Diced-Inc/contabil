import Anthropic from "@anthropic-ai/sdk";

export type LinhaIA = { data: string; historico: string; valor: string; saldoApos?: string };
export type ExtratoIA = {
  banco?: string;
  conta?: string;
  periodo?: { de: string; ate: string };
  saldoFinal?: string;
  transacoes: LinhaIA[];
};

const SYSTEM = `Você extrai a tabela de movimentações de extratos bancários brasileiros em PDF.
Regras:
- Extraia TODAS as linhas de movimentação, de todas as páginas, na ordem em que aparecem.
- valor: número com ponto decimal; NEGATIVO para saídas/débitos (pagamentos, Pix enviado, tarifas, "D", "-"), POSITIVO para entradas/créditos.
- data: YYYY-MM-DD. Se a linha não repete a data, use a da linha anterior. Se o ano não aparece, deduza pelo período do extrato.
- Ignore linhas de saldo (saldo anterior, saldo do dia, saldo final), totais, resumos e cabeçalhos; elas não são movimentações.
- historico: o texto da linha como impresso (descrição + favorecido/documento), sem inventar nada.
- saldo_apos: o saldo impresso na linha, se houver; senão "".
- banco, conta (número da conta como impresso), periodo_de, periodo_ate (YYYY-MM-DD) e saldo_final (último saldo do extrato, número com ponto): "" quando não constarem.
Responda chamando a ferramenta registrar_extrato uma única vez.`;

const TOOL: Anthropic.Tool = {
  name: "registrar_extrato",
  description: "Registra as movimentações extraídas do extrato",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["banco", "conta", "periodo_de", "periodo_ate", "saldo_final", "transacoes"],
    properties: {
      banco: { type: "string" },
      conta: { type: "string" },
      periodo_de: { type: "string" },
      periodo_ate: { type: "string" },
      saldo_final: { type: "string" },
      transacoes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["data", "historico", "valor", "saldo_apos"],
          properties: {
            data: { type: "string", description: "YYYY-MM-DD" },
            historico: { type: "string" },
            valor: { type: "number", description: "Negativo = saída/débito" },
            saldo_apos: { type: "string" },
          },
        },
      },
    },
  },
};

type Entrada = {
  banco: string; conta: string; periodo_de: string; periodo_ate: string; saldo_final: string;
  transacoes: { data: string; historico: string; valor: number; saldo_apos: string }[];
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const dinheiro = (s: string) => {
  const n = Number(s.replace(/\s/g, ""));
  return s.trim() && Number.isFinite(n) ? n.toFixed(2) : undefined;
};

let client: Anthropic | undefined; // lazy: importar sem ANTHROPIC_API_KEY não pode quebrar

export async function extrairExtratoPdf(buf: Buffer): Promise<ExtratoIA> {
  client ??= new Anthropic();
  // tool_choice forçado dá 400 nos modelos atuais: auto + strict + instrução, com 1 nova tentativa (igual a classificacao/ia.ts).
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const res = await client.messages.create({
      model: process.env.IA_MODEL ?? "claude-sonnet-5-5",
      max_tokens: 16000,
      output_config: { effort: "low" }, // transcrição; o orçamento vai para a saída, não para raciocínio
      system: SYSTEM,
      messages: [{
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") } },
          { type: "text", text: "Extraia as movimentações deste extrato." },
        ],
      }],
      tools: [TOOL],
      tool_choice: { type: "auto", disable_parallel_tool_use: true },
    });
    if (res.stop_reason === "refusal") throw new Error("a IA recusou o documento");
    if (res.stop_reason === "max_tokens") throw new Error("extrato longo demais para uma extração; divida o PDF por período");
    const tu = res.content.find((b) => b.type === "tool_use");
    if (!tu) continue;
    const i = tu.input as Entrada;
    const transacoes = i.transacoes
      .filter((t) => ISO.test(t.data) && Number.isFinite(t.valor) && t.valor !== 0)
      .map((t): LinhaIA => {
        const saldoApos = dinheiro(t.saldo_apos);
        return { data: t.data, historico: t.historico.replace(/\s+/g, " ").trim(), valor: t.valor.toFixed(2), ...(saldoApos && { saldoApos }) };
      });
    const saldoFinal = dinheiro(i.saldo_final);
    return {
      ...(i.banco.trim() && { banco: i.banco.trim() }),
      ...(i.conta.trim() && { conta: i.conta.trim() }),
      ...(ISO.test(i.periodo_de) && ISO.test(i.periodo_ate) && { periodo: { de: i.periodo_de, ate: i.periodo_ate } }),
      ...(saldoFinal && { saldoFinal }),
      transacoes,
    };
  }
  throw new Error("a IA não retornou as movimentações");
}
