# Contabil

Sistema contábil web para um contador que atende várias empresas. Ele importa extratos OFX, sugere a classificação de cada transação (regras do contador e, quando nenhuma regra casa, IA). O contador revisa e aprova, e o sistema gera os lançamentos em partidas dobradas. Depois disso, fecha os meses, apura o exercício e emite Balanço, DRE, Balancete, Diário e Razão.

## Stack

- Next.js 16 (App Router, Server Actions, `cacheComponents`), React 19, TypeScript
- Tailwind v4, shadcn/ui, lucide-react
- Postgres no Supabase, via Drizzle ORM + postgres-js; migrations com drizzle-kit
- Supabase Auth (`@supabase/ssr`)
- `@anthropic-ai/sdk` para as sugestões de classificação
- zod, Vitest, pnpm, Node 24

## Setup

1. `pnpm i`
2. Copie `.env.example` para `.env` e preencha:
   - `DATABASE_URL` (pooler, porta 6543) e `DIRECT_URL` (porta 5432, usada pelas migrations)
   - `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `ALLOWED_EMAILS`: e-mails autorizados, separados por vírgula. Defina sempre em produção; qualquer outro usuário é deslogado.
   - `ANTHROPIC_API_KEY` (opcional; sem ela só as regras sugerem) e `IA_MODEL`
3. Crie um projeto no Supabase e crie o usuário do contador em **Authentication → Users** (não há tela de cadastro). Em **Authentication → Sign In / Providers**, desligue "Allow new users to sign up".
4. `pnpm db:migrate`
5. `pnpm dev` e entre em http://localhost:3000 com o usuário criado.

Sem as chaves do Supabase, o app roda aberto em desenvolvimento (com um aviso no log). Em produção, responde 503.

Outros comandos: `pnpm test`, `pnpm lint`, `pnpm build`, `pnpm db:generate`, `pnpm db:studio`.

## Fluxo de uso

1. **Empresa**: cadastre a empresa. Ela já nasce com o plano de contas padrão, que pode ser ajustado em Plano de contas.
2. **Bancos e OFX**: cadastre cada conta bancária ligada a uma conta contábil do ativo e importe o OFX. Transações repetidas são ignoradas.
3. **Conciliação**: revise as pendentes com a sugestão de conta. Aprove uma a uma ou em lote, classifique manualmente, case com títulos ou marque transferências entre contas. Regras criadas aqui valem para as próximas importações.
4. **Lançamentos e títulos**: faça lançamentos manuais (ajustes, provisões) e registre contas a receber/pagar. A baixa do título acontece na conciliação.
5. **Fechamento e apuração**: feche os meses em ordem. Com os 12 meses fechados, apure o exercício.
6. **Relatórios**: Balancete, Balanço, DRE (com comparativo do ano anterior), Diário e Razão.

## Decisões

- **Saldo = Débito − Crédito** em todas as contas. A natureza (D/C) só define o sinal na exibição.
- **Estornos e lançamentos originais entram nos relatórios.** Os dois se anulam no saldo, e o Diário mostra ambos.
- **Integridade no banco**: triggers impedem lançamento desbalanceado e qualquer escrita (criar, editar, estornar) em mês fechado. Toda escrita contábil passa por `src/lib/lancamentos.ts`.
- **Apuração zera a classe 3** (resultado) contra Lucros/Prejuízos Acumulados em 31/12. Revertê-la estorna esse lançamento.
- **Transferência entre contas** gera um único lançamento na data da saída.
- Dinheiro é `numeric(15,2)` no banco e `string` no código. As somas em TS são feitas em centavos inteiros.

## Fora da v1

- NF-e (emissão ou importação)
- Folha de pagamento
- Cálculo de tributos e obrigações acessórias
- Cartão de crédito
- Multiusuário (perfis, permissões, vários contadores)

## Recuperação de senha

Em **Configurações** o usuário troca a senha (pede a atual). Na tela de login, "Esqueci minha senha" envia um link por e-mail (só para e-mails em `ALLOWED_EMAILS`; a resposta é sempre a mesma). O link passa por `/login/confirmar`, que troca o código por sessão, e cai em `/login/redefinir`.

Para o link funcionar, em **Supabase → Authentication → URL Configuration** adicione `https://contabil-psi.vercel.app/**` (e `http://localhost:3000/**` para dev) em **Redirect URLs**. O link precisa ser aberto no mesmo navegador em que foi pedido (PKCE).
