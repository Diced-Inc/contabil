import {
  pgTable, pgEnum, uuid, text, numeric, date, timestamp, boolean, integer, jsonb, unique,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const regimeEnum = pgEnum("regime_tributario", ["simples", "presumido", "real"]);
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

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const money = (name: string) => numeric(name, { precision: 15, scale: 2 });

export const empresas = pgTable("empresas", {
  id: id(),
  razaoSocial: text("razao_social").notNull(),
  cnpj: text("cnpj").notNull().unique(),
  regimeTributario: regimeEnum("regime_tributario").notNull().default("simples"),
  cidade: text("cidade"),
  uf: text("uf"),
  responsavelNome: text("responsavel_nome"),
  responsavelCpf: text("responsavel_cpf"),
  contadorNome: text("contador_nome"),
  contadorCpf: text("contador_cpf"),
  contadorCrc: text("contador_crc"),
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
