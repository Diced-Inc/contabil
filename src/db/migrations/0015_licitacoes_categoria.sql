ALTER TABLE "licitacoes" ADD COLUMN "categoria" text;--> statement-breakpoint
ALTER TABLE "licitacoes" ADD COLUMN "classificado_em" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "licitacoes_categoria_encerramento_idx" ON "licitacoes" USING btree ("categoria","encerramento_propostas");