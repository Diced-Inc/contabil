-- partidas: conta analítica e da mesma empresa do lançamento
CREATE OR REPLACE FUNCTION check_partida_conta() RETURNS trigger AS $$
DECLARE t tipo_conta; e_conta uuid; e_lanc uuid;
BEGIN
  SELECT tipo, empresa_id INTO t, e_conta FROM plano_contas WHERE id = NEW.conta_id;
  SELECT empresa_id INTO e_lanc FROM lancamentos WHERE id = NEW.lancamento_id;
  IF t IS DISTINCT FROM 'analitica' THEN RAISE EXCEPTION 'Conta % não é analítica', NEW.conta_id; END IF;
  IF e_conta <> e_lanc THEN RAISE EXCEPTION 'Conta pertence a outra empresa'; END IF;
  IF NEW.debito < 0 OR NEW.credito < 0 OR (NEW.debito > 0) = (NEW.credito > 0) THEN
    RAISE EXCEPTION 'Partida precisa ter débito OU crédito positivo';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER partida_conta BEFORE INSERT OR UPDATE ON partidas
  FOR EACH ROW EXECUTE FUNCTION check_partida_conta();--> statement-breakpoint

-- partidas: lançamento balanceado (deferred, avaliado no commit)
CREATE OR REPLACE FUNCTION check_lancamento_balanceado() RETURNS trigger AS $$
DECLARE lid uuid; d numeric; c numeric; n int;
BEGIN
  lid := COALESCE(NEW.lancamento_id, OLD.lancamento_id);
  SELECT coalesce(sum(debito),0), coalesce(sum(credito),0), count(*) INTO d, c, n FROM partidas WHERE lancamento_id = lid;
  IF n = 0 THEN RETURN NULL; END IF; -- lançamento apagado em cascade
  IF n < 2 OR d <> c THEN
    RAISE EXCEPTION 'Lançamento % desbalanceado: D=% C=% (% partidas)', lid, d, c, n;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER lancamento_balanceado AFTER INSERT OR UPDATE OR DELETE ON partidas
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_lancamento_balanceado();--> statement-breakpoint

-- período fechado
CREATE OR REPLACE FUNCTION periodo_fechado(e uuid, d date) RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM fechamentos WHERE empresa_id = e AND competencia = date_trunc('month', d)::date);
$$ LANGUAGE sql STABLE;--> statement-breakpoint

CREATE OR REPLACE FUNCTION check_lancamento_periodo() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF periodo_fechado(OLD.empresa_id, OLD.data) THEN RAISE EXCEPTION 'Período %/% está fechado', to_char(OLD.data,'MM'), to_char(OLD.data,'YYYY'); END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF periodo_fechado(NEW.empresa_id, NEW.data) THEN RAISE EXCEPTION 'Período %/% está fechado', to_char(NEW.data,'MM'), to_char(NEW.data,'YYYY'); END IF;
    RETURN NEW;
  END IF;
  -- UPDATE: só bloqueia se mudar conteúdo (status/estorno_de podem mudar)
  IF (NEW.data, NEW.competencia, NEW.historico, NEW.documento, NEW.data_pagamento)
     IS DISTINCT FROM (OLD.data, OLD.competencia, OLD.historico, OLD.documento, OLD.data_pagamento) THEN
    IF periodo_fechado(OLD.empresa_id, OLD.data) OR periodo_fechado(NEW.empresa_id, NEW.data) THEN
      RAISE EXCEPTION 'Período fechado';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER lancamento_periodo BEFORE INSERT OR UPDATE OR DELETE ON lancamentos
  FOR EACH ROW EXECUTE FUNCTION check_lancamento_periodo();--> statement-breakpoint

CREATE OR REPLACE FUNCTION check_partida_periodo() RETURNS trigger AS $$
DECLARE l lancamentos%ROWTYPE;
BEGIN
  SELECT * INTO l FROM lancamentos WHERE id = COALESCE(NEW.lancamento_id, OLD.lancamento_id);
  IF l.id IS NOT NULL AND periodo_fechado(l.empresa_id, l.data) THEN RAISE EXCEPTION 'Período fechado'; END IF;
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER partida_periodo BEFORE INSERT OR UPDATE OR DELETE ON partidas
  FOR EACH ROW EXECUTE FUNCTION check_partida_periodo();--> statement-breakpoint

CREATE INDEX partidas_conta_idx ON partidas (conta_id);--> statement-breakpoint
CREATE INDEX partidas_lanc_idx ON partidas (lancamento_id);--> statement-breakpoint
CREATE INDEX lancamentos_empresa_data_idx ON lancamentos (empresa_id, data);--> statement-breakpoint
CREATE INDEX transacoes_status_idx ON transacoes_bancarias (conta_bancaria_id, status);
