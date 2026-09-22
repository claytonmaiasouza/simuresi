# SimuResi — Guia operacional do projeto

> Referência rápida e factual para trabalhar neste repositório. Para o histórico/narrativa de decisões do produto, ver `CONTEXTO_SISTEMA.md`. Para visão geral de stack/arquitetura voltada a leitura humana, ver `README.md`.

## O que é

Plataforma de estudo para o exame CONAREM (residência médica, Paraguai): simulados de múltipla escolha, flashcards com repetição espaçada, gamificação (XP, streak, ligas semanais com ranking real entre usuários), contas multiusuário com planos (TRIAL/ACTIVE/EXPIRED/CANCELED), sistema de pagamento (Pagopar, ainda não testado com credenciais reais) e dashboard admin.

---

## Servidor de Produção (VPS)

| Item | Valor |
|---|---|
| IP | `185.137.92.141` (Hostinger, Ubuntu 24.04, Docker) |
| Acesso SSH | `ssh root@185.137.92.141` (chave já autorizada, sem senha) |
| URL pública | `https://simuresi.com.py` e `https://www.simuresi.com.py` |
| Diretório do projeto | `/opt/conarem-app/` |
| `.env` de produção | `/opt/conarem-app/.env` (nunca commitado; ver `.env.example` pra saber quais chaves preencher) |
| `docker-compose.yml` | `/opt/conarem-app/docker-compose.yml` |
| Backups | `/opt/conarem-app/backups/` |

> **Este VPS é compartilhado com outros produtos em produção não relacionados** (`guiafinanceiro-site`, `bot-elaine`, `bot-evolution`, `bot-app`, `bot-postgres`, o stack `farmacia-santaclara` + `farmacia-postgres`), todos atrás do mesmo Traefik. **Nunca mexer nesses containers.** Depois de qualquer deploy, confira `docker ps` pra garantir que todos continuam `Up`.

> A máquina de desenvolvimento local (Windows) **não tem Docker**. Todo trabalho com containers/Postgres/migrations acontece via SSH no VPS.

### Containers em produção

| Container | Função | Rede |
|---|---|---|
| `conarem-app-app-1` | App Node.js (Express), porta 3000 exposta via Traefik | `fintrack_default` + `internal` |
| `conarem-app-db-1` | PostgreSQL 16, database `conarem` | só `internal` (sem porta publicada, inacessível do host) |
| `traefik-traefik-1` | Proxy reverso compartilhado + SSL (Let's Encrypt) | — |

Dentro do mesmo Postgres (`conarem-app-db-1`) existe também a database **`conarem_premium`** (separada de `conarem`), com a tabela `extra_questions` — ver seção "Banco de questões extra" abaixo. Não está conectada ao app ainda.

### Domínios

- **Domínio ativo:** `simuresi.com.py` / `www.simuresi.com.py` — router Traefik `simuresi` no `docker-compose.yml`.
- **Domínio legado:** `calendar.guiafinanceiro.pro` — **desativado de propósito** em 2026-09-22 (o router Traefik `conarem` que apontava pra ele foi removido; retorna 404, sem redirect). Não reativar sem pedido explícito.

---

## Deploy — Processo Correto

O `Dockerfile` faz `COPY` de `src/`, `frontend/`, `prisma/`, `scripts/` **na hora do build da imagem** — não há bind-mount do host pro container. Por isso, **é sempre necessário rebuildar a imagem** depois de mudar qualquer arquivo (diferente de setups com `docker cp` + restart).

### Fluxo padrão pra atualizar frontend/backend:

```bash
# 1. Copiar o(s) arquivo(s) modificado(s) pro VPS
scp frontend/app.html root@185.137.92.141:/opt/conarem-app/frontend/app.html
# (ou: scp -r src frontend root@185.137.92.141:/opt/conarem-app/  — pra vários arquivos)

# 2. Backup do arquivo anterior no VPS antes de sobrescrever build (boa prática)
ssh root@185.137.92.141 "cd /opt/conarem-app && cp frontend/app.html backups/app.html.bak_$(date +%Y%m%d_%H%M%S) 2>/dev/null"

# 3. Rebuildar a imagem e recriar SÓ o container app (db não é tocado)
ssh root@185.137.92.141 "cd /opt/conarem-app && docker compose up -d --build app"

# 4. Verificar
curl -s -o /dev/null -w "%{http_code}\n" https://simuresi.com.py/
ssh root@185.137.92.141 "docker ps --format '{{.Names}} {{.Status}}'"   # confirmar que os containers-irmãos continuam Up
```

Não existe um comando de "restart sem rebuild" útil aqui — como não há volume montado, `docker restart app` sozinho só reiniciaria o processo com o código antigo já dentro da imagem.

### Migrations do Prisma

Sem Docker local, as migrations são **escritas à mão** em `prisma/migrations/<timestamp>_<nome>/migration.sql` (seguindo o padrão que o Prisma geraria) e aplicadas diretamente no VPS:

```bash
scp -r prisma/migrations/<nova_pasta> root@185.137.92.141:/opt/conarem-app/prisma/migrations/
ssh root@185.137.92.141 "cd /opt/conarem-app && docker compose exec app npx prisma migrate deploy"
# depois do deploy da migration, sempre rebuildar a imagem também (passo acima),
# pra que o Prisma Client gerado no build reflita o schema novo.
```

Migrations existentes: `20260831180113_init`, `20260920000000_payments`, `20260920010000_payment_admin_fields`, `20260920020000_settings`.

---

## Stack

| Camada | Tecnologia |
|---|---|
| Runtime | Node.js 20 + Express 4 |
| Banco | PostgreSQL 16 + Prisma 5 (`@prisma/client`) |
| Sessão | `express-session` + `connect-pg-simple` (sessão persistida no Postgres, sobrevive restart do container) |
| Senha | `bcrypt` |
| Validação | `zod` |
| Segurança HTTP | `helmet` — CSP customizado com `script-src 'self' 'unsafe-inline'` (o frontend é HTML vanilla sem build step, com toda a lógica em `<script>` inline; isso é intencional, não um descuido) |
| Rate limit | `express-rate-limit` |
| Pagamento | Pagopar (gateway Paraguai) — implementado em `src/services/billing/`, mas **nunca testado com credenciais reais** |
| Frontend | HTML/CSS/JS vanilla, **sem framework, sem bundler** — cada página é um arquivo `.html` autocontido |
| Container | Docker Compose, atrás de um Traefik compartilhado (ver seção VPS) |

---

## Variáveis de Ambiente

Definidas em `/opt/conarem-app/.env` no VPS (nunca commitado — ver `.env.example` local pros nomes).

| Variável | Obrigatória | Descrição |
|---|---|---|
| `DATABASE_URL` | sim | `postgresql://conarem:***@db:5432/conarem?schema=public` — host é `db` (nome do serviço Compose), não `localhost` |
| `SESSION_SECRET` | sim | Assina cookies de sessão **e** deriva a chave AES-256-GCM que criptografa a Pagopar private key no banco (`src/services/settings.js`) — **rotacionar isso invalida a chave Pagopar salva** |
| `POSTGRES_PASSWORD` | sim (pro `db`) | Senha do role `conarem` |
| `PORT` | não (default 3000) | Precisa bater com o label `traefik...loadbalancer.server.port` no compose |
| `NODE_ENV` | não | `production` no VPS |
| `TRIAL_DAYS` | não (default 14) | Duração do trial grátis no signup |
| `LANDING_HOSTS` | não (default `simuresi.com.py,www.simuresi.com.py`) | Hosts que recebem `landing.html` em `/`; qualquer outro host recebe `index.html` (login) |
| `PAYMENT_URL`, `PAYMENT_WHATSAPP`, `PAYMENT_INSTRUCTIONS` | não | Fallback de contato pra pagamento manual — hoje configurável também pelo dashboard admin (`Setting` no banco, sobrepõe o `.env`) |
| `PRICE_1M`, `PRICE_3M`, `PRICE_6M` | não | Preços dos planos em guaraníes (inteiro) |
| `PAGOPAR_PUBLIC_KEY`, `PAGOPAR_PRIVATE_KEY`, `PAGOPAR_API_BASE`, `PAGOPAR_PAY_BASE`, `PAGOPAR_CATEGORY`, `PAGOPAR_CITY_ID`, `PAGOPAR_DEADLINE_HOURS` | não | Config Pagopar — também sobreponível via dashboard admin (private key fica criptografada no banco, nunca em texto puro) |

---

## Estrutura de Arquivos

```
conarem-app/
  docker-compose.yml       — infra de produção (app + db, labels Traefik)
  Dockerfile                — node:20-alpine, instala openssl (Prisma precisa da CLI), copia src/frontend/prisma/scripts, gera Prisma Client
  package.json
  prisma/
    schema.prisma            — fonte da verdade do schema
    migrations/               — 4 migrations, escritas à mão (ver acima)
  src/
    server.js                 — bootstrap Express, sessão, roteamento por host (landing vs login), CSP
    db.js                     — PrismaClient singleton
    config.js                 — carrega/valida env vars, monta config de planos/Pagopar
    middleware/
      requireAuth.js           — exige sessão; flip preguiçoso TRIAL→EXPIRED se trialEndsAt passou
      requireAdmin.js           — exige req.user.role === "ADMIN"
      rateLimit.js               — limiters de auth/checkout/history
      validate.js                 — helpers de validação Zod (body/params)
    routes/
      auth.js      — signup, login, logout, /me
      history.js    — tentativas de simulado (histórico)
      srs.js         — estado do flashcard (repetição espaçada)
      gamify.js       — gamifyRouter (XP/streak) + leagueRouter (liga semanal)
      admin.js          — dashboard admin (users, payments, stats, settings, grant/gamify)
      billing.js          — plans, checkout, sync, webhook (Pagopar)
    services/
      settings.js       — config de pagamento persistida no banco (criptografada)
      xpAward.js          — cálculo de XP
      league.js            — lógica da liga semanal
      gamify.js             — helpers de gamificação
      billing/
        BillingProvider.js   — interface
        ManualProvider.js     — ativação manual (usado pelo admin)
        PagoparClient.js       — integração Pagopar (não testada com credenciais reais)
        payments.js             — extendPlan, applyPaid, confirmPayment
  frontend/
    index.html      — login/cadastro (servido em qualquer host fora de LANDING_HOSTS)
    landing.html      — landing page + portal de notícias (servido em simuresi.com.py)
    app.html            — app principal: simulado + flashcards + gamificação + **banco de questões embutido** (`var Q = [...]`, ~2.500 itens, arquivo grande, ~3MB)
    admin.html            — dashboard administrativo (só role ADMIN)
    terminos.html, propiedad-intelectual.html, responsabilidad.html, privacidad.html — páginas legais públicas
  scripts/
    fix-user-trial.js  — script pontual de correção de trial (histórico, mantido no repo)
    backup.sh            — só existe no VPS (não versionado); pg_dump + cópia do app.html, poda >30 dias
```

---

## Banco de Dados — Modelos (`prisma/schema.prisma`)

| Modelo | Campos-chave |
|---|---|
| `User` | `email`, `passwordHash`, `role` (USER/ADMIN), `planStatus` (TRIAL/ACTIVE/EXPIRED/CANCELED), `trialEndsAt`, `planEndsAt`, `planUpdatedBy` |
| `ExamAttempt` | Uma linha por simulado feito: `mode`, `total`/`answered`/`correct`, `byArea` (Json), `isSimulacro` |
| `FlashcardSrsState` | Por `(userId, cardId)`: `box`, `due`, `reps` (algoritmo de repetição espaçada) |
| `GamifyState` | 1:1 com User — `xp`, `streakCurrent`/`streakLongest`/`streakFreezes`, `tierIndex` (liga), `weekKey`/`weekXp` |
| `LeagueWeekResult` | Histórico por `(userId, weekKey)` — resultado da liga daquela semana (`rank`, `promoted`, `demoted`) |
| `Payment` | `orderNumber` (autoincrement), `planCode`, `months`, `amount`, `status` (PENDING/PAID/CANCELED), `pagoparHash` |
| `Setting` | `key` (PK) + `value` (Json) — hoje só usado pra `payments` (config Pagopar/preços/contato) |

> `Session` (cookies) é gerenciada pelo `connect-pg-simple`, **não** pelo Prisma — ele cria a própria tabela `session` on-the-fly.

---

## Banco de questões — regra importante

O simulado principal (`frontend/app.html`, `var Q = [...]`) só pode conter as **5 áreas oficiais do CONAREM**:

```js
var AREAS = { CIR, GO, SP, MI, PED };  // Cirugía, Gineco-Obstetricia, Salud Pública, Medicina Interna, Pediatría
```

**Nenhuma outra área deve entrar nesse banco.** Se material fonte trouxer subespecialidades fora dessas 5 (ex.: Emergentología, Medicina Familiar, Traumatología), elas vão para o **banco separado de questões extra**:

- Database Postgres `conarem_premium` (mesmo container `conarem-app-db-1`, database distinta de `conarem`)
- Tabela `extra_questions` (`id`, `area`, `area_label`, `question`, `options` jsonb, `answer`, `explanation`, `wrong_explanations` jsonb, `source`, `created_at`)
- Hoje contém 150 questões (Emergentología/Medicina Familiar/Traumatología, 50 cada), **não conectadas a nenhuma rota da API ainda** — reservado para uma futura feature premium.
- Pra reconectar: criar uma rota autenticada (ex. `GET /api/premium/questions`) que consulta essa database via uma segunda `Pool`/`PrismaClient` apontando pra `conarem_premium`, gatilhada por `planStatus`/flag de premium.

Cada questão do `Q` segue o formato:
```js
{id, area, q, opts:[["A","..."],["B","..."],...], ans:"LETRA", exp:"...", wrong:{LETRA:"...", ...}}
```
`AREAS`/contadores da UI se recalculam sozinhos (`Q.forEach(...)`), não precisa atualizar nada manualmente ao inserir questões.

---

## Rotas Principais

```
GET  /                          — landing.html (hosts em LANDING_HOSTS) ou index.html (login)
GET  /login                     — index.html
GET  /app                       — app.html (exige sessão)
GET  /admin                     — admin.html (exige sessão + role ADMIN)
GET  /terminos, /propiedad-intelectual, /responsabilidad, /privacidad  — páginas legais públicas

POST /api/auth/signup | /login | /logout
GET  /api/auth/me

GET  /api/history                — histórico de simulados do usuário
POST /api/history                 — salva tentativa (exige plano ativo)
DELETE /api/history

GET  /api/srs                      — estado dos flashcards
PUT  /api/srs/:cardId

GET  /api/gamify                     — estado de XP/streak
GET  /api/league                      — ranking da liga semanal

GET  /api/admin/stats | /users | /users/:id | /payments
POST /api/admin/users/:id/grant | /activate | /expire | /gamify
GET  /api/admin/settings
PUT  /api/admin/settings

GET  /api/billing/plans
POST /api/billing/checkout | /sync
POST /api/billing/webhook          — recebido do Pagopar (verifica token + re-confirma server-to-server)
```

---

## Autenticação

| Contexto | Mecanismo |
|---|---|
| App/páginas protegidas | Sessão server-side (`express-session` + `connect-pg-simple`), cookie `httpOnly`, `secure` em produção, `sameSite:"lax"` |
| `requireAuth` | Carrega o usuário do banco a cada request (não confia só na sessão); flip preguiçoso TRIAL→EXPIRED se `trialEndsAt` já passou |
| `requireAdmin` | Exige `req.user.role === "ADMIN"` |
| Webhook Pagopar | Token `sha1(privateKey + hash_pedido)`, verificado em `PagoparClient.verifyWebhookToken`, e depois re-confirmado server-to-server antes de liberar o plano |

O link flutuante pro painel admin no `app.html` só aparece se `role === "ADMIN"` **e** `email === "claytonmaia@gmail.com"`.

---

## Backup

```bash
# Rodar manualmente no VPS (script já existe, mas a agenda de cron precisa ser confirmada com o dono — 
# ver "Armadilhas conhecidas" abaixo)
ssh root@185.137.92.141 "/opt/conarem-app/scripts/backup.sh"

# Ver backups existentes
ssh root@185.137.92.141 "ls -lh /opt/conarem-app/backups/"
```

---

## Diagnóstico Rápido

```bash
# Site no ar?
curl -s -o /dev/null -w "%{http_code}\n" https://simuresi.com.py/

# Logs em tempo real
ssh root@185.137.92.141 "docker logs conarem-app-app-1 -f --tail 50"

# Containers (confirmar que nada do VPS compartilhado caiu)
ssh root@185.137.92.141 "docker ps --format '{{.Names}} {{.Status}}'"

# Contar quantas questões estão realmente publicadas (Q array é texto puro dentro do HTML —
# grep sozinho não é confiável pra isso, precisa avaliar o array de verdade respeitando
# aspas/colchetes aninhados dentro das strings das questões). Criar um script local, ex.
# scratchpad/count_check.js:
#
#   const fs = require("fs");
#   const s = fs.readFileSync("/app/frontend/app.html", "utf8");
#   const start = s.indexOf("var Q = [");
#   const startIdx = start + "var Q = ".length;
#   let depth = 0, i = startIdx, inStr = false, strCh = null, esc = false;
#   for (; i < s.length; i++) {
#     const c = s[i];
#     if (inStr) {
#       if (esc) { esc = false; continue; }
#       if (c === "\\") { esc = true; continue; }
#       if (c === strCh) inStr = false;
#       continue;
#     }
#     if (c === '"' || c === "'") { inStr = true; strCh = c; continue; }
#     if (c === "[") depth++;
#     if (c === "]") { depth--; if (depth === 0) { i++; break; } }
#   }
#   const Q = eval(s.slice(startIdx, i));
#   console.log("count:", Q.length);
#   const counts = {}; Q.forEach(q => counts[q.area] = (counts[q.area] || 0) + 1);
#   console.log(counts);
#
# depois:
scp count_check.js root@185.137.92.141:/tmp/count_check.js
ssh root@185.137.92.141 "docker cp /tmp/count_check.js conarem-app-app-1:/tmp/count_check.js && docker exec conarem-app-app-1 node /tmp/count_check.js"

# Certificado TLS de fato servido (bypassa cache de DNS local)
openssl s_client -connect 185.137.92.141:443 -servername simuresi.com.py 2>/dev/null | openssl x509 -noout -subject -issuer -dates
```

---

## Git / Repositório

- Remote: `https://github.com/claytonmaiasouza/simuresi.git`
- **`git push` costuma ser bloqueado pelo classificador de permissões do Claude Code** neste projeto (motivos observados: "Sensitive-Source Provenance", "Out-of-Place Publication", "Data Exfiltration"), mesmo após confirmação do usuário na conversa. Quando isso acontecer, **não insistir tentando contornar** — explicar a limitação e pedir pro usuário rodar o `git push` ele mesmo, ou adicionar `"Bash(git push:*)"` em `permissions.allow` nas configurações do Claude Code.
- `.env` nunca é commitado (está no `.gitignore` desde o primeiro commit).
- Nem sempre o working tree local está limpo/commitado — checar `git status` antes de assumir que o remote reflete o código local.

---

## Convenções de Código

- **CommonJS** (`require`/`module.exports`) — sem ESM.
- **Async/await** em todo lugar.
- **Prisma** pra tudo que é banco `conarem` — sem SQL raw, exceto no banco separado `conarem_premium` (que não passa pelo Prisma, é acessado via `pg` puro).
- Frontend sem build step: **nunca** introduzir uma dependência que precise de bundler/transpilação sem discutir antes — o app inteiro depende de rodar como HTML+`<script>` puro.
- Comentários no código em inglês (padrão já estabelecido no repo), mesmo a conversa com o dono sendo em português.

---

## Armadilhas Conhecidas

1. **Rebuild é obrigatório em todo deploy.** Não existe bind-mount; `docker cp`/`docker restart` sozinho não atualiza nada — sempre `docker compose up -d --build app`.

2. **As 5 áreas do CONAREM são fixas** (CIR, GO, SP, MI, PED). Qualquer questão de outra especialidade vai pro banco separado `conarem_premium`, nunca pro `Q` principal — isso já foi corrigido uma vez nesta base (EM/MF/TR tinham entrado por engano e foram removidos).

3. **`SESSION_SECRET` também criptografa a Pagopar private key** salva no banco (`src/services/settings.js`). Rotacionar esse segredo sem reconfigurar a Pagopar key pelo dashboard admin quebra o pagamento silenciosamente.

4. **`frontend/app.html` é um arquivo enorme** (~3MB, banco de questões embutido como texto). Editar com cuidado — sempre validar com um parse real do array `Q` (respeitando aspas/colchetes aninhados) antes de fazer deploy, `grep` sozinho não é confiável pra contar ou localizar questões.

5. **Domínio antigo (`calendar.guiafinanceiro.pro`) foi desativado de propósito.** Não recriar o router Traefik pra ele sem pedido explícito do dono.

6. **Agenda de backup automático (`cron`) tem status incerto.** O script `scripts/backup.sh` existe e foi testado manualmente no VPS, mas o registro no `crontab` foi bloqueado pro Claude Code executar diretamente numa sessão anterior — confirmar com o dono se ele rodou o comando por conta própria antes de assumir que backups diários estão de fato acontecendo.

7. **Pagopar nunca foi testado com credenciais reais.** O fluxo (checkout → criação de pedido → webhook → confirmação server-to-server) está implementado, mas o mapeamento exato de campos da API do Pagopar é baseado em documentação antiga (PDF de 2017 + fragmentos de PRs no GitHub) — tratar como não-verificado até um teste ponta a ponta real.
