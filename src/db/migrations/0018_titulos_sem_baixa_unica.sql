ALTER TABLE "titulos" DROP CONSTRAINT "titulos_baixa_lancamento_id_lancamentos_id_fk";
--> statement-breakpoint
ALTER TABLE "titulos" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "titulos" ALTER COLUMN "status" SET DEFAULT 'aberto'::text;--> statement-breakpoint
UPDATE "titulos" SET "status" = 'quitado' WHERE "status" = 'baixado';--> statement-breakpoint
DROP TYPE "public"."status_titulo";--> statement-breakpoint
CREATE TYPE "public"."status_titulo" AS ENUM('aberto', 'parcial', 'quitado', 'cancelado');--> statement-breakpoint
ALTER TABLE "titulos" ALTER COLUMN "status" SET DEFAULT 'aberto'::"public"."status_titulo";--> statement-breakpoint
ALTER TABLE "titulos" ALTER COLUMN "status" SET DATA TYPE "public"."status_titulo" USING "status"::"public"."status_titulo";--> statement-breakpoint
ALTER TABLE "titulos" DROP COLUMN "baixa_lancamento_id";