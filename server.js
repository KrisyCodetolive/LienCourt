// LienCourt : raccourcisseur de liens. Aucune dépendance : Node seul.
// Données dans data/links.json (si le disque est en lecture seule, elles restent en mémoire).
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data", "links.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const MAX_LINKS = 1000;
const MAX_BODY = 2048;
const CODE_RE = /^[a-z0-9]{6}$/;

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json; charset=utf-8",
};

// --- stockage -----------------------------------------------------------------------------------
let links = {};
try { links = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch { /* premier démarrage */ }

let saving = false;
function save() {
  if (saving) return;
  saving = true;
  setTimeout(() => {
    saving = false;
    try {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(links));
    } catch { /* disque en lecture seule : on reste en mémoire */ }
  }, 200);
}

function newCode() {
  for (;;) {
    const c = crypto.randomBytes(4).toString("hex").slice(0, 6).replace(/[^a-z0-9]/g, "a");
    if (!links[c]) return c;
  }
}

// --- limite de création : 30 liens par minute et par adresse ----------------------------------
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 30;
}

// --- utilitaires --------------------------------------------------------------------------------
const json = (res, status, body) => {
  const data = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(data);
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error("trop gros")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function validUrl(raw) {
  try {
    const u = new URL(String(raw).trim());
    return (u.protocol === "http:" || u.protocol === "https:") && raw.length <= 1000 ? u.toString() : null;
  } catch { return null; }
}

function serveFile(res, file) {
  const full = path.join(PUBLIC_DIR, file);
  if (!full.startsWith(PUBLIC_DIR + path.sep)) return notFound(res);
  fs.readFile(full, (err, buf) => {
    if (err) return notFound(res);
    res.writeHead(200, { "content-type": TYPES[path.extname(full)] || "application/octet-stream", "cache-control": "public, max-age=300" });
    res.end(buf);
  });
}
const notFound = (res) => json(res, 404, { error: "introuvable" });

// --- serveur --------------------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://x");
  try {
    if (req.method === "GET" && pathname === "/healthz") return json(res, 200, { ok: true });

    if (req.method === "GET" && pathname === "/api/links") {
      const list = Object.entries(links)
        .map(([code, l]) => ({ code, url: l.url, clicks: l.clicks, created_at: l.created_at }))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 10);
      return json(res, 200, { links: list, total: Object.keys(links).length });
    }

    if (req.method === "POST" && pathname === "/api/links") {
      const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress || "?";
      if (limited(ip)) return json(res, 429, { error: "Trop de liens créés, réessayez dans une minute." });
      if (Object.keys(links).length >= MAX_LINKS) return json(res, 507, { error: "Le service est plein pour la démo." });
      let body;
      try { body = JSON.parse((await readBody(req)) || "{}"); } catch { return json(res, 400, { error: "Requête invalide." }); }
      const url = validUrl(body.url);
      if (!url) return json(res, 400, { error: "Adresse invalide : elle doit commencer par http:// ou https://." });
      const code = newCode();
      links[code] = { url, clicks: 0, created_at: new Date().toISOString() };
      save();
      return json(res, 201, { code, url });
    }

    if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) return serveFile(res, "index.html");
    if (req.method === "GET" && pathname.startsWith("/assets/")) return serveFile(res, pathname.slice(1));

    if (req.method === "GET" && CODE_RE.test(pathname.slice(1)) && links[pathname.slice(1)]) {
      const l = links[pathname.slice(1)];
      l.clicks++;
      save();
      res.writeHead(302, { location: l.url, "cache-control": "no-store" });
      return res.end();
    }
    return notFound(res);
  } catch (e) {
    console.error("erreur", e);
    return json(res, 500, { error: "erreur interne" });
  }
});

if (require.main === module) {
  server.listen(PORT, "0.0.0.0", () => console.log(`LienCourt listening on port ${PORT}`));
}
module.exports = { server };
