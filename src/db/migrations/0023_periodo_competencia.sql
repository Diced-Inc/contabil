-- Relatórios por competência (decisão do Bruno): competência é sempre o 1º dia do mês (todas as linhas já são)...
ALTER TABLE "lancamentos" ADD CONSTRAINT "lancamentos_competencia_mes" CHECK (extract(day from competencia) = 1);--> statement-breakpoint

-- ...e o fechamento passa a fechar o mês também por competência. Regra simples e segura: um lançamento é barrado se a
-- DATA ou a COMPETÊNCIA cair em mês fechado (antes só a data). Assim nada muda um relatório fechado (por competência)
-- nem o saldo do banco de um mês fechado (por data). Mensagem diz qual mês está fechado.
-- UPDATE: como antes, só barra mudança de conteúdo (status/estorno_de podem mudar: marcar como estornado continua
-- livre), olhando o mês antigo e o novo das duas datas.
CREATE OR REPLACE FUNCTION mes_fechado_do_lancamento(e uuid, d date, c date) RETURNS date AS $$
  SELECT CASE WHEN periodo_fechado(e, d) THEN date_trunc('month', d)::date WHEN periodo_fechado(e, c) THEN c END;
$$ LANGUAGE sql STABLE SET search_path = public;--> statement-breakpoint

CREATE OR REPLACE FUNCTION check_lancamento_periodo() RETURNS trigger AS $$
DECLARE m date;
BEGIN
  IF TG_OP = 'DELETE' THEN
    m := mes_fechado_do_lancamento(OLD.empresa_id, OLD.data, OLD.competencia);
    IF m IS NOT NULL THEN RAISE EXCEPTION 'Período %/% está fechado', to_char(m,'MM'), to_char(m,'YYYY'); END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    m := mes_fechado_do_lancamento(NEW.empresa_id, NEW.data, NEW.competencia);
    IF m IS NOT NULL THEN RAISE EXCEPTION 'Período %/% está fechado', to_char(m,'MM'), to_char(m,'YYYY'); END IF;
    RETURN NEW;
  END IF;
  IF (NEW.data, NEW.competencia, NEW.historico, NEW.documento, NEW.data_pagamento)
     IS DISTINCT FROM (OLD.data, OLD.competencia, OLD.historico, OLD.documento, OLD.data_pagamento) THEN
    m := coalesce(mes_fechado_do_lancamento(OLD.empresa_id, OLD.data, OLD.competencia),
                  mes_fechado_do_lancamento(NEW.empresa_id, NEW.data, NEW.competencia));
    IF m IS NOT NULL THEN RAISE EXCEPTION 'Período %/% está fechado', to_char(m,'MM'), to_char(m,'YYYY'); END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = public;--> statement-breakpoint

CREATE OR REPLACE FUNCTION check_partida_periodo() RETURNS trigger AS $$
DECLARE l lancamentos%ROWTYPE; m date;
BEGIN
  SELECT * INTO l FROM lancamentos WHERE id = COALESCE(NEW.lancamento_id, OLD.lancamento_id);
  IF l.id IS NOT NULL THEN
    m := mes_fechado_do_lancamento(l.empresa_id, l.data, l.competencia);
    IF m IS NOT NULL THEN RAISE EXCEPTION 'Período %/% está fechado', to_char(m,'MM'), to_char(m,'YYYY'); END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql SET search_path = public;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS lancamentos_empresa_competencia_idx ON lancamentos (empresa_id, competencia);
