CREATE TYPE "public"."origem_titulo" AS ENUM('manual', 'nfe', 'nfse', 'guia', 'parcelamento');--> statement-breakpoint
CREATE TABLE "parcelamento_lancamentos" (
	"parcelamento_id" uuid NOT NULL,
	"lancamento_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	CONSTRAINT "parcelamento_lancamentos_lancamento_id_unique" UNIQUE("lancamento_id")
);
--> statement-breakpoint
CREATE TABLE "parcelamentos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"descricao" text NOT NULL,
	"principal" numeric(15, 2) NOT NULL,
	"multa" numeric(15, 2) DEFAULT '0' NOT NULL,
	"juros" numeric(15, 2) DEFAULT '0' NOT NULL,
	"n_parcelas" integer NOT NULL,
	"valor_parcela" numeric(15, 2) NOT NULL,
	"primeiro_vencimento" date NOT NULL,
	"data" date NOT NULL,
	"conta_cp_id" uuid NOT NULL,
	"conta_lp_id" uuid NOT NULL,
	"status" text DEFAULT 'ativo' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "titulos" ADD COLUMN "origem" "origem_titulo" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "titulos" ADD COLUMN "conta_id" uuid;--> statement-breakpoint
ALTER TABLE "titulos" ADD COLUMN "contraparte_documento" text;--> statement-breakpoint
ALTER TABLE "titulos" ADD COLUMN "documento_chave" text;--> statement-breakpoint
ALTER TABLE "titulos" ADD COLUMN "parcela" integer;--> statement-breakpoint
ALTER TABLE "titulos" ADD COLUMN "guia_id" uuid;--> statement-breakpoint
ALTER TABLE "titulos" ADD COLUMN "parcelamento_id" uuid;--> statement-breakpoint
ALTER TABLE "parcelamento_lancamentos" ADD CONSTRAINT "parcelamento_lancamentos_parcelamento_id_parcelamentos_id_fk" FOREIGN KEY ("parcelamento_id") REFERENCES "public"."parcelamentos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parcelamento_lancamentos" ADD CONSTRAINT "parcelamento_lancamentos_lancamento_id_lancamentos_id_fk" FOREIGN KEY ("lancamento_id") REFERENCES "public"."lancamentos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parcelamentos" ADD CONSTRAINT "parcelamentos_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parcelamentos" ADD CONSTRAINT "parcelamentos_conta_cp_id_plano_contas_id_fk" FOREIGN KEY ("conta_cp_id") REFERENCES "public"."plano_contas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parcelamentos" ADD CONSTRAINT "parcelamentos_conta_lp_id_plano_contas_id_fk" FOREIGN KEY ("conta_lp_id") REFERENCES "public"."plano_contas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "parcelamento_lancamentos_parc_idx" ON "parcelamento_lancamentos" USING btree ("parcelamento_id");--> statement-breakpoint
ALTER TABLE "titulos" ADD CONSTRAINT "titulos_conta_id_plano_contas_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."plano_contas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "titulos" ADD CONSTRAINT "titulos_guia_id_guias_id_fk" FOREIGN KEY ("guia_id") REFERENCES "public"."guias"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "titulos" ADD CONSTRAINT "titulos_parcelamento_id_parcelamentos_id_fk" FOREIGN KEY ("parcelamento_id") REFERENCES "public"."parcelamentos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "titulos_guia_uq" ON "titulos" USING btree ("guia_id");--> statement-breakpoint
CREATE UNIQUE INDEX "titulos_documento_chave_uq" ON "titulos" USING btree ("empresa_id","documento_chave",coalesce("parcela", 0)) WHERE "titulos"."documento_chave" is not null and "titulos"."status" <> 'cancelado';--> statement-breakpoint
-- RLS sem políticas, como as demais tabelas (o app conecta como postgres).
ALTER TABLE "parcelamentos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "parcelamentos" FROM anon, authenticated;--> statement-breakpoint
ALTER TABLE "parcelamento_lancamentos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "parcelamento_lancamentos" FROM anon, authenticated;
