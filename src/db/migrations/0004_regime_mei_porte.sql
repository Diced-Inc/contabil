CREATE TYPE "public"."porte_empresa" AS ENUM('mei', 'me', 'epp', 'demais');--> statement-breakpoint
ALTER TYPE "public"."regime_tributario" ADD VALUE 'mei';--> statement-breakpoint
ALTER TABLE "empresas" ADD COLUMN "porte" "porte_empresa";