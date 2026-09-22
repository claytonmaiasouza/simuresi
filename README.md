# SimuResi

Plataforma de estudio para el examen de residencia médica CONAREM (Paraguay): simulacros
cronometrados, flashcards con repetición espaciada, y un sistema de XP/racha/ligas semanales con
ranking real entre usuarios registrados. Incluye suscripciones de pago (planes prepagos vía
Pagopar) y un panel de administración para gestionar clientes, mensualidades y configuración de
cobros.

**Producción:** https://calendar.guiafinanceiro.pro (dominio propio `simuresi.com.py` en proceso
de propagación)

## Qué hace

- **Simulacros por bloque/área** (Cirugía, Gineco-Obstetricia, Salud Pública, Medicina Interna,
  Pediatría) con más de 2300 preguntas de opción múltiple, cada una con explicación de la
  respuesta correcta y de por qué cada alternativa incorrecta está mal.
- **Flashcards** con algoritmo de repetición espaciada (cajas SRS) para repaso de largo plazo.
- **Gamificación**: XP, racha diaria (con congelamientos que perdonan un día perdido), niveles y
  una liga semanal por tramos donde los usuarios compiten entre sí (con relleno de bots
  determinísticos cuando un tramo tiene pocos usuarios reales todavía).
- **Cuentas de usuario** con período de prueba de 14 días, planes pagos (1/3/6 meses) que extienden
  el acceso sin perder el tiempo restante, y avisos en la app cuando el período está por vencer o
  ya venció.
- **Pagos**: integración con Pagopar (pasarela paraguaya) — el cliente paga desde la app y el
  acceso se activa solo al confirmarse el pago (webhook + verificación server-to-server). También
  admite activar pagos manuales (transferencia, efectivo, cortesía) desde el panel admin.
- **Panel de administración** (`/admin`, solo rol `ADMIN`): métricas de clientes activos/en
  prueba/vencidos, ingresos por mes, lista de clientes con filtros, historial de pagos, y una
  ficha por cliente para otorgar acceso, ajustar racha/congelamientos, o activar/expirar la cuenta.
  La configuración de precios y credenciales de Pagopar también se administra ahí, sin tocar el
  servidor.

## Stack

- **Backend:** Node.js 20 + Express 4
- **Base de datos:** PostgreSQL 16 vía Prisma ORM 5
- **Sesiones:** `express-session` + `connect-pg-simple` (sesiones persistidas en Postgres, no en
  memoria) con cookies `httpOnly`/`secure`/`sameSite=lax`
- **Auth:** bcrypt (costo 12) + rate limiting (`express-rate-limit`) en login/signup
- **Frontend:** HTML/JS vanilla sin build step — cada página es un único archivo autocontenido
  (`frontend/index.html` login, `frontend/app.html` la app, `frontend/admin.html` el panel admin),
  servidos como estáticos por Express
- **Validación:** Zod en los endpoints que reciben input del cliente
- **Seguridad HTTP:** Helmet (CSP ajustada para permitir el script inline del frontend, que no usa
  bundler)
- **Pagos:** cliente propio para la API de Pagopar (sin SDK de terceros)
- **Infraestructura:** Docker Compose (contenedor `app` + `db`), detrás de Traefik como reverse
  proxy/TLS termination en un VPS compartido con otros proyectos

## Estructura del proyecto

```
src/
  server.js              Bootstrap de Express: sesión, CSP, rutas estáticas, guards de /app y /admin
  config.js               Carga y valida variables de entorno
  db.js                    Cliente Prisma singleton
  middleware/
    requireAuth.js         Exige sesión válida; expira TRIAL/ACTIVE vencidos de forma perezosa
    requireAdmin.js         Exige rol ADMIN
    rateLimit.js             Limitadores de abuso (auth, historial)
    validate.js               Middlewares genéricos de validación con Zod
  routes/
    auth.js                   Signup, login, logout, /me
    history.js                  Intentos de examen (lectura/escritura)
    srs.js                       Estado de flashcards
    gamify.js                     XP, nivel, racha, liga semanal
    admin.js                       Métricas, clientes, pagos, configuración (todo bajo /api/admin)
    billing.js                      Planes, checkout, sincronización y webhook de Pagopar
  services/
    gamify.js                XP/nivel/racha — misma matemática que el frontend, portada al server
    league.js                  Ligas semanales, rotación, bots de relleno
    settings.js                  Configuración de pagos gestionada desde el panel (con la clave
                                   privada de Pagopar cifrada en reposo)
    billing/
      PagoparClient.js            Llamadas a la API de Pagopar (crear orden, consultar, verificar webhook)
      payments.js                   Aplica pagos confirmados y extiende el plan del usuario
      ManualProvider.js               Activar/expirar cuentas a mano (usado antes de tener gateway)
prisma/
  schema.prisma            Modelo de datos (User, ExamAttempt, FlashcardSrsState, GamifyState,
                             LeagueWeekResult, Payment, Setting)
  migrations/               Historial de migraciones, aplicado con `prisma migrate deploy`
frontend/
  index.html                Login / registro
  app.html                    La aplicación (examen, flashcards, liga, historial) — banco de
                               preguntas incluido como `var Q = [...]`
  admin.html                   Panel de administración
scripts/                    Scripts de mantenimiento puntuales (uso manual, no automatizados)
tools-banco/                 Scripts reutilizables para insertar/validar lotes nuevos de preguntas
```

## Desarrollo local

Requiere Node 20+ y una base Postgres accesible (local o remota).

```bash
npm install
cp .env.example .env        # completar DATABASE_URL, SESSION_SECRET, etc.
npx prisma migrate deploy
npm start                    # sirve en http://localhost:3000
```

Variables de entorno relevantes (ver `.env.example` para la lista completa): `DATABASE_URL`,
`SESSION_SECRET`, `TRIAL_DAYS`. Los precios de los planes y las credenciales de Pagopar se
configuran desde el panel admin (`/admin` → Configuración) y quedan guardados en la base de datos;
las variables `PAGOPAR_*` y `PRICE_*` del entorno solo actúan como respaldo si nunca se guardó nada
desde el panel.

## Despliegue

La app corre en un VPS vía Docker Compose, detrás de Traefik (que maneja TLS y el ruteo por
dominio). El build de la imagen copia el frontend dentro del contenedor — no es un volumen
montado — así que todo cambio de código requiere reconstruir la imagen, no solo reiniciar. Las
migraciones de Prisma se aplican explícitamente después del build, nunca automáticamente al
arrancar el contenedor.

```bash
# 1) enviar los archivos cambiados al servidor (scp/rsync)
# 2) reconstruir solo el servicio "app" (la base de datos no se toca)
docker compose build app
# 3) aplicar migraciones pendientes, si las hay
docker compose run --rm --no-deps app npx prisma migrate deploy
# 4) reiniciar
docker compose up -d app
```
