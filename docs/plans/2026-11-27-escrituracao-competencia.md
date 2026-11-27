# Escrituração por competência (feedback do Bruno, 27/11/2026)

Objetivo: o DB Contador deixa de ser só conciliação e vira escrituração integrada:
documentos → reconhecimento → contas a pagar/receber → conciliação → balancete → validações → Balanço/DRE.

## Diagnóstico (prod, 27/11)

Não é bug de cálculo: é fluxo. O código já tem títulos com reconhecimento (`src/lib/titulos.ts:27`), baixa pela
conciliação (`src/lib/conciliacao.ts:93`), lançamento manual com N partidas (`form-lancamento.tsx`, `src/lib/lancamentos.ts:59`),
estorno e pareamento de transferências — mas **nada disso foi usado**: 0 títulos e 0 lançamentos manuais em todas as
empresas. Tudo foi classificado direto do extrato, usando Clientes/Fornecedores como atalho de receita/despesa.

TAVAPPS (340 lançamentos, todos de conciliação, nenhum mês fechado):

| Conta | Saldo (D − C) | Causa |
|---|---|---|
| 1.1.2.01 Clientes (D) | −1.680.390,47 | 50 recebimentos creditados sem título prévio |
| 2.1.1.01 Fornecedores (C) | +720.454,85 | 134 pagamentos debitados sem provisão |
| 1.1.5 Transferências (criada à mão) | −414.989,89 | 39 PIX da própria TAVAPPS; a outra conta bancária não está cadastrada → sem par |
| 1.1.4.06 Adiantamentos a sócios | +1.383.015,06 | 49 PIX ao sócio nunca baixados (distribuição? adiantamento?) |
| Ativo total | credor −713.506,43 | e a checagem "Balanço fecha" passa |

Mesmo padrão em Iago, Moodlr e Diced. Moodlr/Diced também sem saldo inicial (banco negativo).
Moodlr: 8 reclassificações de 20/10 com estorno em outubro e novo em setembro (setembro conta em dobro) — provável código
antigo, antes de `dataNoMesAberto`.

Lacunas do código: transferência sem papel próprio no plano; títulos só aceitam conta 3.1/3.2 e creditam Fornecedores
(nunca Impostos a recolher); um título por transação, sem baixa parcial; sem saldos iniciais; checagem trata natureza
invertida só como alerta; texto "estorno com a data de hoje" não bate com o código; `cancelarTitulo` usa `hoje()`;
`editarLancamento` edita manual no lugar (contra a regra do projeto); relatórios usam só `data`, ignoram `competencia`.

Restrições do banco (`0001_triggers.sql`): partida só em analítica da empresa, D xor C, lançamento balanceado (deferido,
≥2 partidas), período fechado por `data`. Regra firme: **nunca editar lançamento no lugar — estorno + novo**.

## Fases

### Fase 1 — Travar a classificação errada + validações (itens 4, 8 parcial, 9)
- `papel_conta` ganha `transferencias`; seed com contas que faltam (Transferências entre contas; PIS/COFINS/IRPJ/CSLL a
  recolher; Parcelamentos CP/LP; Adiantamentos a sócios; Lucros distribuídos; Impostos e taxas) + patch idempotente nas
  empresas existentes (não duplica conta criada à mão: casa por nome/código).
- Classificar direto em conta de papel Clientes/Fornecedores/Impostos sem título → aviso com atalho "reconhecer e baixar"
  (fase 2) ou "cadastrar título".
- IA: proibir Clientes/Fornecedores sem título; filtrar exemplos aprovados que usam essas contas.
- Datas: corrigir o texto "data de hoje"; `cancelarTitulo` e estorno manual usam `dataNoMesAberto`.
- Checagem (item 9) como ERRO ou ALERTA: Ativo total credor; Clientes credor; Fornecedores devedor; Aplicações credor;
  transitória de transferências ≠ 0 (com lista das sem par); sem Capital social; adiantamento a sócio em aberto;
  natureza incompatível por grupo; saldo contábil × saldo do banco (OFX); balanço "provisório" antes da apuração.
- Tela "Transferências sem par" (filtro da conciliação + saldo da transitória).

### Fase 2 — Operações na conciliação (itens 1, 2, 5)
- Seletor de operação no painel: receita direta, despesa direta, baixa a receber, baixa a pagar, baixa de imposto,
  transferência própria, adiantamento a sócio, distribuição de lucros, empréstimo, estorno, a identificar.
  Cada operação mapeia para contas de papel; "receita/despesa direta" gera reconhecimento + baixa na competência escolhida.
- Ao escolher conta de direito/obrigação: títulos em aberto sugeridos por valor/data/contraparte; aviso se não houver.
- Tabela `baixas` (N títulos ↔ 1 transação, baixa parcial).
- Prévia D/C do lançamento antes de aprovar.

### Fase 3 — Documentos antes do banco (itens 1, 2, 3)
- Títulos para qualquer conta de resultado/passivo (sai a trava 3.1/3.2); `titulos.origem` (nf, guia, manual),
  `guia_id`, `chave_nfe` única (sem duplicar).
- Guia DAS/DARF do portal → título "imposto a recolher" na competência (D despesa/dedução, C imposto a recolher);
  o pagamento só baixa.
- Parcelamento: título-mãe + parcelas (principal, juros, multa), reclassificação LP → CP.
- Importação de NF (formato a decidir).

### Fase 4 — Abertura e lançamentos manuais (itens 6, 7)
- `origem_lancamento` += `abertura`: wizard e importação CSV do balancete do último dia antes do início; confere D = C e
  saldo dos bancos × OFX.
- Modelos de lançamento manual (depreciação, pró-labore, provisão, distribuição, compensação de adiantamento,
  constituição de parcelamento).

### Fase 5 — Correção do legado (itens 8, 10)
- Reclassificação em lote com filtro, prévia dos efeitos, uma transação do banco por item, `lote_id` no log,
  `substitui_id` no novo lançamento, motivo no log, idempotência (não reclassifica duas vezes).
- Sempre estorno + novo no mês original (mês aberto); mês fechado exige reabrir em sequência; exercício apurado exige
  reverter a apuração.
- Moodlr: lançamentos compensatórios dos 8 pares de setembro/outubro.

## Decisões pendentes (Bruno/Marcelo)
1. Importação de NF: XML NF-e, NFS-e (portal/padrão nacional) ou só cadastro manual na 1ª versão.
2. Guia do portal vira título de imposto automaticamente? No upload ou no envio ao cliente?
3. DRE/balancete por `competencia` em vez de `data`? (muda a regra de período fechado)
4. Lançamento manual: manter edição no lugar ou só estorno + novo?
5. Natureza econômica (só o Bruno): OURIBANK (venda × repasse), R$ 1,38M ao sócio (distribuição × adiantamento),
   boletos de bancos (cartão × empréstimo × fornecedor), PIX a pessoas físicas (folha × autônomo).
6. TAVAPPS: cadastrar a outra conta bancária e importar o extrato para zerar a transitória.
