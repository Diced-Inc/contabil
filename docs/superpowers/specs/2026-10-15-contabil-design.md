# Contabil — Design v1

Sistema contábil web para **um contador** que cuida de **várias empresas**. Fluxo: importar extrato OFX → classificar (regras + IA) → contador revisa → lançamentos → fechamento → relatórios (Balanço, DRE, Balancete, Diário, Razão).

Referências: modelo colado pelo Marcelo (regras de classificação e controles), PDF "PLANO DE CONTAS SIMPLIFICADO (Resolução CFC 1.418/2012, ITG 1000)" e prints da Contabilizei (layout dos relatórios).

## 1. Stack

- Next.js 16 (App Router, TypeScript, Server Actions), Tailwind v4, shadcn/ui, lucide-react. **Sem emoji na UI.**
- Postgres no Supabase. Acesso via **Drizzle ORM + postgres-js**. Migrations com drizzle-kit.
- Auth: Supabase Auth (e-mail + senha) via `@supabase/ssr`. Usuário único, sem papéis. Proxy/middleware bloqueia tudo exceto `/login`.
- IA: `@anthropic-ai/sdk`, modelo em `IA_MODEL` (default `claude-sonnet-5-5`), saída estruturada via tool use.
- Testes: Vitest, só funções puras (parser OFX, matcher de regras, montagem de relatórios).
- Deploy: Vercel. PDF dos relatórios = CSS `@media print` + `window.print()`. Sem lib de PDF.
- Package manager: pnpm. Node 24.

Env: `DATABASE_URL` (pooler transaction 6543, `prepare: false`), `DIRECT_URL` (5432, para migrate), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `ANTHROPIC_API_KEY`, `IA_MODEL`. Marcelo cria o projeto Supabase e fornece as chaves.

## 2. Modelo de dados

Todas as tabelas de domínio têm `empresa_id` (direto ou via FK) para isolar empresas. Valores monetários `numeric(15,2)`. IDs `uuid`.

### empresas
`id, razao_social, cnpj (14 dígitos, unique), regime_tributario enum(simples|presumido|real) default simples, created_at`. Exercício = ano civil.

### plano_contas
`id, empresa_id, codigo text, nome, natureza enum(D|C), tipo enum(sintetica|analitica), parent_id, grupo_dre enum nullable, papel enum nullable, ativa bool, unique(empresa_id, codigo)`.

- Classe pelo primeiro dígito: `1` Ativo, `2` Passivo e PL (`2.3` = PL), `3` Resultado.
- `grupo_dre` obrigatório em analíticas da classe 3: `receita_bruta | deducoes | custos | despesas_operacionais | receitas_financeiras | despesas_financeiras | outras_receitas | outras_despesas | tributos_lucro`.
- `papel` marca contas especiais que o sistema precisa achar: `lucros_acumulados | prejuizos_acumulados | clientes | fornecedores`. Única por empresa.
- Só **analítica** recebe partida (trigger). Sintéticas somam as filhas por prefixo de código.
- Ao criar empresa, seed do plano ITG 1000 (PDF) com naturezas, `grupo_dre` e `papel` preenchidos. Contador edita depois (criar, renomear, inativar; não exclui conta com partida).

### contas_bancarias
`id, empresa_id, nome, banco, agencia, numero, ofx_bankid, ofx_acctid, conta_contabil_id → plano_contas (analítica, classe 1), ativa, unique(empresa_id, ofx_bankid, ofx_acctid)`.

### importacoes
`id, conta_bancaria_id, nome_arquivo, periodo_inicio, periodo_fim, saldo_final, data_saldo, qtd_transacoes, qtd_novas, created_at`. `saldo_final` é o LEDGERBAL do OFX, usado na conferência saldo contábil × extrato.

### transacoes_bancarias
`id, conta_bancaria_id, importacao_id, fitid, data, valor (positivo entrada, negativo saída), memo, tipo_ofx, status enum(pendente|classificada|transferencia|ignorada), lancamento_id nullable, sugestao_conta_id nullable, sugestao_confianca numeric(3,2), sugestao_origem enum(regra|ia|transferencia) nullable, sugestao_regra_id, sugestao_historico, sugestao_justificativa, transferencia_par_id (self), created_at, unique(conta_bancaria_id, fitid)`.

Reimportar o mesmo arquivo ou período sobreposto não duplica: FITID já existente é pulado e contado em `qtd_transacoes - qtd_novas`.

### lancamentos
`id, empresa_id, data (fato), competencia date (dia 1 do mês), data_pagamento nullable, historico, documento nullable, origem enum(manual|conciliacao|apuracao|estorno), status enum(aprovado|estornado), estorno_de_id (self), created_by, created_at, updated_at`.

Sugestão pendente vive na transação; o lançamento só nasce na aprovação. Logo não existe lançamento "pendente".

### partidas
`id, lancamento_id (cascade), conta_id, debito numeric default 0, credito numeric default 0, ordem int`.
- Check: `debito >= 0 AND credito >= 0 AND (debito > 0) <> (credito > 0)`.
- **Constraint trigger deferred** (after insert/update/delete): para cada lançamento tocado, `sum(debito) = sum(credito)` e `count >= 2`, senão `RAISE`. Impossível gravar lançamento desbalanceado.
- Trigger: conta deve ser analítica e da mesma empresa do lançamento.

### regras
`id, empresa_id, nome, tipo_match enum(memo_contem|documento|valor_exato), padrao, sinal enum(entrada|saida|qualquer), conta_id, historico_template, prioridade int, ativa, created_at`.
- `memo_contem`: `memo ILIKE '%padrao%'`.
- `documento`: CPF/CNPJ (só dígitos) presente nos dígitos do memo.
- `valor_exato`: `abs(valor) = padrao`.
- `historico_template` aceita `{memo}`, `{valor}`, `{data}`.
- Primeira regra que casa (ordem `prioridade asc, created_at asc`) vence, confiança 1.0.

### titulos (contas a receber/pagar)
`id, empresa_id, tipo enum(receber|pagar), contraparte, documento, descricao, valor, competencia, vencimento, lancamento_id (lançamento de competência), status enum(aberto|baixado|cancelado), baixa_lancamento_id, created_at`.

Criar título gera o lançamento de competência: receber = D Clientes (papel) / C conta de receita escolhida; pagar = D conta de despesa / C Fornecedores (papel). Baixa acontece na conciliação (seção 3).

### fechamentos
`id, empresa_id, competencia date (mês), fechado_em, fechado_por, unique(empresa_id, competencia)`. Trigger em `lancamentos` bloqueia insert/delete e update de `data/competencia/historico/documento/data_pagamento` quando `data` cai em mês fechado (mudar `status` para `estornado` é permitido, porque o estorno em si vai em mês aberto). Trigger em `partidas` bloqueia qualquer mudança de partida de lançamento em mês fechado. Reabrir = apagar a linha (registrado em `lancamento_log` com `lancamento_id` nulo e `acao = reabertura`).

### apuracoes
`id, empresa_id, exercicio int, lancamento_id, created_at, unique(empresa_id, exercicio)`. Ver seção 4.

### lancamento_log
`id, lancamento_id nullable, empresa_id, acao enum(criado|alterado|estornado|fechamento|reabertura|apuracao), usuario_id, antes jsonb, depois jsonb, created_at`. Toda escrita em lançamento/partidas passa por uma função de serviço que grava o log na mesma transação.

## 3. Conciliação

### Importação OFX (`lib/ofx.ts`)
- Aceita OFX 1.x (SGML, tags sem fechamento) e 2.x (XML). Lê `CHARSET`/`ENCODING` do header; default `latin1`.
- Extrai `BANKID, ACCTID, DTSTART, DTEND, LEDGERBAL/BALAMT, LEDGERBAL/DTASOF` e cada `STMTTRN`: `TRNTYPE, DTPOSTED, TRNAMT, FITID, NAME, MEMO` (memo = `MEMO` + `NAME` concatenados quando ambos existem). Valores com vírgula decimal são aceitos. Datas `YYYYMMDD[HHMMSS[.mmm]][[-3:BRT]]`.
- Só `BANKMSGSRSV1/STMTRS` na v1. `CCSTMTRS` (cartão) retorna erro claro "cartão de crédito não suportado".
- Upload: usuário escolhe a conta bancária; se `BANKID/ACCTID` do arquivo não baterem com a conta, erro. Transações inseridas em uma transação de banco; FITID repetido é ignorado.
- Após inserir, o mesmo server action roda o pipeline de sugestão nas novas transações.

### Pipeline de sugestão (`lib/classificacao/`)
Ordem por transação pendente sem sugestão:
1. **Regras**: primeira que casa → `sugestao_origem = regra`, confiança 1.0, histórico pelo template.
2. **Transferência**: existe transação pendente em **outra** conta bancária da mesma empresa com `valor = -valor`, `|Δdata| ≤ 2 dias`, ainda sem par → marca as duas com `sugestao_origem = transferencia`, `transferencia_par_id` cruzado, confiança 0.9.
3. **IA**: chamada à Anthropic com tool use forçado (`classificar`: `{conta_codigo, confianca 0..1, historico, justificativa}`). Contexto: plano analítico da empresa (código + nome + natureza), a transação (data, valor, sinal, memo), e até 30 pares `memo → conta_codigo` das conciliações aprovadas mais recentes da empresa (few-shot que melhora com as correções). Concorrência 4. Erro de IA deixa a transação pendente sem sugestão e registra no retorno da ação; nunca falha a importação.
4. Botão "Sugerir com IA" na tela de conciliação reprocessa pendentes sem sugestão.

### Tela de conciliação (`/e/[id]/conciliacao`) — tela principal
Tabela de pendentes: data, conta bancária, memo, valor (verde entrada / vermelho saída), sugestão (conta + badge de origem e confiança), ações. Filtros: conta bancária, período, origem, texto. Seleção múltipla + "Aprovar selecionadas" (só para sugestões de regra ou transferência).

Ação por transação abre um painel com abas:
- **Classificar**: lista de contrapartidas `[{conta, valor}]` cujo total deve ser `|valor|` (permite dividir, ex.: parcela de empréstimo em principal + juros). Histórico, documento, competência (default = mês da data). Checkbox "Criar regra com esta classificação" abre mini-form (tipo, padrão pré-preenchido com o memo, conta). Aprovar gera lançamento `origem = conciliacao`: entrada = D Banco / C contrapartidas; saída = D contrapartidas / C Banco.
- **Baixar título**: lista títulos abertos do tipo compatível (entrada → receber, saída → pagar). Se o valor da transação difere do título, obriga escolher conta da diferença (juros/desconto). Gera lançamento D Banco / C Clientes (ou D Fornecedores / C Banco) + partida da diferença; título vira `baixado`.
- **Transferência**: escolhe a transação par (pré-selecionada quando o pipeline achou). Gera **um** lançamento D Banco destino / C Banco origem ligado às duas transações; ambas viram `transferencia`.
- **Ignorar**: `status = ignorada`, com motivo opcional. Reversível.

Desfazer uma conciliação: estorna o lançamento e devolve a(s) transação(ões) para `pendente`.

### Conferência de saldo
Em `/e/[id]/bancos`, para cada conta: saldo contábil (Σ partidas da conta contábil até a data do último OFX) × `saldo_final` do último OFX, com diferença destacada. Pendentes não entram no contábil, então a diferença esperada = Σ pendentes; a tela mostra isso.

## 4. Lançamentos, fechamento e apuração

### Lançamento manual (`/e/[id]/lancamentos`)
Form com data, competência, data de pagamento, histórico, documento e N partidas (conta analítica, débito **ou** crédito). Rodapé mostra Σ D, Σ C e diferença; botão salvar desabilitado se diferença ≠ 0. Serve para saldo inicial, provisões, depreciação, ajustes.

Edição: permitida enquanto o mês está aberto; grava `antes/depois` no log. Estorno: cria lançamento `origem = estorno` com partidas invertidas na data escolhida (default hoje), marca o original `estornado` com `estorno_de_id` no novo. Lançamento de conciliação estornado devolve a transação para pendente.

### Fechamento (`/e/[id]/fechamento`)
Grade de 12 meses por exercício. Fechar mês: exige mês anterior fechado. Reabrir: exige meses seguintes abertos. Ambos logados.

### Apuração do exercício
Botão "Apurar resultado de YYYY": exige os 12 meses fechados e nenhuma apuração do ano. Cria lançamento `origem = apuracao` em 31/12: para cada analítica da classe 3 com saldo ≠ 0, partida que zera o saldo; contrapartida única em `lucros_acumulados` (crédito, se lucro) ou `prejuizos_acumulados` (débito, se prejuízo). Registra em `apuracoes`. "Reverter apuração" estorna o lançamento e apaga a linha.

Relatórios de um exercício **não apurado** mostram o resultado do período como linha calculada dentro do PL ("Resultado do exercício"), para o balanço fechar sem duplicar.

## 5. Relatórios (`lib/relatorios/`)

Base única: `saldos(empresaId, de, ate)` retorna por conta analítica `saldo_anterior` (Σ partidas com `data < de`), `debitos`, `creditos` no intervalo e `saldo_atual`. Saldo = Σ débito − Σ crédito. Montagem da hierarquia em TypeScript: sintéticas = soma das filhas por prefixo de código. Exibição: `≥ 0` → `1.234,56D`; `< 0` → `1.234,56C`; zero → sufixo pela natureza. **Todos** os lançamentos entram, inclusive os estornados e seus estornos: o efeito líquido é zero e Diário/Razão mostram os dois, como na prática contábil. `status = estornado` é só informativo.

- **Balancete**: intervalo (default mês). Colunas: código, descrição, saldo anterior, débito, crédito, saldo atual. Todas as contas com movimento ou saldo. Totais por classe.
- **Balanço Patrimonial**: exercício. Classes 1 e 2 em 31/12 do ano e do anterior, lado a lado. Linha "Resultado do exercício" no PL quando não apurado. Rodapé: Ativo total, Passivo + PL total, "fecha / não fecha".
- **DRE**: intervalo (default exercício) + coluna do mesmo intervalo do ano anterior. Linhas no formato do Anexo 3 da ITG 1000, agrupadas por `grupo_dre`: Receita bruta, (−) Deduções, = Receita líquida, (−) Custos, = Lucro bruto, (−) Despesas operacionais, = Resultado antes do financeiro, (+/−) Resultado financeiro, (+/−) Outras receitas e despesas, = Resultado antes dos tributos, (−) Tributos sobre o lucro, = Resultado líquido. Dentro de cada grupo, as analíticas com valor.
- **Diário**: intervalo. Lançamentos em ordem de data e número, cada um com partidas (conta, histórico, D, C).
- **Razão**: conta + intervalo. Saldo anterior, cada movimento com contrapartida(s) e saldo corrente, saldo final.

Toda página de relatório tem cabeçalho (empresa, CNPJ, período, emitido em) e botão "Imprimir". Layout de impressão A4 retrato, tabela densa, sem sidebar.

## 6. Páginas

| Rota | Conteúdo |
|---|---|
| `/login` | e-mail + senha |
| `/` | lista de empresas, criar empresa |
| `/e/[id]` | resumo: pendentes, saldo por banco (contábil × OFX), meses fechados do ano |
| `/e/[id]/conciliacao` | fila de pendentes (seção 3) |
| `/e/[id]/bancos` | contas bancárias, importar OFX, histórico de importações, conferência de saldo |
| `/e/[id]/lancamentos` | lista com filtros, novo manual, editar, estornar, log |
| `/e/[id]/titulos` | contas a receber/pagar: criar, cancelar, ver baixa |
| `/e/[id]/plano-de-contas` | árvore, criar/editar/inativar |
| `/e/[id]/regras` | CRUD + "testar contra pendentes" |
| `/e/[id]/fechamento` | grade de meses, apuração |
| `/e/[id]/relatorios/{balancete,balanco,dre,diario,razao}` | seção 5 |
| `/e/[id]/configuracoes` | dados da empresa |

Layout: sidebar com seletor de empresa e navegação; conteúdo com tabelas densas estilo Contabilizei. Valores sempre em `pt-BR` (`1.234,56`).

## 7. Estrutura de código

```
src/
  app/                      rotas (App Router)
  components/ui/            shadcn
  components/               componentes de domínio
  db/schema.ts              Drizzle
  db/index.ts               cliente
  db/migrations/            drizzle-kit + SQL manual dos triggers
  db/seed-plano.ts          plano ITG 1000
  lib/ofx.ts                parser puro
  lib/classificacao/        regras.ts, transferencias.ts, ia.ts, pipeline.ts
  lib/lancamentos.ts        criar/editar/estornar com log, em transação
  lib/relatorios/           saldos.ts, balancete.ts, balanco.ts, dre.ts, diario.ts, razao.ts
  lib/format.ts             moeda, data, D/C
  actions/                  server actions por domínio
  supabase/                 clientes ssr
```

Regras: toda escrita em lançamento passa por `lib/lancamentos.ts` (uma transação: lançamento + partidas + log). Server actions validam com zod, chamam lib, `revalidatePath`. Nenhuma lógica contábil em componente.

## 8. Testes

Vitest, sem banco:
- `ofx.test.ts`: fixtures SGML e XML, latin1, vírgula decimal, FITID, LEDGERBAL, erro em CCSTMTRS.
- `regras.test.ts`: três tipos de match, sinal, prioridade, template de histórico.
- `transferencias.test.ts`: par por valor/data, não pareia na mesma conta, respeita ±2 dias.
- `relatorios.test.ts`: hierarquia a partir de saldos fixos, D/C, DRE por grupo, balanço com resultado não apurado fechando.
- `apuracao.test.ts`: geração das partidas de zeramento a partir de saldos fixos (lucro e prejuízo).

Triggers de balanceamento e de período fechado: verificados manualmente contra o Supabase após a migration (comandos no plano).

## 9. Fora da v1

XML de NF-e/NFS-e, folha de pagamento, cálculo de tributos, acesso do cliente da empresa, OFX de cartão de crédito, múltiplos usuários/papéis, DFC e DMPL.
