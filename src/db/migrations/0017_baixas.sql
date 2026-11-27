ALTER TYPE "public"."status_titulo" ADD VALUE 'parcial';--> statement-breakpoint
ALTER TYPE "public"."status_titulo" ADD VALUE 'quitado';--> statement-breakpoint
CREATE TABLE "baixas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"titulo_id" uuid NOT NULL,
	"transacao_id" uuid NOT NULL,
	"lancamento_id" uuid NOT NULL,
	"valor" numeric(15, 2) NOT NULL,
	"juros" numeric(15, 2) DEFAULT '0' NOT NULL,
	"desconto" numeric(15, 2) DEFAULT '0' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transacoes_bancarias" ADD COLUMN "sugestao_operacao" text;--> statement-breakpoint
ALTER TABLE "baixas" ADD CONSTRAINT "baixas_titulo_id_titulos_id_fk" FOREIGN KEY ("titulo_id") REFERENCES "public"."titulos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baixas" ADD CONSTRAINT "baixas_transacao_id_transacoes_bancarias_id_fk" FOREIGN KEY ("transacao_id") REFERENCES "public"."transacoes_bancarias"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baixas" ADD CONSTRAINT "baixas_lancamento_id_lancamentos_id_fk" FOREIGN KEY ("lancamento_id") REFERENCES "public"."lancamentos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "baixas_titulo_idx" ON "baixas" USING btree ("titulo_id");--> statement-breakpoint
CREATE INDEX "baixas_lancamento_idx" ON "baixas" USING btree ("lancamento_id");--> statement-breakpoint
-- RLS sem políticas, como as demais tabelas (o app conecta como postgres).
ALTER TABLE "baixas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "baixas" FROM anon, authenticated;--> statement-breakpoint
-- Baixa única antiga (titulos.baixa_lancamento_id) vira linha de baixas; a coluna sai na 0018.
INSERT INTO "baixas" ("titulo_id", "transacao_id", "lancamento_id", "valor")
SELECT t.id, tb.id, t.baixa_lancamento_id, t.valor
FROM "titulos" t
JOIN LATERAL (SELECT x.id FROM "transacoes_bancarias" x WHERE x.lancamento_id = t.baixa_lancamento_id ORDER BY x.id LIMIT 1) tb ON true
WHERE t.baixa_lancamento_id IS NOT NULL;
