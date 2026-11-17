/**
 * Leitura da guia de imposto em PDF (DAS do PGDAS-D ou DARF da Receita): texto do PDF + parser puro `lerGuia`.
 * Sem valor ou vencimento no texto (PDF escaneado, layout novo), `lerGuiaPdf` cai na IA (mesmo padrão de extrato-ia.ts).
 */
import Anthropic from "@anthropic-ai/sdk";

export type TipoGuia = "DAS" | "DARF";
export type Guia = {
  tipo: TipoGuia | null;
  /** "YYYY-MM-DD" (DAS: "Pagar este documento até"). */
  vencimento?: string;
  /** "1585.01" */
  valor?: string;
  /** "YYYY-MM" */
  periodo?: string;
  /** só dígitos */
  cnpj?: string;
  numero?: string;
  codigoReceita?: string;
  /** DARF de contribuição previdenciária (DCTFWeb, CP segurados/patronal). */
  previdenciario?: boolean;
};

const MESES = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const DATA = /(\d{2})\/(\d{2})\/(\d{4})/;
const DINHEIRO = /\d{1,3}(?:\.\d{3})*,\d{2}/;
const CNPJ = /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/;
const PERIODO = new RegExp(`(${MESES.join("|")})\\/(\\d{4})|(\\d{2})\\/(\\d{2})\\/(\\d{4})|\\b(\\d{2})\\/(\\d{4})\\b`);
/** Códigos de receita de contribuição previdenciária (DCTFWeb) mais comuns. */
const PREVIDENCIARIOS = new Set(["1082", "1099", "1138", "1141", "1646", "1170", "1176", "1191", "1196", "1200", "1213", "1221"]);

/** Sem acento e minúsculo; mantém as quebras de linha (servem para a tabela de composição). */
const normalizar = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[ \t ]+/g, " ");

const isoData = ([, d, m, a]: string[]) => {
  const iso = `${a}-${m}-${d}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(dt.getTime()) && dt.toISOString().startsWith(iso) ? iso : undefined;
};
const mes = (a: string, m: number) => (m >= 1 && m <= 12 ? `${a}-${String(m).padStart(2, "0")}` : undefined);

/** Todas as ocorrências de `valor` na janela logo depois do primeiro `rotulo` que tiver alguma. */
function depois(t: string, rotulo: RegExp, valor: RegExp, janela = 160): RegExpExecArray[] {
  const g = new RegExp(rotulo.source, "g");
  for (const r of t.matchAll(g)) {
    const trecho = t.slice(r.index + r[0].length, r.index + r[0].length + janela);
    const achados = [...trecho.matchAll(new RegExp(valor.source, "g"))];
    if (achados.length) return achados;
  }
  return [];
}

export function lerGuia(texto: string): Guia {
  const t = normalizar(texto);
  const tipo: TipoGuia | null = /documento de arrecadacao\s+do simples nacional/.test(t)
    ? "DAS"
    : /documento de arrecadacao\s+de receitas federais|\bdarf\b/.test(t)
      ? "DARF"
      : null;
  const guia: Guia = { tipo };

  // "Outubro/2026" em qualquer lugar manda: no layout do PGDAS-D o rótulo vem longe do valor e a 1ª data depois dele é o "pagar até".
  const nome = t.match(new RegExp(`\\b(${MESES.join("|")})\\/(\\d{4})`));
  const [p] = nome ? [nome] : depois(t, /periodo de apuracao/, PERIODO, 120);
  if (p) guia.periodo = p[1] ? mes(p[2], MESES.indexOf(p[1]) + 1) : p[3] ? mes(p[5], Number(p[4])) : mes(p[7], Number(p[6]));

  // "Pagar este documento até" manda (o DAS pode trazer a data prorrogada); senão "Data de Vencimento".
  // Rótulos agrupados ("Período de Apuração Data de Vencimento\n31/10/2026 20/11/2026"): o vencimento é a maior das duas primeiras datas.
  const [ate] = depois(t, /pagar (?:este documento )?ate/, DATA, 60);
  const venc = ate ? [ate] : depois(t, /data de vencimento|\bvencimento\b/, DATA, 120).slice(0, 2);
  const datas = venc.map(isoData).filter((d): d is string => !!d).sort();
  if (datas.length) guia.vencimento = datas.at(-1);

  for (const rotulo of [/valor total do documento/, /valor total/, /valor do principal/]) {
    const [v] = depois(t, rotulo, DINHEIRO, 80);
    const n = v && v[0].replace(/\./g, "").replace(",", ".");
    if (n && Number(n) > 0) {
      guia.valor = Number(n).toFixed(2);
      break;
    }
  }

  const [c] = depois(t, /cnpj/, CNPJ, 120);
  const cnpj = c?.[0] ?? t.match(CNPJ)?.[0];
  if (cnpj) guia.cnpj = cnpj.replace(/\D/g, "");

  const [n] = depois(t, /numero do documento/, /\d[\d.-]{9,}\d/, 80);
  if (n) guia.numero = n[0];

  if (tipo === "DARF") {
    const composicao = t.split("composicao do documento de arrecadacao")[1] ?? "";
    const codigos = [...composicao.matchAll(/^(\d{4}) /gm)].map((m) => m[1]);
    const [cod] = depois(t, /codigo da receita/, /\b\d{4}\b/, 40);
    const codigo = cod?.[0] ?? codigos[0];
    if (codigo) guia.codigoReceita = codigo;
    guia.previdenciario =
      /dctfweb|contribuicao previdenciaria|\bcp (?:segurados|patronal|terceiros)\b/.test(t) ||
      [...codigos, ...(codigo ? [codigo] : [])].some((x) => PREVIDENCIARIOS.has(x));
  }
  return guia;
}

/** Texto do PDF (pdf.js sem worker, roda no Node da Vercel). */
export async function textoDoPdf(buf: Uint8Array) {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(buf);
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

// ---------- IA (reserva) ----------

const SYSTEM = `Você lê guias de imposto brasileiras em PDF: DAS (Documento de Arrecadação do Simples Nacional) ou DARF (Documento de Arrecadação de Receitas Federais).
Extraia, como impresso na guia:
- tipo: "DAS", "DARF" ou "".
- vencimento: data de "Pagar este documento até" (ou "Data de Vencimento"/"Pagar até"), em YYYY-MM-DD.
- valor: "Valor Total do Documento" (ou "Valor Total"), número com ponto decimal, ex.: "1585.01".
- periodo: "Período de Apuração" em YYYY-MM (ex.: "Outubro/2026" -> "2026-10"; "31/10/2026" -> "2026-10").
- cnpj: só os dígitos. numero: "Número do Documento". codigo_receita: código da receita (DARF).
Use "" para o que não constar; não invente. Responda chamando a ferramenta registrar_guia uma única vez.`;

const TOOL: Anthropic.Tool = {
  name: "registrar_guia",
  description: "Registra os dados lidos da guia de imposto",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["tipo", "vencimento", "valor", "periodo", "cnpj", "numero", "codigo_receita"],
    properties: {
      tipo: { type: "string", enum: ["DAS", "DARF", ""] },
      vencimento: { type: "string", description: "YYYY-MM-DD" },
      valor: { type: "string", description: "1585.01" },
      periodo: { type: "string", description: "YYYY-MM" },
      cnpj: { type: "string" },
      numero: { type: "string" },
      codigo_receita: { type: "string" },
    },
  },
};

type EntradaIA = Record<"tipo" | "vencimento" | "valor" | "periodo" | "cnpj" | "numero" | "codigo_receita", string>;

let client: Anthropic | undefined; // lazy: importar sem ANTHROPIC_API_KEY não pode quebrar

async function lerGuiaIA(buf: Uint8Array): Promise<Guia> {
  client ??= new Anthropic();
  // tool_choice forçado dá 400 nos modelos atuais: auto + strict + instrução, com 1 nova tentativa (igual a extrato-ia.ts).
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const res = await client.messages.create({
      model: process.env.IA_MODEL ?? "claude-sonnet-5-5",
      max_tokens: 4000,
      output_config: { effort: "low" }, // transcrição de poucos campos
      system: SYSTEM,
      messages: [{
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(buf).toString("base64") } },
          { type: "text", text: "Leia esta guia." },
        ],
      }],
      tools: [TOOL],
      tool_choice: { type: "auto", disable_parallel_tool_use: true },
    });
    if (res.stop_reason === "refusal") throw new Error("a IA recusou o documento");
    const tu = res.content.find((b) => b.type === "tool_use");
    if (!tu) continue;
    const i = tu.input as EntradaIA;
    const valor = Number(i.valor);
    return {
      tipo: i.tipo === "DAS" || i.tipo === "DARF" ? i.tipo : null,
      ...(/^\d{4}-\d{2}-\d{2}$/.test(i.vencimento) && { vencimento: i.vencimento }),
      ...(Number.isFinite(valor) && valor > 0 && { valor: valor.toFixed(2) }),
      ...(/^\d{4}-\d{2}$/.test(i.periodo) && { periodo: i.periodo }),
      ...(i.cnpj.replace(/\D/g, "").length === 14 && { cnpj: i.cnpj.replace(/\D/g, "") }),
      ...(i.numero.trim() && { numero: i.numero.trim() }),
      ...(/^\d{4}$/.test(i.codigo_receita) && { codigoReceita: i.codigo_receita }),
    };
  }
  throw new Error("a IA não retornou os dados da guia");
}

/**
 * Lê a guia: primeiro pelo texto do PDF; se faltar valor ou vencimento, pela IA (completa só o que faltou).
 * Nunca lança: falha vira guia vazia e o contador digita.
 */
export async function lerGuiaPdf(buf: Uint8Array): Promise<{ guia: Guia; fonte: "texto" | "ia" | null }> {
  let guia: Guia = { tipo: null };
  try {
    guia = lerGuia(await textoDoPdf(buf.slice()));
  } catch (e) {
    console.error("[guia] texto do PDF:", e);
  }
  if (guia.valor && guia.vencimento) return { guia, fonte: "texto" };
  try {
    const ia = await lerGuiaIA(buf);
    const junto = { ...ia, ...Object.fromEntries(Object.entries(guia).filter(([, v]) => v !== undefined && v !== null)) } as Guia;
    return { guia: junto, fonte: ia.valor || ia.vencimento ? "ia" : null };
  } catch (e) {
    console.error("[guia] IA:", e);
    return { guia, fonte: guia.valor || guia.vencimento ? "texto" : null };
  }
}
