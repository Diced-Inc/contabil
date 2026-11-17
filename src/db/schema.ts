import {
  pgTable, pgEnum, uuid, text, numeric, date, timestamp, boolean, integer, jsonb, unique,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import type { MotivoEncerramento } from "@/lib/ciclo";

export const regimeEnum = pgEnum("regime_tributario", ["simples", "presumido", "real", "mei"]);
export const porteEnum = pgEnum("porte_empresa", ["mei", "me", "epp", "demais"]);
export const naturezaEnum = pgEnum("natureza", ["D", "C"]);
export const tipoContaEnum = pgEnum("tipo_conta", ["sintetica", "analitica"]);
export const grupoDreEnum = pgEnum("grupo_dre", [
  "receita_bruta", "deducoes", "custos", "despesas_operacionais", "receitas_financeiras",
  "despesas_financeiras", "outras_receitas", "outras_despesas", "tributos_lucro",
]);
export const papelEnum = pgEnum("papel_conta", ["lucros_acumulados", "prejuizos_acumulados", "clientes", "fornecedores"]);
export const statusTransacaoEnum = pgEnum("status_transacao", ["pendente", "classificada", "transferencia", "ignorada"]);
export const origemSugestaoEnum = pgEnum("origem_sugestao", ["regra", "ia", "transferencia"]);
export const origemLancEnum = pgEnum("origem_lancamento", ["manual", "conciliacao", "apuracao", "estorno"]);
export const statusLancEnum = pgEnum("status_lancamento", ["aprovado", "estornado"]);
export const tipoMatchEnum = pgEnum("tipo_match", ["memo_contem", "documento", "valor_exato"]);
export const sinalEnum = pgEnum("sinal", ["entrada", "saida", "qualquer"]);
export const tipoTituloEnum = pgEnum("tipo_titulo", ["receber", "pagar"]);
export const statusTituloEnum = pgEnum("status_titulo", ["aberto", "baixado", "cancelado"]);
export const acaoLogEnum = pgEnum("acao_log", ["criado", "alterado", "estornado", "fechamento", "reabertura", "apuracao"]);
export const papelMembroEnum = pgEnum("papel_membro", ["cliente"]);
export const statusCicloEnum = pgEnum("status_ciclo", [
  "aguardando_extrato", "extrato_recebido", "em_processamento", "das_enviado", "das_pago", "encerrado",
]);
export const statusNotificacaoEnum = pgEnum("status_notificacao", ["enviado", "erro", "nao_configurado"]);

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const money = (name: string) => numeric(name, { precision: 15, scale: 2 });

export const empresas = pgTable("empresas", {
  id: id(),
  razaoSocial: text("razao_social").notNull(),
  cnpj: text("cnpj").notNull().unique(),
  regimeTributario: regimeEnum("regime_tributario").notNull().default("simples"),
  porte: porteEnum("porte"),
  cidade: text("cidade"),
  uf: text("uf"),
  responsavelNome: text("responsavel_nome"),
  responsavelCpf: text("responsavel_cpf"),
  contadorNome: text("contador_nome"),
  contadorCpf: text("contador_cpf"),
  contadorCrc: text("contador_crc"),
  logoPath: text("logo_path"),
  // Avisos por e-mail ao cliente (cron diário): dia do pedido do extrato, lembretes (dias depois do pedido),
  // lembretes do DAS (dias depois do envio da guia e dias antes do vencimento).
  avisosAtivos: boolean("avisos_ativos").notNull().default(false),
  diaPedidoExtrato: integer("dia_pedido_extrato").notNull().default(1),
  lembretesExtratoDias: integer("lembretes_extrato_dias").array().notNull().default(sql`'{4,9}'`),
  lembretesDasAposEnvio: integer("lembretes_das_apos_envio").array().notNull().default(sql`'{3}'`),
  diasAntesVencimentoDas: integer("dias_antes_vencimento_das").array().notNull().default(sql`'{3}'`),
  createdAt: createdAt(),
});

export const planoContas = pgTable("plano_contas", {
  id: id(),
  empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
  codigo: text("codigo").notNull(),
  nome: text("nome").notNull(),
  natureza: naturezaEnum("natureza").notNull(),
  tipo: tipoContaEnum("tipo").notNull(),
  parentId: uuid("parent_id"),
  grupoDre: grupoDreEnum("grupo_dre"),
  papel: papelEnum("papel"),
  ativa: boolean("ativa").notNull().default(true),
}, (t) => [unique().on(t.empresaId, t.codigo), unique().on(t.empresaId, t.papel)]);

export const contasBancarias = pgTable("contas_bancarias", {
  id: id(),
  empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
  nome: text("nome").notNull(),
  banco: text("banco"),
  agencia: text("agencia"),
  numero: text("numero"),
  ofxBankid: text("ofx_bankid").notNull(),
  ofxAcctid: text("ofx_acctid").notNull(),
  contaContabilId: uuid("conta_contabil_id").notNull().references(() => planoContas.id),
  ativa: boolean("ativa").notNull().default(true),
}, (t) => [unique().on(t.empresaId, t.ofxBankid, t.ofxAcctid)]);

export const importacoes = pgTable("importacoes", {
  id: id(),
  contaBancariaId: uuid("conta_bancaria_id").notNull().references(() => contasBancarias.id, { onDelete: "cascade" }),
  nomeArquivo: text("nome_arquivo").notNull(),
  periodoInicio: date("periodo_inicio"),
  periodoFim: date("periodo_fim"),
  saldoFinal: money("saldo_final"),
  dataSaldo: date("data_saldo"),
  qtdTransacoes: integer("qtd_transacoes").notNull(),
  qtdNovas: integer("qtd_novas").notNull(),
  origem: text("origem").$type<"ofx" | "csv" | "pdf">().notNull().default("ofx"),
  createdAt: createdAt(),
});

/** Último mapeamento de colunas CSV usado na conta (um por conta). */
export const mapeamentosCsv = pgTable("mapeamentos_csv", {
  id: id(),
  contaBancariaId: uuid("conta_bancaria_id").notNull().unique().references(() => contasBancarias.id, { onDelete: "cascade" }),
  nome: text("nome"),
  mapeamento: jsonb("mapeamento").notNull(),
  createdAt: createdAt(),
});

export const lancamentos = pgTable("lancamentos", {
  id: id(),
  empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
  numero: integer("numero").notNull().generatedAlwaysAsIdentity(),
  data: date("data").notNull(),
  competencia: date("competencia").notNull(),
  dataPagamento: date("data_pagamento"),
  historico: text("historico").notNull(),
  documento: text("documento"),
  origem: origemLancEnum("origem").notNull(),
  status: statusLancEnum("status").notNull().default("aprovado"),
  estornoDeId: uuid("estorno_de_id"),
  createdBy: uuid("created_by"),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const partidas = pgTable("partidas", {
  id: id(),
  lancamentoId: uuid("lancamento_id").notNull().references(() => lancamentos.id, { onDelete: "cascade" }),
  contaId: uuid("conta_id").notNull().references(() => planoContas.id),
  debito: money("debito").notNull().default("0"),
  credito: money("credito").notNull().default("0"),
  ordem: integer("ordem").notNull().default(0),
});

export const transacoesBancarias = pgTable("transacoes_bancarias", {
  id: id(),
  contaBancariaId: uuid("conta_bancaria_id").notNull().references(() => contasBancarias.id, { onDelete: "cascade" }),
  importacaoId: uuid("importacao_id").notNull().references(() => importacoes.id, { onDelete: "cascade" }),
  fitid: text("fitid").notNull(),
  data: date("data").notNull(),
  valor: money("valor").notNull(),
  memo: text("memo").notNull().default(""),
  tipoOfx: text("tipo_ofx"),
  status: statusTransacaoEnum("status").notNull().default("pendente"),
  lancamentoId: uuid("lancamento_id").references(() => lancamentos.id, { onDelete: "set null" }),
  sugestaoContaId: uuid("sugestao_conta_id").references(() => planoContas.id, { onDelete: "set null" }),
  sugestaoConfianca: numeric("sugestao_confianca", { precision: 3, scale: 2 }),
  sugestaoOrigem: origemSugestaoEnum("sugestao_origem"),
  sugestaoRegraId: uuid("sugestao_regra_id"),
  sugestaoHistorico: text("sugestao_historico"),
  sugestaoJustificativa: text("sugestao_justificativa"),
  transferenciaParId: uuid("transferencia_par_id"),
  createdAt: createdAt(),
}, (t) => [unique().on(t.contaBancariaId, t.fitid)]);

export const regras = pgTable("regras", {
  id: id(),
  empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
  nome: text("nome").notNull(),
  tipoMatch: tipoMatchEnum("tipo_match").notNull(),
  padrao: text("padrao").notNull(),
  sinal: sinalEnum("sinal").notNull().default("qualquer"),
  contaId: uuid("conta_id").notNull().references(() => planoContas.id),
  historicoTemplate: text("historico_template").notNull().default("{memo}"),
  prioridade: integer("prioridade").notNull().default(100),
  ativa: boolean("ativa").notNull().default(true),
  createdAt: createdAt(),
});

export const titulos = pgTable("titulos", {
  id: id(),
  empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
  tipo: tipoTituloEnum("tipo").notNull(),
  contraparte: text("contraparte").notNull(),
  documento: text("documento"),
  descricao: text("descricao").notNull(),
  valor: money("valor").notNull(),
  competencia: date("competencia").notNull(),
  vencimento: date("vencimento"),
  lancamentoId: uuid("lancamento_id").references(() => lancamentos.id),
  status: statusTituloEnum("status").notNull().default("aberto"),
  baixaLancamentoId: uuid("baixa_lancamento_id").references(() => lancamentos.id),
  createdAt: createdAt(),
});

export const fechamentos = pgTable("fechamentos", {
  id: id(),
  empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
  competencia: date("competencia").notNull(),
  fechadoEm: timestamp("fechado_em", { withTimezone: true }).notNull().defaultNow(),
  fechadoPor: uuid("fechado_por"),
}, (t) => [unique().on(t.empresaId, t.competencia)]);

export const apuracoes = pgTable("apuracoes", {
  id: id(),
  empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
  exercicio: integer("exercicio").notNull(),
  lancamentoId: uuid("lancamento_id").notNull().references(() => lancamentos.id),
  createdAt: createdAt(),
}, (t) => [unique().on(t.empresaId, t.exercicio)]);

export const lancamentoLog = pgTable("lancamento_log", {
  id: id(),
  lancamentoId: uuid("lancamento_id").references(() => lancamentos.id, { onDelete: "set null" }),
  empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
  acao: acaoLogEnum("acao").notNull(),
  usuarioId: uuid("usuario_id"),
  antes: jsonb("antes"),
  depois: jsonb("depois"),
  createdAt: createdAt(),
});

/** Quem vê todas as empresas e as telas contábeis. user_id referencia auth.users (FK na migration 0007). */
export const contadores = pgTable("contadores", {
  userId: uuid("user_id").primaryKey(),
  email: text("email").notNull().unique(),
  createdAt: createdAt(),
});

/** Acesso do cliente ao portal de uma empresa. user_id fica null até o primeiro login com o e-mail convidado. */
export const membros = pgTable("membros", {
  id: id(),
  empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
  userId: uuid("user_id"),
  email: text("email").notNull(),
  papel: papelMembroEnum("papel").notNull().default("cliente"),
  nome: text("nome"),
  convidadoEm: timestamp("convidado_em", { withTimezone: true }).notNull().defaultNow(),
  aceitoEm: timestamp("aceito_em", { withTimezone: true }),
}, (t) => [unique().on(t.empresaId, t.email)]);

/** Ciclo mensal com o cliente: extratos da competência → processamento → DAS. Criado sob demanda. */
export const ciclosMensais = pgTable("ciclos_mensais", {
  id: id(),
  empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
  competencia: date("competencia").notNull(),
  status: statusCicloEnum("status").notNull().default("aguardando_extrato"),
  extratoSolicitadoEm: timestamp("extrato_solicitado_em", { withTimezone: true }),
  extratoRecebidoEm: timestamp("extrato_recebido_em", { withTimezone: true }),
  concluidoEm: timestamp("concluido_em", { withTimezone: true }),
  dasValor: money("das_valor"),
  dasVencimento: date("das_vencimento"),
  dasPath: text("das_path"),
  dasEnviadoEm: timestamp("das_enviado_em", { withTimezone: true }),
  dasPagoEm: timestamp("das_pago_em", { withTimezone: true }),
  dasPagoPor: uuid("das_pago_por"),
  observacao: text("observacao"),
  /** Encerrado sem DAS pelo contador; a observação é interna (o cliente não vê). */
  encerradoEm: timestamp("encerrado_em", { withTimezone: true }),
  encerradoMotivo: text("encerrado_motivo").$type<MotivoEncerramento>(),
  encerradoObs: text("encerrado_obs"),
  /** Nota do cliente ao avisar que enviou os extratos por outro canal. */
  clienteObs: text("cliente_obs"),
  createdAt: createdAt(),
}, (t) => [unique().on(t.empresaId, t.competencia)]);

/** Arquivo enviado pelo cliente (bucket documentos), até o contador importar ou marcar como processado. */
export const documentosRecebidos = pgTable("documentos_recebidos", {
  id: id(),
  empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
  cicloId: uuid("ciclo_id").notNull().references(() => ciclosMensais.id, { onDelete: "cascade" }),
  contaBancariaId: uuid("conta_bancaria_id").references(() => contasBancarias.id, { onDelete: "set null" }),
  nomeArquivo: text("nome_arquivo").notNull(),
  path: text("path").notNull().unique(),
  mime: text("mime").notNull(),
  tamanho: integer("tamanho").notNull(),
  observacao: text("observacao"),
  enviadoPor: uuid("enviado_por"),
  createdAt: createdAt(),
  processadoEm: timestamp("processado_em", { withTimezone: true }),
  importacaoId: uuid("importacao_id").references(() => importacoes.id, { onDelete: "set null" }),
});

export type TipoNotificacao =
  | "convite" | "pedido_extrato" | "lembrete_extrato" | "extrato_recebido" | "extrato_por_fora" | "das_disponivel" | "lembrete_das"
  | "das_pago" | "recuperacao_senha";

/** Histórico e idempotência dos e-mails: um por (ciclo, tipo, destinatário, dia). */
export const notificacoes = pgTable("notificacoes", {
  id: id(),
  empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
  cicloId: uuid("ciclo_id").references(() => ciclosMensais.id, { onDelete: "cascade" }),
  tipo: text("tipo").$type<TipoNotificacao>().notNull(),
  para: text("para").notNull(),
  assunto: text("assunto").notNull(),
  status: statusNotificacaoEnum("status").notNull(),
  resendId: text("resend_id"),
  erro: text("erro"),
  dataRef: date("data_ref").notNull().default(sql`(now() at time zone 'America/Sao_Paulo')::date`),
  createdAt: createdAt(),
}, (t) => [unique().on(t.cicloId, t.tipo, t.para, t.dataRef)]);

export type CicloMensal = typeof ciclosMensais.$inferSelect;
export type StatusCiclo = CicloMensal["status"];
export type Empresa = typeof empresas.$inferSelect;
export type Conta = typeof planoContas.$inferSelect;
export type ContaBancaria = typeof contasBancarias.$inferSelect;
export type Transacao = typeof transacoesBancarias.$inferSelect;
export type Lancamento = typeof lancamentos.$inferSelect;
export type Partida = typeof partidas.$inferSelect;
export type Regra = typeof regras.$inferSelect;
export type Titulo = typeof titulos.$inferSelect;

export const lancamentosRelations = relations(lancamentos, ({ many }) => ({ partidas: many(partidas) }));
export const partidasRelations = relations(partidas, ({ one }) => ({
  lancamento: one(lancamentos, { fields: [partidas.lancamentoId], references: [lancamentos.id] }),
  conta: one(planoContas, { fields: [partidas.contaId], references: [planoContas.id] }),
}));

/** Endereço do domínio do escritório esperando o destino confirmar no Cloudflare; vira regra na próxima visita à tela. */
export const enderecosPendentes = pgTable("enderecos_pendentes", {
  local: text("local").primaryKey(),
  destino: text("destino").notNull(),
  nome: text("nome"),
  createdAt: createdAt(),
});

// Licitações (PNCP): cache das contratações com propostas abertas, acompanhamento e buscas com alerta por e-mail.
export const statusLicitacaoSalvaEnum = pgEnum("status_licitacao_salva", [
  "interesse", "analisando", "proposta_enviada", "descartada", "ganha", "perdida",
]);

/** Contratação do PNCP; created_at = primeira vez que a sincronização viu (base dos alertas de "novas"). */
export const licitacoes = pgTable("licitacoes", {
  id: id(),
  numeroControle: text("numero_controle").notNull().unique(),
  orgaoCnpj: text("orgao_cnpj").notNull(),
  orgaoNome: text("orgao_nome").notNull(),
  unidadeNome: text("unidade_nome").notNull(),
  municipio: text("municipio").notNull(),
  uf: text("uf").notNull(),
  modalidadeId: integer("modalidade_id").notNull(),
  modalidadeNome: text("modalidade_nome").notNull(),
  objeto: text("objeto").notNull(),
  valorEstimado: money("valor_estimado"),
  aberturaPropostas: timestamp("abertura_propostas", { withTimezone: true }),
  encerramentoPropostas: timestamp("encerramento_propostas", { withTimezone: true }),
  situacaoId: integer("situacao_id").notNull(),
  situacaoNome: text("situacao_nome").notNull(),
  ano: integer("ano").notNull(),
  sequencial: integer("sequencial").notNull(),
  numeroCompra: text("numero_compra"),
  processo: text("processo"),
  linkPncp: text("link_pncp").notNull(),
  linkSistemaOrigem: text("link_sistema_origem"),
  /** objeto + órgão + unidade + município + processo, minúsculo e sem acento (busca por trecho). */
  textoBusca: text("texto_busca").notNull(),
  raw: jsonb("raw").notNull(),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Uma por licitação: etapa, empresa cliente que pode participar e anotações. */
export const licitacoesSalvas = pgTable("licitacoes_salvas", {
  id: id(),
  licitacaoId: uuid("licitacao_id").notNull().unique().references(() => licitacoes.id, { onDelete: "cascade" }),
  empresaId: uuid("empresa_id").references(() => empresas.id, { onDelete: "set null" }),
  status: statusLicitacaoSalvaEnum("status").notNull().default("interesse"),
  nota: text("nota"),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Busca salva; ativa = entra no e-mail diário das novas. As UFs das buscas ativas também entram na sincronização. */
export const buscasLicitacao = pgTable("buscas_licitacao", {
  id: id(),
  nome: text("nome").notNull(),
  termos: text("termos").array().notNull().default(sql`'{}'`),
  ufs: text("ufs").array().notNull().default(sql`'{}'`),
  municipios: text("municipios").array().notNull().default(sql`'{}'`),
  modalidades: integer("modalidades").array().notNull().default(sql`'{}'`),
  valorMin: money("valor_min"),
  valorMax: money("valor_max"),
  empresaId: uuid("empresa_id").references(() => empresas.id, { onDelete: "set null" }),
  ativa: boolean("ativa").notNull().default(true),
  ultimoEnvio: timestamp("ultimo_envio", { withTimezone: true }),
  createdAt: createdAt(),
});

/** Progresso da sincronização por UF: retoma da próxima página se a execução anterior parou no limite de tempo. */
export const licitacoesSync = pgTable("licitacoes_sync", {
  uf: text("uf").primaryKey(),
  proximaPagina: integer("proxima_pagina").notNull().default(1),
  totalPaginas: integer("total_paginas"),
  iniciadoEm: timestamp("iniciado_em", { withTimezone: true }),
  /** Fim da última execução (completa, parcial ou com erro). */
  finalizadoEm: timestamp("finalizado_em", { withTimezone: true }),
  /** Fim da última passada completa por todas as páginas. */
  concluidoEm: timestamp("concluido_em", { withTimezone: true }),
  erro: text("erro"),
});

export type Licitacao = typeof licitacoes.$inferSelect;
export type BuscaLicitacao = typeof buscasLicitacao.$inferSelect;
