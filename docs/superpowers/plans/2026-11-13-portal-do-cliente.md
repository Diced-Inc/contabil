# Portal do cliente, ciclo mensal e avisos por e-mail — plano

Pedido do Marcelo (13/11/2026): o dono da empresa (ex.: Marcelo, sócio da Diced) deixa de mandar extrato por WhatsApp. Ele recebe e-mail pedindo os extratos do mês, sobe pelo site, o Bruno processa, e quando o Bruno conclui o cliente recebe e-mail para pagar o DAS.

Decisões fechadas:
- Dois perfis: **contador** (vê tudo, telas atuais) e **cliente** (portal, só a própria empresa).
- Dias de pedido/lembrete **configuráveis por empresa** pelo contador.
- Canal: **e-mail via Resend**. SMS/WhatsApp fora desta entrega.
- DAS: o contador gera no PGDAS como hoje e sobe o PDF com valor e vencimento. O sistema não calcula imposto.
- O cliente não concilia: os arquivos dele caem numa caixa de entrada do contador, que importa com o fluxo existente (OFX/CSV/PDF).

Dependências externas (Marcelo):
- `SUPABASE_SERVICE_ROLE_KEY` (painel db-brunao → Settings → API). Usada só no servidor para convite, links de acesso e Storage.
- `RESEND_API_KEY` e um domínio verificado no Resend (`EMAIL_FROM`, ex.: `Bruno Contábil <avisos@dominio>`). O domínio de teste do Resend só entrega para o dono da conta.
- Tudo funciona sem essas chaves em modo degradado: convite mostra "configure a chave", e-mails ficam registrados como `nao_configurado`.

## Etapa A — perfis, portal e clientes

Schema (migration):
- `contadores (user_id uuid pk, email text unique, created_at)`. Seed com os usuários de `ALLOWED_EMAILS`. Passa a ser a fonte de verdade; `ALLOWED_EMAILS` fica só como bootstrap/compatibilidade.
- `membros (id, empresa_id fk cascade, user_id uuid null, email text, papel enum('cliente'), nome, convidado_em, aceito_em, unique(empresa_id, email))`.
- Funções SQL `security definer` com `search_path` fixo: `eh_contador()` e `pode_acessar_empresa(uuid)` (contador ou membro com `user_id = auth.uid()`).
- RLS do Storage revisada: `logos` e `avatars` hoje liberam qualquer `authenticated`; com clientes logando isso vaza. `logos`: leitura por `pode_acessar_empresa`, escrita só contador. `avatars`: continua por pasta do próprio usuário.

Auth:
- `requireUser()` passa a significar **contador** (todas as telas e actions atuais já chamam). Usuário logado que não é contador e é membro vai para `/portal`.
- Novo `requireSessao()` (qualquer logado, para trocar senha/perfil) e `requireMembro(empresaId)` (contador ou membro da empresa).
- Proxy só exige sessão; autorização fica nos layouts/actions. Usuário logado sem papel nenhum vê "Acesso não autorizado".

Telas:
- Contador, `/e/[id]/clientes`: lista de membros (nome, e-mail, status convite/aceito, último acesso), "Convidar cliente" (nome + e-mail), reenviar convite, remover acesso.
- Convite: `auth.admin.generateLink({ type: 'invite' })` com service role, e o e-mail sai pelo Resend (não depende do SMTP do Supabase, que no Free manda 2–4 por hora). Sem as chaves, mostra o link para o contador copiar e mandar manualmente.
- Cliente, `/portal` (lista as empresas dele; se só uma, redireciona) e `/portal/[empresaId]` com layout próprio, sem sidebar contábil: marca, empresa, perfil e sair.

## Etapa B — ciclo mensal, caixa de entrada e DAS

Schema:
- `ciclos_mensais (id, empresa_id, competencia date, status enum('aguardando_extrato','extrato_recebido','em_processamento','concluido','das_enviado','das_pago'), extrato_solicitado_em, extrato_recebido_em, concluido_em, das_valor numeric(15,2), das_vencimento date, das_path, das_enviado_em, das_pago_em, das_pago_por, observacao, unique(empresa_id, competencia))`. Criado sob demanda (primeiro acesso/cron).
- `documentos_recebidos (id, empresa_id, ciclo_id, conta_bancaria_id null, nome_arquivo, path, mime, tamanho, enviado_por, created_at, processado_em, importacao_id null)`.
- Bucket privado `documentos`, path `{empresaId}/{AAAA-MM}/{uuid}-{nome}`. Upload/download pelo servidor com service role após checar `requireMembro`; sem a chave, policy por `pode_acessar_empresa` com o client da sessão.

Portal do cliente (`/portal/[empresaId]`):
- Card do mês corrente de competência (o mês anterior ao atual): status em linguagem simples, "Enviar extratos" (vários arquivos OFX/CSV/PDF, escolhendo o banco quando há mais de um), lista do que já enviou.
- Quando há DAS: valor, vencimento, baixar PDF, botão "Já paguei".
- Histórico dos meses anteriores.

Contador:
- `/e/[id]/documentos` (caixa de entrada): arquivos recebidos por mês, "Importar" abre o diálogo de importação já existente com o arquivo pré-carregado e marca como processado ao concluir; "Marcar como processado" manual.
- `/e/[id]/fechamento` ganha o bloco do ciclo do mês: status, "Concluir mês e enviar DAS" (upload do PDF da guia, valor, vencimento).
- Painel geral na lista de empresas (`/`): por empresa, status do ciclo do mês, documentos não processados, DAS em aberto e vencido.

## Etapa C — e-mails e agendamento

Configuração por empresa (contador, em Configurações, card "Avisos ao cliente"):
- `avisos_ativos bool`, `dia_pedido_extrato int (1–28)`, `lembretes_extrato_dias int[]` (dias depois do pedido, ex. `{4,9}`), `dias_antes_vencimento_das int[]` (ex. `{3,0}`).

Tabela `notificacoes (id, empresa_id, ciclo_id, tipo, para, assunto, status enum('enviado','erro','nao_configurado'), resend_id, erro, created_at, unique(ciclo_id, tipo, para, data_ref))` para idempotência e histórico.

E-mails (React Email ou HTML simples com a marca, pt-BR):
- `convite`, `pedido_extrato`, `lembrete_extrato`, `extrato_recebido` (para o contador), `das_disponivel`, `lembrete_das`, `recuperacao_senha` (via `generateLink type recovery` + Resend, substituindo o SMTP do Supabase).

Cron (o `vercel.json` já tem o keep-alive; a Vercel Hobby permite execução diária): rota `/api/cron/avisos` protegida por `CRON_SECRET`, roda diariamente em horário de Brasília. Para cada empresa com avisos ativos e membros aceitos: abre o ciclo da competência no dia do pedido e manda `pedido_extrato`; manda lembretes enquanto o status for `aguardando_extrato`; manda `lembrete_das` nos dias configurados enquanto `das_enviado`. Tudo idempotente pela tabela `notificacoes`.

Disparos imediatos (sem esperar cron): `extrato_recebido` ao contador quando o cliente envia; `das_disponivel` ao cliente quando o contador conclui.

Histórico de notificações visível no contador (aba em Clientes).

## Fora desta entrega
SMS e WhatsApp; cálculo do Simples; cliente ver relatórios contábeis (pode entrar depois como leitura dos relatórios com o mesmo `requireMembro`).
