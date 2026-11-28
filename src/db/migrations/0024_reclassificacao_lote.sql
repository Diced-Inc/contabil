-- Fase 5 (reclassificação em lote): colunas novas, todas anuláveis. Os DEFAULTs leem configurações locais da transação
-- (set_config(..., true), ver contextoLog em src/lib/lancamentos.ts): o lote carimba lote_id/motivo em todo log que os
-- helpers aninhados gravam e substitui_id nos lançamentos novos, sem passar parâmetro por toda a cadeia. Fora do lote o
-- setting não existe e tudo fica NULL (linhas antigas incluídas).
ALTER TABLE "lancamento_log" ADD COLUMN "lote_id" uuid DEFAULT nullif(current_setting('app.lote_id', true), '')::uuid;--> statement-breakpoint
ALTER TABLE "lancamento_log" ADD COLUMN "motivo" text DEFAULT nullif(current_setting('app.motivo', true), '');--> statement-breakpoint
ALTER TABLE "lancamentos" ADD COLUMN "substitui_id" uuid DEFAULT nullif(current_setting('app.substitui_id', true), '')::uuid;--> statement-breakpoint
ALTER TABLE "lancamentos" ADD CONSTRAINT "lancamentos_substitui_id_lancamentos_id_fk" FOREIGN KEY ("substitui_id") REFERENCES "public"."lancamentos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lancamento_log_lote_idx" ON "lancamento_log" USING btree ("lote_id") WHERE "lancamento_log"."lote_id" is not null;--> statement-breakpoint
CREATE INDEX "lancamentos_substitui_idx" ON "lancamentos" USING btree ("substitui_id");