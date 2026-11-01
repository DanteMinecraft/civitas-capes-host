const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const COOKIE_SECRET = process.env.COOKIE_SECRET || "";
const DATA_DIR = process.env.DATA_DIR || "/data";
const PUBLIC_DIR = path.join(__dirname, "public");
const CAPES_DIR = path.join(DATA_DIR, "capes");

if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 16) {
  console.error("Set ADMIN_PASSWORD to a strong password of at least 16 characters.");
  process.exit(1);
}
if (!COOKIE_SECRET || COOKIE_SECRET.length < 32) {
  console.error("Set COOKIE_SECRET to a random secret of at least 32 characters.");
  process.exit(1);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};
const FILES = {
  "/capes.json": path.join(DATA_DIR, "capes.json"),
  "/players.json": path.join(DATA_DIR, "players.json")
};
const MAX_BODY = 2 * 1024 * 1024;
const COOKIE_NAME = "civitas_admin";

function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function sign(value) {
  return crypto.createHmac("sha256", COOKIE_SECRET).update(value).digest("hex");
}
function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function isAuthed(req) {
  const token = parseCookies(req.headers.cookie || "")[COOKIE_NAME];
  if (!token) return false;
  const split = token.lastIndexOf(".");
  if (split < 1) return false;
  const payload = token.slice(0, split);
  const signature = token.slice(split + 1);
  if (!safeEqual(signature, sign(payload))) return false;
  const parts = payload.split(":");
  if (parts[0] !== "admin") return false;
  const issuedAt = Number(parts[1]);
  return Number.isFinite(issuedAt) && Date.now() - issuedAt < 12 * 60 * 60 * 1000 && issuedAt <= Date.now();
}
function send(res, status, body, type = "application/json; charset=utf-8", extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": type,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
    ...extraHeaders
  });
  res.end(Buffer.isBuffer(body) ? body : (typeof body === "string" ? body : JSON.stringify(body)));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}
function ensureData() {
  fs.mkdirSync(CAPES_DIR, { recursive: true });
  for (const name of ["capes.json", "players.json"]) {
    const target = path.join(DATA_DIR, name);
    const starter = path.join(__dirname, "data", name);
    if (!fs.existsSync(target)) fs.copyFileSync(starter, target);
  }
}
function validateJsonFile(name, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Root must be a JSON object.";
  if (value.schemaVersion !== 1) return "schemaVersion must be 1.";
  if (name === "capes.json") {
    if (!Array.isArray(value.capes)) return "capes must be an array.";
    const ids = new Set();
    for (const [i, cape] of value.capes.entries()) {
      if (!cape || typeof cape !== "object") return `capes[${i}] must be an object.`;
      if (typeof cape.id !== "string" || !cape.id.trim()) return `capes[${i}].id is required.`;
      if (ids.has(cape.id)) return `Duplicate cape id: ${cape.id}`;
      ids.add(cape.id);
      if (typeof cape.displayName !== "string" || !cape.displayName.trim()) return `capes[${i}].displayName is required.`;
      if (cape.type !== "URL") return `capes[${i}].type must be "URL".`;
      if (typeof cape.location !== "string" || !/^https?:\/\//i.test(cape.location)) return `capes[${i}].location must be an HTTP(S) URL.`;
    }
  } else if (name === "players.json") {
    if (!Array.isArray(value.players)) return "players must be an array.";
    const uuids = new Set();
    for (const [i, player] of value.players.entries()) {
      if (!player || typeof player !== "object") return `players[${i}] must be an object.`;
      if (typeof player.uuid !== "string" || !player.uuid.trim()) return `players[${i}].uuid is required.`;
      if (uuids.has(player.uuid.toLowerCase())) return `Duplicate player UUID: ${player.uuid}`;
      uuids.add(player.uuid.toLowerCase());
      if (!(typeof player.activeCape === "string" || player.activeCape === null)) return `players[${i}].activeCape must be a string or null.`;
      if (!Array.isArray(player.unlockedCapes) || !player.unlockedCapes.every(x => typeof x === "string")) return `players[${i}].unlockedCapes must be an array of strings.`;
      if (typeof player.capeEnabled !== "boolean") return `players[${i}].capeEnabled must be true or false.`;
      if (typeof player.capeForced !== "boolean") return `players[${i}].capeForced must be true or false.`;
    }
  } else return "Unknown file.";
  return null;
}
function atomicWrite(file, content) {
  const temp = file + "." + crypto.randomBytes(6).toString("hex") + ".tmp";
  fs.writeFileSync(temp, content, { encoding: "utf8", mode: 0o640 });
  fs.renameSync(temp, file);
}
function serveStatic(req, res, urlPath) {
  if (urlPath === "/") urlPath = "/index.html";
  if (urlPath === "/admin") urlPath = "/admin.html";
  if (FILES[urlPath]) {
    try { return send(res, 200, fs.readFileSync(FILES[urlPath], "utf8")); }
    catch { return send(res, 404, { error: "Not found" }); }
  }
  if (urlPath.startsWith("/capes/")) {
    const name = urlPath.slice("/capes/".length);
    if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) return send(res, 400, { error: "Invalid path" });
    const file = path.join(CAPES_DIR, name);
    try {
      const ext = path.extname(file).toLowerCase();
      if (![".png", ".jpg", ".jpeg", ".webp"].includes(ext)) return send(res, 403, { error: "File type not allowed" });
      return send(res, 200, fs.readFileSync(file), MIME[ext] || "application/octet-stream");
    } catch { return send(res, 404, { error: "Texture not found" }); }
  }
  const fileName = path.basename(urlPath);
  if (!["index.html", "admin.html", "styles.css", "admin.js"].includes(fileName)) return send(res, 404, { error: "Not found" });
  try {
    const file = path.join(PUBLIC_DIR, fileName);
    return send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || "application/octet-stream");
  } catch { return send(res, 404, { error: "Not found" }); }
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);

  if (req.method === "GET" && pathname === "/api/session") {
    return send(res, 200, { authenticated: isAuthed(req) });
  }
  if (req.method === "POST" && pathname === "/api/login") {
    try {
      const body = JSON.parse(await readBody(req));
      if (!safeEqual(body.password || "", ADMIN_PASSWORD)) return send(res, 401, { error: "Incorrect password." });
      const payload = `admin:${Date.now()}`;
      const token = `${payload}.${sign(payload)}`;
      return send(res, 200, { ok: true }, "application/json; charset=utf-8", {
        "Set-Cookie": `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200; Secure`
      });
    } catch { return send(res, 400, { error: "Invalid request." }); }
  }
  if (req.method === "POST" && pathname === "/api/logout") {
    return send(res, 200, { ok: true }, "application/json; charset=utf-8", {
      "Set-Cookie": `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0; Secure`
    });
  }
  if (pathname.startsWith("/api/")) {
    if (!isAuthed(req)) return send(res, 401, { error: "Sign in to edit files." });
    if (req.method === "GET" && pathname === "/api/capes.json") return send(res, 200, fs.readFileSync(FILES["/capes.json"], "utf8"), "application/json; charset=utf-8");
    if (req.method === "GET" && pathname === "/api/players.json") return send(res, 200, fs.readFileSync(FILES["/players.json"], "utf8"), "application/json; charset=utf-8");
    if (req.method === "PUT" && (pathname === "/api/capes.json" || pathname === "/api/players.json")) {
      const name = pathname.slice("/api/".length);
      try {
        const raw = await readBody(req);
        const parsed = JSON.parse(raw);
        const error = validateJsonFile(name, parsed);
        if (error) return send(res, 422, { error });
        atomicWrite(FILES["/" + name], JSON.stringify(parsed, null, 2) + "\n");
        return send(res, 200, { ok: true, message: `${name} saved.` });
      } catch (e) {
        if (e instanceof SyntaxError) return send(res, 422, { error: "Invalid JSON syntax." });
        return send(res, 400, { error: e.message || "Could not save file." });
      }
    }
    return send(res, 404, { error: "Unknown API endpoint." });
  }
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "Method not allowed." });
  return serveStatic(req, res, pathname);
});

ensureData();
server.listen(PORT, "0.0.0.0", () => console.log(`Civitas Capes host listening on port ${PORT}`));
