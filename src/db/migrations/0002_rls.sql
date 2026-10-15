-- RLS sem políticas: bloqueia anon/authenticated via PostgREST. O app conecta como postgres (bypassa RLS).
ALTER TABLE "empresas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "plano_contas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contas_bancarias" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "importacoes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lancamentos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "partidas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transacoes_bancarias" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "regras" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "titulos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fechamentos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "apuracoes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lancamento_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
