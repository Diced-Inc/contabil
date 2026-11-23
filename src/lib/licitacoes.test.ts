import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  candidataTI, casaBusca, dataPncp, diasParaEncerrar, limitePrazo, mapearContratacao, normalizar, novaParaBusca, prazoEncerramento,
  separarTermos,
  type CriteriosBusca, type PaginaPncp,
} from "./licitacoes";

// Resposta real de /api/consulta/v1/contratacoes/proposta?uf=CE (3 itens, 16/11/2026).
const pagina: PaginaPncp = JSON.parse(readFileSync(path.resolve(__dirname, "../../test/fixtures/pncp-proposta.json"), "utf8"));
const [pregao, semValor, dispensa] = pagina.data.map(mapearContratacao);

describe("mapearContratacao", () => {
  it("mapeia o pregão com valor e link de origem", () => {
    expect(pregao).toMatchObject({
      numeroControle: "07954480000179-1-025781/2025",
      orgaoCnpj: "07954480000179",
      orgaoNome: "ESTADO DO CEARA",
      unidadeNome: "GOVERNO DO ESTADO DO CEARÁ",
      municipio: "Fortaleza",
      uf: "CE",
      modalidadeId: 6,
      modalidadeNome: "Pregão eletrônico",
      valorEstimado: "1387083.60",
      situacaoId: 1,
      ano: 2025,
      sequencial: 25781,
      processo: "42001002249202556",
      linkPncp: "https://pncp.gov.br/app/editais/07954480000179/2025/25781",
    });
    expect(pregao.linkSistemaOrigem).toMatch(/^https:\/\/cnetmobile\.estaleiro\.serpro\.gov\.br\//);
    // horário de Brasília sem fuso → UTC-3
    expect(pregao.encerramentoPropostas?.toISOString()).toBe("2026-11-17T13:30:00.000Z");
    expect(pregao.aberturaPropostas?.toISOString()).toBe("2026-11-03T11:00:00.000Z");
  });
  it("limpa espaços repetidos do objeto e indexa sem acento", () => {
    expect(pregao.objeto).not.toMatch(/\s{2}|\s$/);
    expect(pregao.objeto).toContain("serviço de vigilância, nas dependências");
    expect(pregao.textoBusca).toContain("servico de vigilancia, nas dependencias");
    expect(pregao.textoBusca).toContain("governo do estado do ceara");
  });
  it("valor 0/ausente e link de origem vazio viram null", () => {
    expect(semValor.valorEstimado).toBeNull();
    expect(semValor.linkSistemaOrigem).toBeNull();
    expect(dispensa.modalidadeNome).toBe("Dispensa");
  });
  it("guarda o JSON original", () => {
    expect(pregao.raw).toBe(pagina.data[0]);
  });
});

describe("dataPncp", () => {
  it("respeita fuso explícito e rejeita lixo", () => {
    expect(dataPncp("2026-01-01T00:00:00Z")?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(dataPncp("2026-01-01T12:00:00")?.toISOString()).toBe("2026-01-01T15:00:00.000Z");
    expect(dataPncp(null)).toBeNull();
    expect(dataPncp("ontem")).toBeNull();
  });
});

describe("casaBusca", () => {
  const vazia: CriteriosBusca = { termos: [], ufs: [], municipios: [], modalidades: [], valorMin: null, valorMax: null };
  const b = (c: Partial<CriteriosBusca>) => ({ ...vazia, ...c });
  it("sem critérios, tudo bate", () => expect(casaBusca(pregao, vazia)).toBe(true));
  it("termo sem acento e com maiúsculas bate no texto acentuado", () => {
    expect(casaBusca(pregao, b({ termos: ["VIGILÂNCIA"] }))).toBe(true);
    expect(casaBusca(pregao, b({ termos: ["vigilancia"] }))).toBe(true);
  });
  it("basta um dos termos", () => {
    expect(casaBusca(pregao, b({ termos: ["merenda", "vigilância"] }))).toBe(true);
    expect(casaBusca(pregao, b({ termos: ["merenda", "software"] }))).toBe(false);
  });
  it("termo com várias palavras é um trecho", () => {
    expect(casaBusca(pregao, b({ termos: ["mão de obra terceirizada"] }))).toBe(true);
    expect(casaBusca(pregao, b({ termos: ["obra mão"] }))).toBe(false);
  });
  it("UF, município (sem acento) e modalidade", () => {
    expect(casaBusca(pregao, b({ ufs: ["PI"] }))).toBe(false);
    expect(casaBusca(pregao, b({ ufs: ["CE", "PI"], municipios: ["fortaleza"] }))).toBe(true);
    expect(casaBusca(pregao, b({ municipios: ["Itapajé"] }))).toBe(false);
    expect(casaBusca(pregao, b({ modalidades: [8] }))).toBe(false);
    expect(casaBusca(dispensa, b({ modalidades: [8, 6] }))).toBe(true);
  });
  it("faixa de valor; sem valor fica fora quando há faixa", () => {
    expect(casaBusca(pregao, b({ valorMin: "1000000" }))).toBe(true);
    expect(casaBusca(pregao, b({ valorMax: 1000000 }))).toBe(false);
    expect(casaBusca(semValor, b({ valorMin: 1 }))).toBe(false);
    expect(casaBusca(semValor, b({ valorMin: null, valorMax: null }))).toBe(true);
  });
});

describe("separarTermos / normalizar", () => {
  it("vírgula, ponto e vírgula e quebra de linha separam; repetidos somem", () => {
    expect(separarTermos(" Limpeza, material de  ESCRITÓRIO;limpeza\n ")).toEqual(["limpeza", "material de escritorio"]);
    expect(normalizar("  Ação  Pública ")).toBe("acao publica");
  });
});

describe("prazo das propostas (America/Sao_Paulo)", () => {
  const agora = new Date("2026-11-16T23:30:00-03:00"); // 02:30 UTC do dia 17
  it("conta dias de calendário em SP, não em UTC", () => {
    expect(diasParaEncerrar(new Date("2026-11-16T23:59:00-03:00"), agora)).toBe(0);
    expect(diasParaEncerrar(new Date("2026-11-17T08:00:00-03:00"), agora)).toBe(1);
    expect(diasParaEncerrar(new Date("2026-11-20T08:00:00-03:00"), agora)).toBe(4);
  });
  it("textos e urgência (< 2 dias)", () => {
    expect(prazoEncerramento(new Date("2026-11-16T23:59:00-03:00"), agora)).toEqual({ texto: "Encerra hoje às 23:59", urgente: true, encerrada: false });
    expect(prazoEncerramento(new Date("2026-11-17T09:00:00-03:00"), agora).texto).toBe("Encerra amanhã às 09:00");
    expect(prazoEncerramento(new Date("2026-11-18T09:00:00-03:00"), agora)).toEqual({ texto: "Encerra em 2 dias", urgente: false, encerrada: false });
    expect(prazoEncerramento(new Date("2026-11-16T20:00:00-03:00"), agora).encerrada).toBe(true);
    expect(prazoEncerramento(null, agora).texto).toBe("Sem data de encerramento");
  });
  it("limite de 'encerra em até N dias' é o fim do dia N em SP", () => {
    expect(limitePrazo(0, agora).toISOString()).toBe("2026-11-17T03:00:00.000Z");
    expect(limitePrazo(7, agora).toISOString()).toBe("2026-11-24T03:00:00.000Z");
  });
});

describe("candidataTI (pré-filtro da IA)", () => {
  it.each([
    "CONTRATAÇÃO DE EMPRESA PARA MANUTENÇÃO DO SITE INSTITUCIONAL DA CÂMARA MUNICIPAL",
    "Desenvolvimento de website para a Secretaria de Turismo",
    "Atualização de conteúdo do sítio eletrônico oficial",
    "SERVIÇOS DE SUPORTE TÉCNICO REMOTO EM INFORMÁTICA",
    "Desenvolvimento de sistema web sob demanda",
    "Hospedagem e manutenção do portal da transparência",
    "Criação de formulário eletrônico de inscrição",
    "SERVIÇOS DE PROGRAMAÇÃO DE COMPUTADORES",
    "LOCAÇÃO DE SOFTWARE DE GERENCIAMENTO E CONTROLE DO SITE OFICIAL DA PREFEITURA",
    "Criação de página na internet",
    "[LICITANET] - Manutenção de sistemas web da prefeitura",
  ])("passa: %s", (objeto) => expect(candidataTI(objeto)).toBe(true));

  it.each([
    "Aquisição de gêneros alimentícios para a merenda escolar",
    "Reforma da Escola Lúcia Soares no Sítio Cajueiro da Jaburuna",
    "Construção de praça comunitária localizada no Sítio Campos",
    "Locação de ônibus rodoviário com capacidade para 42 passageiros",
    "Aquisição de kits escolares para a rede municipal",
  ])("descarta sem IA: %s", (objeto) => expect(candidataTI(objeto)).toBe(false));

  it("ignora o prefixo [Portal de Compras Públicas]", () => {
    expect(candidataTI("[Portal de Compras Públicas] - Contratação de serviços contínuos de auxiliar de limpeza")).toBe(false);
    expect(candidataTI("[Portal de Compras Públicas] - Hospedagem e manutenção de site")).toBe(true);
  });

  it("olha só o objeto, não o órgão nem o município", () => {
    // texto_busca juntaria "Secretaria de Tecnologia da Informação" e "Sítio X"; o pré-filtro recebe só o objeto
    expect(candidataTI("Aquisição de material de limpeza")).toBe(false);
  });
});

describe("novaParaBusca (alertas)", () => {
  const desde = new Date("2026-11-20T10:00:00Z");
  const base = { textoBusca: "manutencao de site", uf: "CE", municipio: "Fortaleza", modalidadeId: 6, valorEstimado: "1000.00" };
  const busca: CriteriosBusca = { termos: [], ufs: ["CE"], municipios: [], modalidades: [], valorMin: null, valorMax: null };
  const depois = new Date("2026-11-21T10:00:00Z");

  it("entra a classificada depois do último envio, mesmo tendo sido baixada antes", () => {
    expect(novaParaBusca({ ...base, categoria: "site_manutencao", classificadoEm: depois }, busca, desde)).toBe(true);
  });
  it("fica de fora a classificada antes do último envio", () => {
    expect(novaParaBusca({ ...base, categoria: "site_manutencao", classificadoEm: new Date("2026-11-19T10:00:00Z") }, busca, desde)).toBe(false);
  });
  it("fica de fora a pendente ou fora das categorias", () => {
    expect(novaParaBusca({ ...base, categoria: null, classificadoEm: null }, busca, desde)).toBe(false);
    expect(novaParaBusca({ ...base, categoria: "nenhuma", classificadoEm: depois }, busca, desde)).toBe(false);
  });
  it("respeita os critérios da busca", () => {
    expect(novaParaBusca({ ...base, categoria: "site_manutencao", classificadoEm: depois }, { ...busca, ufs: ["SP"] }, desde)).toBe(false);
  });
});
