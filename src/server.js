require("dotenv").config();

const path = require("path");
const express = require("express");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const { Pool } = require("pg");

const config = require("./config");

const app = express();

// Traefik terminates TLS in front of this app -- without trust proxy,
// express-session would never see the request as "secure" and would refuse
// to set the secure cookie.
app.set("trust proxy", 1);

app.use(helmet());
app.use(express.json({ limit: "256kb" }));
app.use(cookieParser());

const sessionPool = new Pool({ connectionString: config.databaseUrl });

app.use(
  session({
    store: new pgSession({ pool: sessionPool, tableName: "session", createTableIfMissing: true }),
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: config.nodeEnv === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    },
  })
);

const { gamifyRouter, leagueRouter } = require("./routes/gamify");

app.use("/api/auth", require("./routes/auth"));
app.use("/api/history", require("./routes/history"));
app.use("/api/srs", require("./routes/srs"));
app.use("/api/gamify", gamifyRouter);
app.use("/api/league", leagueRouter);
app.use("/api/admin", require("./routes/admin"));

const frontendDir = path.join(__dirname, "..", "frontend");

// Serve static assets (nothing sensitive lives outside index.html/app.html,
// but keep this before the guarded routes below so e.g. shared CSS/JS files
// -- if any get added later -- aren't accidentally gated).
app.use(express.static(frontendDir, { index: false }));

app.get("/", (req, res) => {
  if (req.session && req.session.userId) {
    return res.redirect("/app");
  }
  res.sendFile(path.join(frontendDir, "index.html"));
});

app.get("/app", (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.redirect("/");
  }
  res.sendFile(path.join(frontendDir, "app.html"));
});

app.use((req, res) => {
  res.status(404).json({ error: "not_found" });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "internal_error" });
});

app.listen(config.port, () => {
  console.log(`conarem-app listening on :${config.port} (${config.nodeEnv})`);
});
