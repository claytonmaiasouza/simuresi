# SimuResi (antes "CONAREM Simulador") — Contexto completo do sistema

> **Nome do produto: SimuResi** (definido em 2026-09-21). Marca aplicada em título, login, cabeçalho do app, painel admin e descrição do pagamento Pagopar. **Domínio .com.py ainda não comprado** (a URL segue calendar.guiafinanceiro.pro). Ao comprar: apontar A record → 185.137.92.141, trocar o Host no label Traefik do docker-compose, e atualizar webhook/redirect no Pagopar e as URLs em `src/routes/admin.js` (`settingsView`); manter o domínio antigo redirecionando.

> Arquivo de memória do projeto. Atualizado em 2026-09-20. **Não contém senhas/segredos** (ficam só no `.env` do VPS).

## 1. O que é
Plataforma de estudo para o exame CONAREM (residência médica, Paraguai): simulados, flashcards, XP/streak/ligas semanais com ranking real entre usuários. Multi-usuário, com contas, planos (TRIAL/ACTIVE/EXPIRED/CANCELED). Pagamento ainda **não** integrado (plano é alterado manualmente por admin).

- **URL produção:** https://calendar.guiafinanceiro.pro  (`/` = login, `/app` = aplicação, exige sessão)
- **Stack:** Node 20 + Express + PostgreSQL 16 + Prisma 5.22, Docker Compose, sessões server-side (bcrypt + cookie httpOnly + `connect-pg-simple`).
- **Frontend:** HTML único sem build — `frontend/app.html` (lógica + banco de questões embutido) e `frontend/index.html` (login/cadastro).

## 2. Ambientes e caminhos
| Onde | Caminho |
|---|---|
| Projeto local (Windows) | `D:\projetos claudecode\ideiadoida\conarem-app\` |
| Material fonte (PDFs/Word) | `D:\projetos claudecode\ideiadoida\Material\` (`Banco de Preguntas\`, `Conarem 2018\`) |
| Backups locais do app.html | `Material\Conarem 2018\app.html.bak_*` e `Material\Banco de Preguntas\app.html.bak_*` (fora do diretório servido) |
| VPS | `/opt/conarem-app/` |
| Backups no VPS | `/opt/conarem-app/backups/app.html.bak_YYYYMMDD_HHMMSS` |
| Scripts do banco de questões | `conarem-app\tools-banco\` (`insert_batch1.js`, `validate_q.js`) |

## 3. VPS / SSH
- **Host:** `185.137.92.141` (Hostinger, Ubuntu 24.04, Docker 29, 7.8 GB RAM) — acesso `ssh root@185.137.92.141` (chave SSH já autorizada, sem senha).
- O VPS é **compartilhado com outros produtos em produção** — NÃO tocar: guiafinanceiro-site, bot-elaine, farmacia-santaclara (+ postgres 5433), bot-evolution, bot-app, bot-postgres, fintrack.
- **Traefik** (portas 80/443 do host) faz o roteamento via labels Docker; certresolver `letsencrypt`; rede externa `fintrack_default`. O app não publica portas no host.
- **Não há rsync no Windows** → usar `scp`.
- Node existe direto no host do VPS (usado para checagens rápidas).

## 4. Containers (compose em `/opt/conarem-app/docker-compose.yml`)
- `conarem-app-app-1` — Express na porta 3000 (só rede interna + `fintrack_default`). O frontend é **copiado para dentro da imagem no build** (`COPY frontend ./frontend`) — alterar o arquivo no host **não basta**, é preciso rebuild.
- `conarem-app-db-1` — `postgres:16-alpine`, DB `conarem`, user `conarem`, volume `db_data`, **sem porta publicada** (só rede `internal`).
- Segredos (`SESSION_SECRET`, `POSTGRES_PASSWORD`, `DATABASE_URL`) estão em `/opt/conarem-app/.env` (root, 600). Nunca commitar, nunca colar em chat.

## 5. Banco de dados (Prisma)
Tabelas: `User` (planStatus, trialEndsAt, role), `ExamAttempt` (histórico de simulados; `byArea` JSON), `FlashcardSrsState`, `GamifyState` (xp, streak, tierIndex, weekKey, weekXp), `LeagueWeekResult`; mais tabela `session` gerenciada pelo `connect-pg-simple`.

Consulta rápida (somente leitura):
```
ssh root@185.137.92.141 "docker exec conarem-app-db-1 psql -U conarem -d conarem -c \"SELECT email,\\\"planStatus\\\",\\\"trialEndsAt\\\" FROM \\\"User\\\";\""
```
(Nomes de tabela/coluna em CamelCase precisam de aspas duplas escapadas.)

### API (resumo)
`/api/auth/{signup,login,logout,me}`, `/api/history` (GET/POST/DELETE), `/api/srs` (GET, PUT `/:cardId`), `/api/gamify`, `/api/league`, `/api/admin/users` (+ `/:id/activate|expire`). XP é concedido no servidor (POST history / PUT srs). **Rotas de escrita retornam `402 trial_expired` quando o trial acabou** (trial de 14 dias após o cadastro).

## 6. Deploy (procedimento)
```
# 1) backup no VPS
ssh root@185.137.92.141 "cp /opt/conarem-app/frontend/app.html /opt/conarem-app/backups/app.html.bak_$(date +%Y%m%d_%H%M%S)"
# 2) enviar
scp "D:/projetos claudecode/ideiadoida/conarem-app/frontend/app.html" root@185.137.92.141:/opt/conarem-app/frontend/app.html
# 3) rebuild só do app (db não é tocado)
ssh root@185.137.92.141 "cd /opt/conarem-app && docker compose up -d --build app"
# 4) verificar: docker ps; curl https://calendar.guiafinanceiro.pro/ -> 200
```
Migrações Prisma nunca rodam automaticamente: `docker compose exec app npx prisma migrate deploy`.

## 7. Banco de questões (`var Q = [...]` em `frontend/app.html`)
Schema: `{id, area, q, opts:[["A","..."],...], ans:"A", exp:"por que a certa", wrong:{B:"por que B está errada",...}}`. Áreas (`var AREAS`): `CIR` Cirugía, `GO` Gineco-Obstetricia, `SP` Salud Pública, `MI` Medicina Interna, `PED` Pediatría. Ids mistos (inteiros + strings antigas como `"21b2-p21"`) — o app tolera.

**Estado atual (2026-09-20): 2331 questões** — PED 1542, GO 381, MI 169, CIR 129, SP 110. Maior id numérico: 1991. Original antes da sessão: 420.

Fontes já processadas e publicadas:
| Fonte | Questões | Observação |
|---|---|---|
| PDF Gineco-Obstetricia | 249 | ids 81–329 |
| Conarem 2018.docx + corrección 2018.docx | 173 | ids 330–502; resposta certa = vermelho/negrito no docx |
| banco de preguntas conarem.pdf | 1159 | ids 503–1661; origem **mexicana** (ENARM) localizada às pressas; 47 excluídas |
| Pediatria UCA recopilados_.pdf | 330 | ids 1662–1991; origem **chilena**; excluídas questões dependentes de calendário/protocolo do Chile |

Nenhuma fonte trazia `exp/wrong` por alternativa errada → foram **autorados** por agentes; a resposta certa vem da fonte. Questões com resposta medicamente duvidosa, opções corrompidas, contexto faltando ou dependentes de dados de México/Chile foram excluídas.

### Pipeline para adicionar novas fontes
1. Extrair texto: `.pdf` → `pdftotext -enc UTF-8 -layout arq.pdf saida.txt` (sem `-enc UTF-8` os acentos quebram); `.docx` → unzip + parse de `word/document.xml` marcando runs coloridos/negrito.
2. Dividir em lotes (~120–140 questões) e usar agentes para converter ao schema (exp + wrong por alternativa, área, exclusões justificadas). **Mandar o agente salvar em arquivo a cada mini-lote** (perdemos trabalho uma vez por rate limit) e fechar com `];\nmodule.exports = NEWQ;`.
3. Validar cada lote (contagem, ids, `wrong` = exatamente as alternativas erradas, `ans` existe nas opções), checar duplicatas entre lotes (comparar enunciado completo — frases-modelo como "Continuación del caso clínico seriado" geram falsos positivos).
4. Renumerar com ids inteiros sequenciais a partir do maior id atual.
5. Backup do `app.html` → `node tools-banco/insert_batch1.js <app.html> <lote.js>` (lote precisa ter `var NEWQ = [` … `\n];\nmodule.exports`; a mensagem "Inserted 0" é só bug cosmético do contador, a inserção funciona) → `node tools-banco/validate_q.js <app.html>` (total, duplicatas, contagem por área).
6. Deploy (seção 6).

## 8. Usuários (situação em 2026-09-15)
6 cadastros. Só **Dra Leti Vera** (lauveracant@gmail.com, "laura leticia") usa de verdade: 11 simulados, 60 flashcards, ~2900 XP, streak 8, 1ª colocada na liga em W36/W37. Demais quase sem uso.

## 9. Trial, avisos e pagamento (atualizado 2026-09-20)
- **Causa confirmada** de a Dra Leti não gravar desde 14/09: trial expirou em 2026-09-14 23:29 UTC → `planStatus=EXPIRED` → rotas de escrita devolvem 402. Simulados feitos depois disso **não foram gravados** (irrecuperável).
- Em 2026-09-20 ela recebeu **5 congelamentos** e a sequência foi preservada (streak 8, `streakLastActiveDate` ajustado para 2026-09-19, próxima atividade = dia 9). O plano dela **continua EXPIRED** (só volta a gravar se for ativado: `POST /api/admin/users/:id/activate` ou `UPDATE "User" SET "planStatus"='ACTIVE'`).
- Front (`app.html`): banner "Te quedan N días de prueba" quando faltam ≤5 dias; banner "Tu período de prueba terminó" + botão **Reactivar mi cuenta** quando expirado; o 402 ao salvar também abre o modal de pagamento (`openPaymentModal`).
- O modal lê `/api/auth/me → payment`, configurado por variáveis no `/opt/conarem-app/.env` do VPS: `PAYMENT_URL` (link de pagamento), `PAYMENT_WHATSAPP` (número com DDI, só dígitos), `PAYMENT_INSTRUCTIONS` (texto livre: banco/alias/valor). Após editar o .env: `docker compose up -d app`. Sem nenhuma definida, o modal pede para contatar o administrador.
- Streak: congelamento só cobre 1 dia perdido (gap===2); ganha 1 congelamento a cada 7 dias de sequência se tiver 0.

## 9b. Sistema de pagamento (Pagopar) — implementado 2026-09-20, AINDA SEM CHAVES
- Fluxo: app abre modal com planos (`GET /api/billing/plans`) → `POST /api/billing/checkout {plan}` cria `Payment` PENDING e chama Pagopar (API 2.0 `iniciar-transaccion`) → cliente é redirecionado para `https://www.pagopar.com/pagos/<hash>` → Pagopar chama o webhook `POST /api/billing/webhook` (valida token sha1(private+hash_pedido) e **reconsulta** o pedido via API `traer` com token sha1(private+"CONSULTA"), conferindo valor) → `applyPaid` marca PAID uma única vez e estende o plano. Ao voltar ao app (`/app?pago=...`) o front chama `POST /api/billing/sync` (cobre webhook perdido).
- Modelo: `Payment` (orderNumber = id_pedido_comercio, amount em PYG inteiro, status PENDING/PAID/CANCELED, pagoparHash) e `User.planEndsAt`. Plano pago = `planStatus=ACTIVE` + `planEndsAt`; o tempo restante do trial/plano se soma ao novo período. `requireAuth` expira ACTIVE quando `planEndsAt` passa. ACTIVE com `planEndsAt` nulo = manual/sem vencimento.
- Planos (planos prepagos): 1, 3 e 6 meses. Preços em guaraníes via env `PRICE_1M`, `PRICE_3M`, `PRICE_6M` (plano sem preço não aparece).
- Env necessárias no `/opt/conarem-app/.env`: `PAGOPAR_PUBLIC_KEY`, `PAGOPAR_PRIVATE_KEY`, `PRICE_*`; opcionais `PAGOPAR_API_BASE`, `PAGOPAR_PAY_BASE`, `PAGOPAR_CATEGORY` (padrão 909), `PAGOPAR_CITY_ID` (1), `PAGOPAR_DEADLINE_HOURS` (48). Sem chaves → `/checkout` responde 503 e o modal mostra o contato manual (`PAYMENT_WHATSAPP` etc).
- No painel do Pagopar configurar: URL de resposta/webhook = `https://calendar.guiafinanceiro.pro/api/billing/webhook`; URL de redirecionamento pós-pago = `https://calendar.guiafinanceiro.pro/app?pago=1`.
- **Não testado contra o Pagopar real** (sem credenciais): campos do body 2.0 (comprador, categoria 909, ciudad) vieram de documentação/exemplos e podem precisar de ajuste no primeiro teste em staging.
- Migração `20260920000000_payments` aplicada em produção; backup do banco em `/opt/conarem-app/backups/db_before_payments_20260920_231832.sql`. Deploy com mudança de schema: build → `docker compose run --rm --no-deps app npx prisma migrate deploy` → `up -d app`.

## 9c. Painel admin (`/admin`) — implementado 2026-09-20
- Página `frontend/admin.html` (só role ADMIN; senão redireciona). Conta admin: **claytonmaia@gmail.com** (promovida em 2026-09-20; promover outra: `UPDATE "User" SET role='ADMIN' WHERE email=...`). Admins veem o botão flutuante "Panel admin" dentro do app.
- Mostra KPIs (clientes, ativos, em teste, expirados, vencendo ≤7d, uso na semana, receita mês/30d/total), receita dos últimos 6 meses, lista de clientes (busca + filtros) e pagamentos. Clicar num cliente abre gaveta: registrar pagamento/dar acesso (meses e/ou dias, valor, método, obs; valor 0 = cortesia), editar streak/congelamentos, expirar, ativar sem vencimento, histórico de pagamentos e simulados.
- API `/api/admin`: `GET /stats`, `GET /users?q=&filter=`, `GET /users/:id`, `GET /payments?status=`, `POST /users/:id/grant {months,days,amount,method,note}` (cria Payment PAID manual + estende plano via `extendPlan`), `POST /users/:id/gamify`, `POST /users/:id/activate|expire`. Status exibido é o **efetivo** (TRIAL/ACTIVE vencidos aparecem como Expirado mesmo que o banco ainda não tenha virado).
- Migração `20260920010000_payment_admin_fields` (Payment.note, Payment.createdBy). Backup: `backups/db_before_admin_*.sql`.

## 9d. Configuração de pagamentos pelo dashboard (aba Configurações) — 2026-09-20
- `/admin` → aba **Configurações**: preços dos planos 1/3/6 meses (₲; 0 = desativado), chave pública/privada do Pagopar, WhatsApp, link e instruções de pagamento manual; mostra as URLs de webhook e de retorno para colar no painel do Pagopar. Badge "Ativo" quando há chaves + ao menos um plano.
- Valores salvos na tabela `Setting` (linha `payments`, JSON) **sobrescrevem** as variáveis de ambiente (que viram fallback). A chave privada é guardada criptografada (AES-256-GCM, chave derivada de `SESSION_SECRET` — **trocar o SESSION_SECRET invalida a chave privada salva**, seria preciso salvá-la de novo) e nunca é devolvida pela API. Serviço: `src/services/settings.js` (cache em memória, invalidado ao salvar).
- API: `GET/PUT /api/admin/settings`. Migração `20260920020000_settings`.

## 10. Outras observações
- Conectores MCP (Gmail, Drive, Supabase etc.) exigem autorização manual pelo usuário; não usados neste projeto.
- Leituras em produção via SSH podem ser bloqueadas pelo classificador de permissões do Claude Code — o usuário precisa aprovar cada comando.
- Plano original de arquitetura: `C:\Users\Clayton\.claude\plans\wondrous-tumbling-hickey.md`.
