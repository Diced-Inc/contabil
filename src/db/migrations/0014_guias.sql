CREATE TYPE "public"."tipo_guia" AS ENUM('das', 'das_mei', 'darf_previdenciario', 'darf_impostos', 'outra');--> statement-breakpoint
CREATE TABLE "guias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ciclo_id" uuid NOT NULL,
	"empresa_id" uuid NOT NULL,
	"tipo" "tipo_guia" NOT NULL,
	"descricao" text,
	"valor" numeric(15, 2) NOT NULL,
	"vencimento" date NOT NULL,
	"path" text NOT NULL,
	"codigo_receita" text,
	"enviado_em" timestamp with time zone,
	"pago_em" timestamp with time zone,
	"pago_por" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guias_path_unique" UNIQUE("path")
);
--> statement-breakpoint
ALTER TABLE "empresas" ADD COLUMN "tem_pro_labore" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "guias" ADD CONSTRAINT "guias_ciclo_id_ciclos_mensais_id_fk" FOREIGN KEY ("ciclo_id") REFERENCES "public"."ciclos_mensais"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guias" ADD CONSTRAINT "guias_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Escrito à mão: RLS sem políticas (o app conecta como postgres), igual às demais tabelas.
ALTER TABLE "guias" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "guias" FROM anon, authenticated;--> statement-breakpoint
-- Dados: a guia única de cada mês (das_*) vira uma linha em guias. Tipo pelo regime; enviada só se o mês estava enviado/pago/encerrado
-- (mês reaberto volta a guia a rascunho, como no fluxo novo). As colunas das_* ficam até uma limpeza futura.
INSERT INTO "guias" ("ciclo_id", "empresa_id", "tipo", "valor", "vencimento", "path", "enviado_em", "pago_em", "pago_por", "created_at")
SELECT c."id", c."empresa_id",
  (CASE e."regime_tributario" WHEN 'mei' THEN 'das_mei' WHEN 'presumido' THEN 'darf_impostos' WHEN 'real' THEN 'darf_impostos' ELSE 'das' END)::"tipo_guia",
  c."das_valor", c."das_vencimento", c."das_path",
  CASE WHEN c."status" IN ('das_enviado', 'das_pago', 'encerrado') THEN coalesce(c."das_enviado_em", c."concluido_em", c."created_at") END,
  c."das_pago_em", c."das_pago_por", coalesce(c."das_enviado_em", c."created_at")
FROM "ciclos_mensais" c JOIN "empresas" e ON e."id" = c."empresa_id"
WHERE c."das_path" IS NOT NULL AND c."das_valor" IS NOT NULL AND c."das_vencimento" IS NOT NULL
ON CONFLICT ("path") DO NOTHING;
