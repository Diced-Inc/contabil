CREATE TYPE "public"."status_ciclo" AS ENUM('aguardando_extrato', 'extrato_recebido', 'em_processamento', 'das_enviado', 'das_pago');--> statement-breakpoint
CREATE TYPE "public"."status_notificacao" AS ENUM('enviado', 'erro', 'nao_configurado');--> statement-breakpoint
CREATE TABLE "ciclos_mensais" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"competencia" date NOT NULL,
	"status" "status_ciclo" DEFAULT 'aguardando_extrato' NOT NULL,
	"extrato_solicitado_em" timestamp with time zone,
	"extrato_recebido_em" timestamp with time zone,
	"concluido_em" timestamp with time zone,
	"das_valor" numeric(15, 2),
	"das_vencimento" date,
	"das_path" text,
	"das_enviado_em" timestamp with time zone,
	"das_pago_em" timestamp with time zone,
	"das_pago_por" uuid,
	"observacao" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ciclos_mensais_empresa_id_competencia_unique" UNIQUE("empresa_id","competencia")
);
--> statement-breakpoint
CREATE TABLE "documentos_recebidos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"ciclo_id" uuid NOT NULL,
	"conta_bancaria_id" uuid,
	"nome_arquivo" text NOT NULL,
	"path" text NOT NULL,
	"mime" text NOT NULL,
	"tamanho" integer NOT NULL,
	"observacao" text,
	"enviado_por" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processado_em" timestamp with time zone,
	"importacao_id" uuid,
	CONSTRAINT "documentos_recebidos_path_unique" UNIQUE("path")
);
--> statement-breakpoint
CREATE TABLE "notificacoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"ciclo_id" uuid,
	"tipo" text NOT NULL,
	"para" text NOT NULL,
	"assunto" text NOT NULL,
	"status" "status_notificacao" NOT NULL,
	"resend_id" text,
	"erro" text,
	"data_ref" date DEFAULT (now() at time zone 'America/Sao_Paulo')::date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notificacoes_ciclo_id_tipo_para_data_ref_unique" UNIQUE("ciclo_id","tipo","para","data_ref")
);
--> statement-breakpoint
ALTER TABLE "ciclos_mensais" ADD CONSTRAINT "ciclos_mensais_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documentos_recebidos" ADD CONSTRAINT "documentos_recebidos_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documentos_recebidos" ADD CONSTRAINT "documentos_recebidos_ciclo_id_ciclos_mensais_id_fk" FOREIGN KEY ("ciclo_id") REFERENCES "public"."ciclos_mensais"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documentos_recebidos" ADD CONSTRAINT "documentos_recebidos_conta_bancaria_id_contas_bancarias_id_fk" FOREIGN KEY ("conta_bancaria_id") REFERENCES "public"."contas_bancarias"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documentos_recebidos" ADD CONSTRAINT "documentos_recebidos_importacao_id_importacoes_id_fk" FOREIGN KEY ("importacao_id") REFERENCES "public"."importacoes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notificacoes" ADD CONSTRAINT "notificacoes_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notificacoes" ADD CONSTRAINT "notificacoes_ciclo_id_ciclos_mensais_id_fk" FOREIGN KEY ("ciclo_id") REFERENCES "public"."ciclos_mensais"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Escrito à mão: RLS sem políticas (o app conecta como postgres), igual às demais tabelas.
ALTER TABLE "ciclos_mensais" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "documentos_recebidos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notificacoes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "ciclos_mensais", "documentos_recebidos", "notificacoes" FROM anon, authenticated;
