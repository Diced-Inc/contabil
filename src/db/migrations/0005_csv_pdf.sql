CREATE TABLE "mapeamentos_csv" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conta_bancaria_id" uuid NOT NULL,
	"nome" text,
	"mapeamento" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mapeamentos_csv_conta_bancaria_id_unique" UNIQUE("conta_bancaria_id")
);
--> statement-breakpoint
ALTER TABLE "importacoes" ADD COLUMN "origem" text DEFAULT 'ofx' NOT NULL;--> statement-breakpoint
ALTER TABLE "mapeamentos_csv" ADD CONSTRAINT "mapeamentos_csv_conta_bancaria_id_contas_bancarias_id_fk" FOREIGN KEY ("conta_bancaria_id") REFERENCES "public"."contas_bancarias"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Mesmo padrão de 0002_rls: RLS sem políticas (o app conecta como postgres).
ALTER TABLE "mapeamentos_csv" ENABLE ROW LEVEL SECURITY;
