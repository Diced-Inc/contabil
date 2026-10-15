import Anthropic from "@anthropic-ai/sdk";

export type ContaIA = { codigo: string; nome: string; natureza: "D" | "C" };
export type ExemploIA = { memo: string; valor: string; contaCodigo: string };
export type SugestaoIA = { contaCodigo: string; confianca: number; historico: string; justificativa: string };

const SYSTEM = `Você é um contador brasileiro classificando movimentações de extrato bancário de uma pequena empresa (regime de competência, ITG 1000).
Escolha a conta contábil de contrapartida para a movimentação. Regras: entrada não é automaticamente receita (pode ser empréstimo, aporte de sócio, transferência, recebimento de cliente já faturado); saída não é automaticamente despesa (pode ser pró-labore, distribuição de lucros, pagamento de fornecedor já provisionado, imobilizado, parcela de empréstimo).
Transferência entre contas da própria empresa, aporte/empréstimo de sócio ou pagamento a sócio sem finalidade clara: confiança baixa (<= 0.5) e justifique.
Use só códigos da lista. Histórico curto, no padrão contábil ("Pagamento tarifa bancária", "Recebimento cliente XYZ").
Responda sempre chamando a ferramenta classificar, uma única vez.`;

const TOOL: Anthropic.Tool = {
  name: "classificar",
  description: "Classificação contábil da movimentação",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["conta_codigo", "confianca", "historico", "justificativa"],
    properties: {
      conta_codigo: { type: "string", description: "Código da conta de contrapartida, exatamente como na lista" },
      confianca: { type: "number", description: "Confiança de 0 a 1" },
      historico: { type: "string" },
      justificativa: { type: "string" },
    },
  },
};

let client: Anthropic | undefined; // lazy: importar sem ANTHROPIC_API_KEY não pode quebrar

export async function classificarComIA(t: { data: string; valor: string; memo: string }, contas: ContaIA[], exemplos: ExemploIA[]): Promise<SugestaoIA> {
  client ??= new Anthropic();
  const sinal = Number(t.valor) > 0 ? "ENTRADA (crédito no banco)" : "SAÍDA (débito no banco)";
  const user = `Plano de contas (código | nome | natureza):\n${contas.map((c) => `${c.codigo} | ${c.nome} | ${c.natureza}`).join("\n")}\n\n` +
    (exemplos.length ? `Classificações já aprovadas pelo contador nesta empresa (memo → conta):\n${exemplos.map((e) => `"${e.memo}" (${e.valor}) → ${e.contaCodigo}`).join("\n")}\n\n` : "") +
    `Movimentação:\nData: ${t.data}\nTipo: ${sinal}\nValor: ${t.valor}\nMemo: ${t.memo}`;

  // tool_choice forçado ({type:"tool"}) dá 400 nos modelos atuais (Sonnet 5.5/Opus 5.5): auto + strict + instrução, com 1 nova tentativa.
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const res = await client.messages.create({
      model: process.env.IA_MODEL ?? "claude-sonnet-5-5",
      max_tokens: 4000,
      output_config: { effort: "low" }, // classificação curta; não precisa de raciocínio longo
      system: SYSTEM,
      messages: [{ role: "user", content: user }],
      tools: [TOOL],
      tool_choice: { type: "auto", disable_parallel_tool_use: true },
    });
    if (res.stop_reason === "refusal") throw new Error("IA recusou classificar");
    const tu = res.content.find((b) => b.type === "tool_use");
    if (!tu) continue;
    const i = tu.input as { conta_codigo: string; confianca: number; historico: string; justificativa: string };
    if (!contas.some((c) => c.codigo === i.conta_codigo)) throw new Error(`IA sugeriu código inexistente: ${i.conta_codigo}`);
    const confianca = Number.isFinite(i.confianca) ? Math.min(1, Math.max(0, i.confianca)) : 0;
    return { contaCodigo: i.conta_codigo, confianca, historico: i.historico, justificativa: i.justificativa };
  }
  throw new Error("IA não retornou classificação");
}
