CREATE TYPE "public"."acao_log" AS ENUM('criado', 'alterado', 'estornado', 'fechamento', 'reabertura', 'apuracao');--> statement-breakpoint
CREATE TYPE "public"."grupo_dre" AS ENUM('receita_bruta', 'deducoes', 'custos', 'despesas_operacionais', 'receitas_financeiras', 'despesas_financeiras', 'outras_receitas', 'outras_despesas', 'tributos_lucro');--> statement-breakpoint
CREATE TYPE "public"."natureza" AS ENUM('D', 'C');--> statement-breakpoint
CREATE TYPE "public"."origem_lancamento" AS ENUM('manual', 'conciliacao', 'apuracao', 'estorno');--> statement-breakpoint
CREATE TYPE "public"."origem_sugestao" AS ENUM('regra', 'ia', 'transferencia');--> statement-breakpoint
CREATE TYPE "public"."papel_conta" AS ENUM('lucros_acumulados', 'prejuizos_acumulados', 'clientes', 'fornecedores');--> statement-breakpoint
CREATE TYPE "public"."regime_tributario" AS ENUM('simples', 'presumido', 'real');--> statement-breakpoint
CREATE TYPE "public"."sinal" AS ENUM('entrada', 'saida', 'qualquer');--> statement-breakpoint
CREATE TYPE "public"."status_lancamento" AS ENUM('aprovado', 'estornado');--> statement-breakpoint
CREATE TYPE "public"."status_titulo" AS ENUM('aberto', 'baixado', 'cancelado');--> statement-breakpoint
CREATE TYPE "public"."status_transacao" AS ENUM('pendente', 'classificada', 'transferencia', 'ignorada');--> statement-breakpoint
CREATE TYPE "public"."tipo_conta" AS ENUM('sintetica', 'analitica');--> statement-breakpoint
CREATE TYPE "public"."tipo_match" AS ENUM('memo_contem', 'documento', 'valor_exato');--> statement-breakpoint
CREATE TYPE "public"."tipo_titulo" AS ENUM('receber', 'pagar');--> statement-breakpoint
CREATE TABLE "apuracoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"exercicio" integer NOT NULL,
	"lancamento_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "apuracoes_empresa_id_exercicio_unique" UNIQUE("empresa_id","exercicio")
);
--> statement-breakpoint
CREATE TABLE "contas_bancarias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"banco" text,
	"agencia" text,
	"numero" text,
	"ofx_bankid" text NOT NULL,
	"ofx_acctid" text NOT NULL,
	"conta_contabil_id" uuid NOT NULL,
	"ativa" boolean DEFAULT true NOT NULL,
	CONSTRAINT "contas_bancarias_empresa_id_ofx_bankid_ofx_acctid_unique" UNIQUE("empresa_id","ofx_bankid","ofx_acctid")
);
--> statement-breakpoint
CREATE TABLE "empresas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"razao_social" text NOT NULL,
	"cnpj" text NOT NULL,
	"regime_tributario" "regime_tributario" DEFAULT 'simples' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "empresas_cnpj_unique" UNIQUE("cnpj")
);
--> statement-breakpoint
CREATE TABLE "fechamentos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"competencia" date NOT NULL,
	"fechado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"fechado_por" uuid,
	CONSTRAINT "fechamentos_empresa_id_competencia_unique" UNIQUE("empresa_id","competencia")
);
--> statement-breakpoint
CREATE TABLE "importacoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conta_bancaria_id" uuid NOT NULL,
	"nome_arquivo" text NOT NULL,
	"periodo_inicio" date,
	"periodo_fim" date,
	"saldo_final" numeric(15, 2),
	"data_saldo" date,
	"qtd_transacoes" integer NOT NULL,
	"qtd_novas" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lancamento_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lancamento_id" uuid,
	"empresa_id" uuid NOT NULL,
	"acao" "acao_log" NOT NULL,
	"usuario_id" uuid,
	"antes" jsonb,
	"depois" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lancamentos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"numero" integer GENERATED ALWAYS AS IDENTITY (sequence name "lancamentos_numero_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"data" date NOT NULL,
	"competencia" date NOT NULL,
	"data_pagamento" date,
	"historico" text NOT NULL,
	"documento" text,
	"origem" "origem_lancamento" NOT NULL,
	"status" "status_lancamento" DEFAULT 'aprovado' NOT NULL,
	"estorno_de_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partidas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lancamento_id" uuid NOT NULL,
	"conta_id" uuid NOT NULL,
	"debito" numeric(15, 2) DEFAULT '0' NOT NULL,
	"credito" numeric(15, 2) DEFAULT '0' NOT NULL,
	"ordem" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plano_contas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"codigo" text NOT NULL,
	"nome" text NOT NULL,
	"natureza" "natureza" NOT NULL,
	"tipo" "tipo_conta" NOT NULL,
	"parent_id" uuid,
	"grupo_dre" "grupo_dre",
	"papel" "papel_conta",
	"ativa" boolean DEFAULT true NOT NULL,
	CONSTRAINT "plano_contas_empresa_id_codigo_unique" UNIQUE("empresa_id","codigo"),
	CONSTRAINT "plano_contas_empresa_id_papel_unique" UNIQUE("empresa_id","papel")
);
--> statement-breakpoint
CREATE TABLE "regras" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"tipo_match" "tipo_match" NOT NULL,
	"padrao" text NOT NULL,
	"sinal" "sinal" DEFAULT 'qualquer' NOT NULL,
	"conta_id" uuid NOT NULL,
	"historico_template" text DEFAULT '{memo}' NOT NULL,
	"prioridade" integer DEFAULT 100 NOT NULL,
	"ativa" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "titulos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"tipo" "tipo_titulo" NOT NULL,
	"contraparte" text NOT NULL,
	"documento" text,
	"descricao" text NOT NULL,
	"valor" numeric(15, 2) NOT NULL,
	"competencia" date NOT NULL,
	"vencimento" date,
	"lancamento_id" uuid,
	"status" "status_titulo" DEFAULT 'aberto' NOT NULL,
	"baixa_lancamento_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transacoes_bancarias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conta_bancaria_id" uuid NOT NULL,
	"importacao_id" uuid NOT NULL,
	"fitid" text NOT NULL,
	"data" date NOT NULL,
	"valor" numeric(15, 2) NOT NULL,
	"memo" text DEFAULT '' NOT NULL,
	"tipo_ofx" text,
	"status" "status_transacao" DEFAULT 'pendente' NOT NULL,
	"lancamento_id" uuid,
	"sugestao_conta_id" uuid,
	"sugestao_confianca" numeric(3, 2),
	"sugestao_origem" "origem_sugestao",
	"sugestao_regra_id" uuid,
	"sugestao_historico" text,
	"sugestao_justificativa" text,
	"transferencia_par_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transacoes_bancarias_conta_bancaria_id_fitid_unique" UNIQUE("conta_bancaria_id","fitid")
);
--> statement-breakpoint
ALTER TABLE "apuracoes" ADD CONSTRAINT "apuracoes_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apuracoes" ADD CONSTRAINT "apuracoes_lancamento_id_lancamentos_id_fk" FOREIGN KEY ("lancamento_id") REFERENCES "public"."lancamentos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contas_bancarias" ADD CONSTRAINT "contas_bancarias_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contas_bancarias" ADD CONSTRAINT "contas_bancarias_conta_contabil_id_plano_contas_id_fk" FOREIGN KEY ("conta_contabil_id") REFERENCES "public"."plano_contas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fechamentos" ADD CONSTRAINT "fechamentos_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "importacoes" ADD CONSTRAINT "importacoes_conta_bancaria_id_contas_bancarias_id_fk" FOREIGN KEY ("conta_bancaria_id") REFERENCES "public"."contas_bancarias"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lancamento_log" ADD CONSTRAINT "lancamento_log_lancamento_id_lancamentos_id_fk" FOREIGN KEY ("lancamento_id") REFERENCES "public"."lancamentos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lancamento_log" ADD CONSTRAINT "lancamento_log_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lancamentos" ADD CONSTRAINT "lancamentos_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partidas" ADD CONSTRAINT "partidas_lancamento_id_lancamentos_id_fk" FOREIGN KEY ("lancamento_id") REFERENCES "public"."lancamentos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partidas" ADD CONSTRAINT "partidas_conta_id_plano_contas_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."plano_contas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plano_contas" ADD CONSTRAINT "plano_contas_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regras" ADD CONSTRAINT "regras_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regras" ADD CONSTRAINT "regras_conta_id_plano_contas_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."plano_contas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "titulos" ADD CONSTRAINT "titulos_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "titulos" ADD CONSTRAINT "titulos_lancamento_id_lancamentos_id_fk" FOREIGN KEY ("lancamento_id") REFERENCES "public"."lancamentos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "titulos" ADD CONSTRAINT "titulos_baixa_lancamento_id_lancamentos_id_fk" FOREIGN KEY ("baixa_lancamento_id") REFERENCES "public"."lancamentos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transacoes_bancarias" ADD CONSTRAINT "transacoes_bancarias_conta_bancaria_id_contas_bancarias_id_fk" FOREIGN KEY ("conta_bancaria_id") REFERENCES "public"."contas_bancarias"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transacoes_bancarias" ADD CONSTRAINT "transacoes_bancarias_importacao_id_importacoes_id_fk" FOREIGN KEY ("importacao_id") REFERENCES "public"."importacoes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transacoes_bancarias" ADD CONSTRAINT "transacoes_bancarias_lancamento_id_lancamentos_id_fk" FOREIGN KEY ("lancamento_id") REFERENCES "public"."lancamentos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transacoes_bancarias" ADD CONSTRAINT "transacoes_bancarias_sugestao_conta_id_plano_contas_id_fk" FOREIGN KEY ("sugestao_conta_id") REFERENCES "public"."plano_contas"("id") ON DELETE set null ON UPDATE no action;