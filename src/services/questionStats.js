const fs = require("fs");
const path = require("path");

// The question bank lives as a plain JS array literal (`var Q = [...]`)
// embedded inside frontend/app.html -- there is no "questions" table in
// Postgres, that file is the actual source of truth the exam runner reads
// from. To show an accurate, always-current count on the landing page
// without re-parsing a ~3MB file on every request, we parse it once here
// (at module load / server start) and cache the result in memory. Because
// app.html only changes via a redeploy (which restarts this process), the
// cached count can never go stale while the server is running.

const APP_HTML_PATH = path.join(__dirname, "..", "..", "frontend", "app.html");

// Depth-and-string-aware scan for the closing "]" of `var Q = [ ... ];`.
// A naive regex/indexOf would break on "]" characters that appear inside
// question/answer strings (there are plenty), so this walks character by
// character, ignoring brackets while inside a quoted string.
function extractArrayLiteral(src, varDeclaration) {
  const start = src.indexOf(varDeclaration);
  if (start < 0) return null;
  const startIdx = start + varDeclaration.length;
  let depth = 0;
  let inStr = false;
  let strCh = null;
  let esc = false;
  let i = startIdx;
  for (; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (c === "\\") {
        esc = true;
        continue;
      }
      if (c === strCh) inStr = false;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = true;
      strCh = c;
      continue;
    }
    if (c === "[") depth++;
    if (c === "]") {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  return src.slice(startIdx, i);
}

function computeStats() {
  const src = fs.readFileSync(APP_HTML_PATH, "utf8");
  // NB: the declaration marker deliberately excludes the "[" itself, so the
  // scan below starts ON the opening bracket and counts it (depth 0 -> 1).
  const arrText = extractArrayLiteral(src, "var Q = ");
  if (!arrText) throw new Error("could not locate 'var Q = [' in app.html");
  // eslint-disable-next-line no-eval -- trusted, first-party file baked into our own image, not user input
  const Q = eval(arrText);
  const byArea = {};
  Q.forEach((q) => {
    byArea[q.area] = (byArea[q.area] || 0) + 1;
  });
  return { total: Q.length, byArea, computedAt: new Date().toISOString() };
}

let cached = null;
try {
  cached = computeStats();
  console.log(`questionStats: loaded ${cached.total} questions from app.html`);
} catch (e) {
  // Never let a parsing hiccup take the whole app down -- the landing page
  // just falls back to whatever static number is already in its HTML.
  console.error("questionStats: failed to compute question stats:", e.message);
}

function getQuestionStats() {
  return cached;
}

module.exports = { getQuestionStats };
