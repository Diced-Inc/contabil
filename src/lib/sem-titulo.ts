/** Direto do extrato em conta de direito/obrigação, sem título que a reconheça (guard rail da conciliação e da IA). */
export type ContaComPapel = { codigo: string; nome: string; papel?: string | null };
export type TipoSemTitulo = "clientes" | "fornecedores" | "impostos";

const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/**
 * Clientes/Fornecedores pelo papel; impostos = passivo (classe 2) "a recolher" (inclui INSS/FGTS: também saem de guia).
 * Não há papel para impostos porque o papel é único por empresa.
 */
export function contaDeTitulo(c: ContaComPapel | undefined | null): TipoSemTitulo | null {
  if (!c) return null;
  if (c.papel === "clientes") return "clientes";
  if (c.papel === "fornecedores") return "fornecedores";
  if (/^2(\.|$)/.test(c.codigo) && /\ba recolher\b/.test(norm(c.nome))) return "impostos";
  return null;
}

/** Contas que a IA não pode sugerir: ela não sabe se há título/guia. Fornecedores pode (boleto e PIX a pessoa física). */
export const vetadaParaIA = (c: ContaComPapel) => {
  const t = contaDeTitulo(c);
  return t === "clientes" || t === "impostos";
};

/** confirmar: exige "Sei o que estou fazendo" (e o servidor recusa sem); alerta: aviso sem trava; info: lembrete. */
export const AVISOS_SEM_TITULO = {
  clientes: {
    nivel: "confirmar",
    texto: "Recebimento direto em Clientes sem título baixa um direito que não existe; use Baixar título ou classifique na receita.",
  },
  impostos: {
    nivel: "alerta",
    texto: "Pagamento direto em imposto a recolher sem a obrigação registrada deixa a conta devedora; classifique na despesa (ex.: Impostos e Taxas) ou registre a obrigação antes.",
  },
  fornecedores: {
    nivel: "info",
    texto: "Pagamento direto em Fornecedores: lembre de reconhecer a obrigação (título/NF) para o saldo não ficar devedor.",
  },
} as const satisfies Record<TipoSemTitulo, { nivel: "confirmar" | "alerta" | "info"; texto: string }>;

const ORDEM: TipoSemTitulo[] = ["clientes", "impostos", "fornecedores"];

/** Tipos presentes nas contas escolhidas, do mais grave para o mais leve. */
export function avisosSemTitulo(contas: (ContaComPapel | undefined | null)[]): TipoSemTitulo[] {
  const t = new Set(contas.map(contaDeTitulo));
  return ORDEM.filter((x) => t.has(x));
}

export const MSG_CONFIRMAR_CLIENTES = `${AVISOS_SEM_TITULO.clientes.texto} Para seguir assim, marque “Sei o que estou fazendo”.`;
