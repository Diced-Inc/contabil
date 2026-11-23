import Anthropic from "@anthropic-ai/sdk";
import { CATEGORIAS, CHAVES_CATEGORIAS, NENHUMA, type Categoria } from "./licitacoes";

export type ClassificacaoIA = { categoria: Categoria | typeof NENHUMA; motivo: string };

const SYSTEM = `Você filtra licitações públicas para uma pequena empresa de desenvolvimento web e suporte de TI.
Para cada objeto de licitação, escolha UMA categoria, ou "${NENHUMA}". As categorias de interesse são só estas:
${CHAVES_CATEGORIAS.map((k) => `- ${k}: ${CATEGORIAS[k]}`).join("\n")}

Aceite apenas quando o objeto principal for um SERVIÇO de: criar, desenvolver, manter, atualizar ou hospedar site/portal/página na internet ou sistema web; desenvolver formulário eletrônico; programação de computadores sob demanda; ou suporte técnico REMOTO em informática.
Responda "${NENHUMA}" para:
- compra ou locação de equipamentos, computadores, periféricos, rede, peças ou materiais;
- licença, assinatura ou locação de software pronto (Microsoft, antivírus, CAD, Oracle, ERP/gestão pública/folha/contabilidade/saúde/educação em SaaS), a não ser que o objeto seja construir ou manter um site ou sistema web;
- "hospedagem" de pessoas (hotel, pousada, pacientes); "sítio" como lugar rural; obras e engenharia; "sistema" de água, energia, esgoto, som, câmeras, alarme, ar-condicionado;
- help desk ou postos de trabalho presenciais com mão de obra alocada; digitalização ou guarda de documentos; consultoria, auditoria, treinamento, publicidade;
- "desenvolvimento" no sentido social, econômico, infantil ou de pessoas.
Na dúvida (objeto misto ou genérico), escolha a categoria mais próxima só se o serviço for o objeto principal; senão "${NENHUMA}".
motivo: até 12 palavras, em português.
Responda chamando a ferramenta classificar uma única vez, com todos os itens.`;

const TOOL: Anthropic.Tool = {
  name: "classificar",
  description: "Categoria de cada licitação, pelo número do item",
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
          required: ["n", "categoria", "motivo"],
          properties: {
            n: { type: "integer", description: "Número do item, como na lista" },
            categoria: { type: "string", enum: [...CHAVES_CATEGORIAS, NENHUMA] },
            motivo: { type: "string" },
          },
        },
      },
    },
  },
};

let client: Anthropic | undefined; // lazy: importar sem ANTHROPIC_API_KEY não pode quebrar

export const MODELO_LICITACOES = () => process.env.IA_MODEL_LICITACOES ?? "claude-haiku-5-5";

/**
 * Classifica um lote de objetos (até ~40). Devolve só os itens que voltaram válidos; os que faltarem ficam pendentes.
 * Lança erro em falha de API, recusa ou resposta cortada: o chamador deixa o lote para a próxima rodada.
 */
export async function classificarObjetos(objetos: string[]): Promise<Map<number, ClassificacaoIA>> {
  client ??= new Anthropic({ timeout: 40_000, maxRetries: 1 });
  const lista = objetos.map((o, i) => `${i + 1}. ${o.slice(0, 700)}`).join("\n");
  // tool_choice forçado dá 400 nos modelos atuais: auto + strict + instrução, com 1 nova tentativa.
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const res = await client.messages.create({
      model: MODELO_LICITACOES(),
      max_tokens: 8000,
      output_config: { effort: "low" },
      system: SYSTEM,
      messages: [{ role: "user", content: `Licitações:\n${lista}` }],
      tools: [TOOL],
      tool_choice: { type: "auto", disable_parallel_tool_use: true },
    });
    if (res.stop_reason === "refusal") throw new Error("IA recusou classificar");
    if (res.stop_reason === "max_tokens") throw new Error("Resposta da IA cortada (max_tokens)");
    const tu = res.content.find((b) => b.type === "tool_use");
    if (!tu) continue;
    const { itens } = tu.input as { itens: { n: number; categoria: ClassificacaoIA["categoria"]; motivo: string }[] };
    const r = new Map<number, ClassificacaoIA>();
    const repetidos = new Set<number>();
    for (const { n, categoria, motivo } of itens) {
      const i = n - 1;
      if (!Number.isInteger(i) || i < 0 || i >= objetos.length) continue;
      if (r.has(i)) repetidos.add(i);
      r.set(i, { categoria, motivo });
    }
    for (const i of repetidos) r.delete(i); // resposta ambígua: fica pendente
    return r;
  }
  throw new Error("IA não retornou classificação");
}
