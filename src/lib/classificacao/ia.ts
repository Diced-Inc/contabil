import Anthropic from "@anthropic-ai/sdk";

export type ContaIA = { codigo: string; nome: string; natureza: "D" | "C" };
export type ExemploIA = { memo: string; valor: string; contaCodigo: string };
export type TransacaoIA = { data: string; valor: string; memo: string };
export type SugestaoIA = { contaCodigo: string; confianca: number; historico: string; justificativa: string };

const SYSTEM = `Você é um contador brasileiro classificando movimentações de extrato bancário de uma pequena empresa (regime de competência, ITG 1000).
Para cada movimentação da lista, escolha a conta contábil de contrapartida. Regras: entrada não é automaticamente receita (pode ser empréstimo, aporte de sócio, transferência, recebimento de cliente já faturado); saída não é automaticamente despesa (pode ser pró-labore, distribuição de lucros, pagamento de fornecedor já provisionado, imobilizado, parcela de empréstimo).
Transferência entre contas da própria empresa, aporte/empréstimo de sócio ou pagamento a sócio sem finalidade clara: confiança baixa (<= 0.5) e justifique.
Exceção: se uma classificação já aprovada pelo contador nesta empresa tem memo praticamente igual (mesma contraparte, mesmo tipo de operação) e o mesmo sinal, siga essa conta com confiança alta (>= 0.85), mesmo nos casos acima; o contador já decidiu como tratar essa contraparte.
Use só códigos da lista. Histórico curto, no padrão contábil ("Pagamento tarifa bancária", "Recebimento cliente XYZ"). Justificativa: até 15 palavras.
Responda chamando a ferramenta classificar uma única vez, com um item para cada movimentação (n = número da movimentação na lista).`;

const TOOL: Anthropic.Tool = {
  name: "classificar",
  description: "Classificação contábil de cada movimentação, pelo número na lista",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["itens"],
    properties: {
      itens: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["n", "conta_codigo", "confianca", "historico", "justificativa"],
          properties: {
            n: { type: "integer", description: "Número da movimentação, como na lista" },
            conta_codigo: { type: "string", description: "Código da conta de contrapartida, exatamente como na lista" },
            confianca: { type: "number", description: "Confiança de 0 a 1" },
            historico: { type: "string" },
            justificativa: { type: "string" },
          },
        },
      },
    },
  },
};

let client: Anthropic | undefined; // lazy: importar sem ANTHROPIC_API_KEY não pode quebrar

const sinal = (valor: string) => (Number(valor) > 0 ? "ENTRADA" : "SAÍDA");

/**
 * Classifica um lote (até ~20) numa chamada. Devolve só os itens válidos (código existente, n único);
 * os que faltarem ficam sem sugestão para a próxima rodada. Lança em falha de API, recusa ou resposta cortada.
 * `timeoutMs`: teto desta chamada (o chamador deriva do prazo que sobra na função).
 */
export async function classificarLoteIA(
  itens: TransacaoIA[], contas: ContaIA[], exemplos: ExemploIA[], { timeoutMs = 120_000 }: { timeoutMs?: number } = {},
): Promise<Map<number, SugestaoIA>> {
  client ??= new Anthropic({ maxRetries: 1 });
  const codigos = new Set(contas.map((c) => c.codigo));
  const user = `Plano de contas (código | nome | natureza):\n${contas.map((c) => `${c.codigo} | ${c.nome} | ${c.natureza}`).join("\n")}\n\n` +
    (exemplos.length
      ? `Classificações já aprovadas pelo contador nesta empresa (memo (valor) → conta):\n${exemplos.map((e) => `"${e.memo}" (${e.valor}) → ${e.contaCodigo}`).join("\n")}\n\n`
      : "") +
    `Movimentações (n. data | tipo | valor | memo):\n${itens.map((t, i) => `${i + 1}. ${t.data} | ${sinal(t.valor)} | ${t.valor} | ${t.memo}`).join("\n")}`;

  const prazo = Date.now() + timeoutMs;
  // tool_choice forçado ({type:"tool"}) dá 400 nos modelos atuais (Sonnet 5.5/Opus 5.5): auto + strict + instrução, com 1 nova tentativa.
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const resta = prazo - Date.now();
    if (resta < 5_000) break;
    const res = await client.messages.create({
      model: process.env.IA_MODEL ?? "claude-sonnet-5-5",
      max_tokens: 12000,
      output_config: { effort: "low" }, // classificação curta; não precisa de raciocínio longo
      system: SYSTEM,
      messages: [{ role: "user", content: user }],
      tools: [TOOL],
      tool_choice: { type: "auto", disable_parallel_tool_use: true },
    }, { signal: AbortSignal.timeout(resta) }); // cobre as novas tentativas do SDK também
    if (res.stop_reason === "refusal") throw new Error("IA recusou classificar");
    if (res.stop_reason === "max_tokens") throw new Error("Resposta da IA cortada (max_tokens)");
    const tu = res.content.find((b) => b.type === "tool_use");
    if (!tu) continue;
    const r = new Map<number, SugestaoIA>();
    const repetidos = new Set<number>();
    for (const it of (tu.input as { itens: { n: number; conta_codigo: string; confianca: number; historico: string; justificativa: string }[] }).itens) {
      const i = it.n - 1;
      if (!Number.isInteger(i) || i < 0 || i >= itens.length || !codigos.has(it.conta_codigo)) continue;
      if (r.has(i)) repetidos.add(i);
      const confianca = Number.isFinite(it.confianca) ? Math.min(1, Math.max(0, it.confianca)) : 0;
      r.set(i, { contaCodigo: it.conta_codigo, confianca, historico: it.historico, justificativa: it.justificativa });
    }
    for (const i of repetidos) r.delete(i); // resposta ambígua: fica para a próxima rodada
    return r;
  }
  throw new Error("IA não retornou classificação");
}
