CREATE TYPE "public"."papel_membro" AS ENUM('cliente');--> statement-breakpoint
CREATE TABLE "contadores" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contadores_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "membros" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"user_id" uuid,
	"email" text NOT NULL,
	"papel" "papel_membro" DEFAULT 'cliente' NOT NULL,
	"nome" text,
	"convidado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"aceito_em" timestamp with time zone,
	CONSTRAINT "membros_empresa_id_email_unique" UNIQUE("empresa_id","email")
);
--> statement-breakpoint
ALTER TABLE "membros" ADD CONSTRAINT "membros_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Escrito à mão: FKs para auth.users, índice, RLS, funções de autorização e seed dos contadores.
ALTER TABLE "contadores" ADD CONSTRAINT "contadores_user_id_auth_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "membros" ADD CONSTRAINT "membros_user_id_auth_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "membros" ADD CONSTRAINT "membros_email_minusculo" CHECK ("email" = lower("email"));--> statement-breakpoint
CREATE INDEX "membros_user_id_idx" ON "membros" ("user_id");--> statement-breakpoint
ALTER TABLE "contadores" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "membros" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "contadores", "membros" FROM anon, authenticated;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.eh_contador() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.contadores WHERE user_id = (SELECT auth.uid()));
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.pode_acessar_empresa(e uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.eh_contador()
      OR EXISTS (SELECT 1 FROM public.membros WHERE empresa_id = e AND user_id = (SELECT auth.uid()));
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.eh_contador(), public.pode_acessar_empresa(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.eh_contador(), public.pode_acessar_empresa(uuid) TO authenticated;--> statement-breakpoint
INSERT INTO "contadores" ("user_id", "email")
  SELECT id, lower(email) FROM auth.users
  WHERE lower(email) IN ('marcelobarreiradev@outlook.com', 'contatodavidbruno@gmail.com')
  ON CONFLICT DO NOTHING;
