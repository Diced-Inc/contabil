ALTER TABLE "empresas" ADD COLUMN "avisos_ativos" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "empresas" ADD COLUMN "dia_pedido_extrato" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "empresas" ADD COLUMN "lembretes_extrato_dias" integer[] DEFAULT '{4,9}' NOT NULL;--> statement-breakpoint
ALTER TABLE "empresas" ADD COLUMN "dias_antes_vencimento_das" integer[] DEFAULT '{3,0}' NOT NULL;