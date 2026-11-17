CREATE TYPE "public"."status_licitacao_salva" AS ENUM('interesse', 'analisando', 'proposta_enviada', 'descartada', 'ganha', 'perdida');--> statement-breakpoint
CREATE TABLE "buscas_licitacao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"termos" text[] DEFAULT '{}' NOT NULL,
	"ufs" text[] DEFAULT '{}' NOT NULL,
	"municipios" text[] DEFAULT '{}' NOT NULL,
	"modalidades" integer[] DEFAULT '{}' NOT NULL,
	"valor_min" numeric(15, 2),
	"valor_max" numeric(15, 2),
	"empresa_id" uuid,
	"ativa" boolean DEFAULT true NOT NULL,
	"ultimo_envio" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "licitacoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"numero_controle" text NOT NULL,
	"orgao_cnpj" text NOT NULL,
	"orgao_nome" text NOT NULL,
	"unidade_nome" text NOT NULL,
	"municipio" text NOT NULL,
	"uf" text NOT NULL,
	"modalidade_id" integer NOT NULL,
	"modalidade_nome" text NOT NULL,
	"objeto" text NOT NULL,
	"valor_estimado" numeric(15, 2),
	"abertura_propostas" timestamp with time zone,
	"encerramento_propostas" timestamp with time zone,
	"situacao_id" integer NOT NULL,
	"situacao_nome" text NOT NULL,
	"ano" integer NOT NULL,
	"sequencial" integer NOT NULL,
	"numero_compra" text,
	"processo" text,
	"link_pncp" text NOT NULL,
	"link_sistema_origem" text,
	"texto_busca" text NOT NULL,
	"raw" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "licitacoes_numero_controle_unique" UNIQUE("numero_controle")
);
--> statement-breakpoint
CREATE TABLE "licitacoes_salvas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"licitacao_id" uuid NOT NULL,
	"empresa_id" uuid,
	"status" "status_licitacao_salva" DEFAULT 'interesse' NOT NULL,
	"nota" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "licitacoes_salvas_licitacao_id_unique" UNIQUE("licitacao_id")
);
--> statement-breakpoint
CREATE TABLE "licitacoes_sync" (
	"uf" text PRIMARY KEY NOT NULL,
	"proxima_pagina" integer DEFAULT 1 NOT NULL,
	"total_paginas" integer,
	"iniciado_em" timestamp with time zone,
	"finalizado_em" timestamp with time zone,
	"concluido_em" timestamp with time zone,
	"erro" text
);
--> statement-breakpoint
ALTER TABLE "buscas_licitacao" ADD CONSTRAINT "buscas_licitacao_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "licitacoes_salvas" ADD CONSTRAINT "licitacoes_salvas_licitacao_id_licitacoes_id_fk" FOREIGN KEY ("licitacao_id") REFERENCES "public"."licitacoes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "licitacoes_salvas" ADD CONSTRAINT "licitacoes_salvas_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Escrito à mão: RLS sem políticas e sem grants para anon/authenticated (o app conecta como postgres), igual às demais tabelas.
ALTER TABLE "licitacoes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "licitacoes_salvas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "buscas_licitacao" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "licitacoes_sync" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "licitacoes", "licitacoes_salvas", "buscas_licitacao", "licitacoes_sync" FROM anon, authenticated;
