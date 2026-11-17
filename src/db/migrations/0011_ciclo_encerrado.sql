ALTER TYPE "public"."status_ciclo" ADD VALUE 'encerrado';--> statement-breakpoint
ALTER TABLE "ciclos_mensais" ADD COLUMN "encerrado_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ciclos_mensais" ADD COLUMN "encerrado_motivo" text;--> statement-breakpoint
ALTER TABLE "ciclos_mensais" ADD COLUMN "encerrado_obs" text;--> statement-breakpoint
ALTER TABLE "ciclos_mensais" ADD COLUMN "cliente_obs" text;