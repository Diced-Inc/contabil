CREATE TABLE "adiantamentos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"contraparte" text NOT NULL,
	"contraparte_documento" text,
	"valor" numeric(15, 2) NOT NULL,
	"data" date NOT NULL,
	"conta_id" uuid NOT NULL,
	"lancamento_id" uuid NOT NULL,
	"transacao_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "adiantamentos_lancamento_id_unique" UNIQUE("lancamento_id")
);
--> statement-breakpoint
ALTER TABLE "baixas" ADD COLUMN "adiantamento_id" uuid;--> statement-breakpoint
ALTER TABLE "adiantamentos" ADD CONSTRAINT "adiantamentos_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adiantamentos" ADD CONSTRAINT "adiantamentos_conta_id_plano_contas_id_fk" FOREIGN KEY ("conta_id") REFERENCES "public"."plano_contas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adiantamentos" ADD CONSTRAINT "adiantamentos_lancamento_id_lancamentos_id_fk" FOREIGN KEY ("lancamento_id") REFERENCES "public"."lancamentos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adiantamentos" ADD CONSTRAINT "adiantamentos_transacao_id_transacoes_bancarias_id_fk" FOREIGN KEY ("transacao_id") REFERENCES "public"."transacoes_bancarias"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "adiantamentos_empresa_idx" ON "adiantamentos" USING btree ("empresa_id");--> statement-breakpoint
ALTER TABLE "baixas" ADD CONSTRAINT "baixas_adiantamento_id_adiantamentos_id_fk" FOREIGN KEY ("adiantamento_id") REFERENCES "public"."adiantamentos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- RLS sem políticas, como as demais tabelas (o app conecta como postgres).
ALTER TABLE "adiantamentos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "adiantamentos" FROM anon, authenticated;
