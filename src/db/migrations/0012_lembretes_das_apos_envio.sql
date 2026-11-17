ALTER TABLE "empresas" ALTER COLUMN "dias_antes_vencimento_das" SET DEFAULT '{3}';--> statement-breakpoint
ALTER TABLE "empresas" ADD COLUMN "lembretes_das_apos_envio" integer[] DEFAULT '{3}' NOT NULL;--> statement-breakpoint
-- Regra nova do DAS (3 e-mails: guia, 3 dias depois do envio, 3 dias antes do vencimento) vale para todas as empresas.
UPDATE "empresas" SET "dias_antes_vencimento_das" = '{3}', "lembretes_das_apos_envio" = '{3}';
