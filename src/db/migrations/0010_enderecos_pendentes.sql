CREATE TABLE "enderecos_pendentes" (
	"local" text PRIMARY KEY NOT NULL,
	"destino" text NOT NULL,
	"nome" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Escrito à mão: RLS sem políticas (o app conecta como postgres), igual às demais tabelas.
ALTER TABLE "enderecos_pendentes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- contato@ aguarda o destino confirmar; a tela cria a regra quando confirmar (ou descarta se a regra já existir).
INSERT INTO "enderecos_pendentes" ("local", "destino", "nome") VALUES ('contato', 'contatodavidbruno@gmail.com', 'Contato') ON CONFLICT DO NOTHING;
