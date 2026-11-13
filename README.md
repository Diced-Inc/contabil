# Bruno Contábil

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
2. **Bancos e extratos**: cadastre cada conta bancária ligada a uma conta contábil do ativo e importe o extrato (OFX, CSV ou PDF). Transações repetidas são ignoradas.
3. **Conciliação**: revise as pendentes com a sugestão de conta. Aprove uma a uma ou em lote, classifique manualmente, case com títulos ou marque transferências entre contas. Regras criadas aqui valem para as próximas importações.
4. **Lançamentos e títulos**: faça lançamentos manuais (ajustes, provisões) e registre contas a receber/pagar. A baixa do título acontece na conciliação.
5. **Fechamento e apuração**: feche os meses em ordem. Com os 12 meses fechados, apure o exercício.
6. **Relatórios**: Balancete, Balanço, DRE (com comparativo do ano anterior), Diário e Razão.

## Importar CSV e PDF

Além de OFX, o diálogo de importação aceita CSV e PDF (vários arquivos, até 4,4 MB cada). O histórico de importações mostra a origem de cada arquivo.

- **CSV**: o sistema detecta encoding, separador e linha de cabeçalho e pede o papel de cada coluna (data, histórico, valor ou débito/crédito, saldo), o formato da data e se o sinal deve ser invertido, com prévia das linhas. O mapeamento fica salvo por conta e é reaplicado sozinho nos próximos CSV com o mesmo layout.
- **PDF**: a IA extrai as movimentações (saídas negativas; saldos e totais ignorados) e nada é gravado antes da revisão manual, onde dá para corrigir datas, históricos e valores, remover ou adicionar linhas. Se o número da conta lido no PDF não bater com o da conta selecionada, aparece um aviso.
- **Repetidas**: CSV e PDF não têm FITID, então a chave é data + valor + histórico. Linhas iguais no mesmo arquivo viram #2, #3 e são importadas. Mas, entre arquivos, uma movimentação legítima com mesma data, valor e texto de outra já importada é tratada como repetida: na revisão do PDF, diferencie o histórico para que ela entre. A chave de CSV e a de PDF são distintas, e nenhuma delas deduplica contra OFX, então não importe o mesmo período por dois formatos.
- O saldo do extrato (para a conferência) vem da coluna de saldo da linha mais recente no CSV, ou do saldo final lido no PDF.

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

## Avisos por e-mail

Todo dia às 08:00 (Brasília) a Vercel chama `/api/cron/avisos` (`vercel.json`, `"0 11 * * *"` em UTC; no plano Hobby o disparo pode cair em qualquer minuto dessa hora). Para cada empresa com **Avisos ao cliente** ligado em Configurações e ao menos um cliente ativo, a rota manda:

- **Pedido de extrato** no dia configurado (1 a 28), pedindo o mês anterior, se o ciclo ainda está aguardando extrato. Se o cron falhar num dia, o pedido sai no dia seguinte; os lembretes perdidos não são reenviados.
- **Lembretes de extrato** N dias depois do pedido (dia além do fim do mês cai no último dia), enquanto o cliente não enviar.
- **Lembretes do DAS** N dias antes do vencimento e um aviso no dia seguinte ao vencimento, enquanto o DAS não for marcado como pago.

Cada envio fica em `notificacoes` (histórico em Clientes → Avisos enviados); o mesmo aviso não sai duas vezes para o mesmo e-mail no mesmo dia, e o pedido não se repete depois de enviado. O botão **Simular avisos de hoje** mostra o que sairia com a configuração salva, sem enviar.

Variáveis (Vercel → Settings → Environment Variables):

| Variável | Para quê |
| --- | --- |
| `RESEND_API_KEY` | Envio pelo [Resend](https://resend.com). Sem ela, os avisos ficam registrados como "Não configurado". |
| `EMAIL_FROM` | Remetente, ex.: `Bruno Contábil <avisos@seudominio.com.br>`. O domínio precisa estar verificado no Resend (Domains → Add domain, registros SPF/DKIM no DNS). |
| `SUPABASE_SERVICE_ROLE_KEY` | Convites e links de recuperação de senha gerados pelo servidor. |
| `CRON_SECRET` | A Vercel envia `Authorization: Bearer <CRON_SECRET>`; sem ela a rota recusa. |

Com `SUPABASE_SERVICE_ROLE_KEY` e o Resend configurados, o e-mail de recuperação de senha também sai pelo Resend com a marca do sistema; sem eles, continua o SMTP do Supabase.

Teste local: `curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/cron/avisos?empresa=<id>&simular=1"`.
