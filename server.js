const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || '/data';
const PUBLIC_HOST = (process.env.PUBLIC_HOST || 'capedatabase.teamcivitas.net').toLowerCase();
const ADMIN_HOST = (process.env.ADMIN_HOST || 'capeadmin.teamcivitas.net').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const COOKIE_SECRET = process.env.COOKIE_SECRET || '';
const ACCESS_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
const CAPE_PLATFORM_API_SECRET = process.env.CAPE_PLATFORM_API_SECRET || '';
const SESSION_MS = 12 * 60 * 60 * 1000;

if (ADMIN_PASSWORD.length < 16) throw new Error('ADMIN_PASSWORD must be at least 16 characters.');
if (COOKIE_SECRET.length < 32) throw new Error('COOKIE_SECRET must be at least 32 characters.');
if (PUBLIC_HOST === ADMIN_HOST) throw new Error('PUBLIC_HOST and ADMIN_HOST must be different.');

const sessions = new Map();

const rateLimits = new Map();

function getClientIp(req) {
  // Cloudflare provides the original visitor IP.
  const cfIp = req.headers['cf-connecting-ip'];

  if (typeof cfIp === 'string' && cfIp.trim()) {
    return cfIp.trim();
  }

  return req.socket.remoteAddress || 'unknown';
}

function rateLimit(req, res, options) {
  const { key, max, windowMs } = options;
  const now = Date.now();
  const ip = getClientIp(req);
  const bucketKey = `${key}:${ip}`;

  let entry = rateLimits.get(bucketKey);

  if (!entry || now >= entry.resetAt) {
    entry = {
      count: 0,
      resetAt: now + windowMs
    };
  }

  if (entry.count >= max) {
    const retryAfter = Math.max(
      1,
      Math.ceil((entry.resetAt - now) / 1000)
    );

    json(res, 429, {
      error: 'Too many requests',
      retryAfter
    }, {
      'Retry-After': String(retryAfter)
    });

    return false;
  }

  entry.count++;
  rateLimits.set(bucketKey, entry);

  return true;
}

// Remove expired entries periodically to prevent memory growth.
const rateLimitCleanup = setInterval(() => {
  const now = Date.now();

  for (const [key, entry] of rateLimits) {
    if (now >= entry.resetAt) {
      rateLimits.delete(key);
    }
  }
}, 60_000);

rateLimitCleanup.unref();

const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8' };

function hostOf(req) { return String(req.headers.host || '').split(':')[0].toLowerCase(); }
function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': buf.length, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Cache-Control': 'no-store', ...extra });
  res.end(buf);
}
function json(res, status, obj, extra = {}) { send(res, status, JSON.stringify(obj), 'application/json; charset=utf-8', extra); }
function parseCookies(req) {
  const out = {}; for (const part of String(req.headers.cookie || '').split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim(); } return out;
}
function sign(value) { return crypto.createHmac('sha256', COOKIE_SECRET).update(value).digest('hex'); }
function sessionFor(req) {
  const raw = parseCookies(req).civitas_admin; if (!raw) return null;
  const [id, exp, sig] = raw.split('.'); if (!id || !exp || !sig || Number(exp) < Date.now()) return null;
  const expected = sign(id + '.' + exp);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const s = sessions.get(id); if (!s || s.exp !== Number(exp)) return null;
  return s;
}
function cookie(id, exp) { const value = id + '.' + exp; return `civitas_admin=${value}.${sign(value)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${Math.floor((exp - Date.now()) / 1000)}`; }
async function body(req, max = 2 * 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > max) throw new Error('Request too large'); chunks.push(c); }
  return Buffer.concat(chunks);
}
async function readJson(name) {
  const p = path.join(DATA_DIR, name);
  try { return JSON.parse(await fs.readFile(p, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return name === 'capes.json' ? { schemaVersion: 1, capes: [] } : { schemaVersion: 1, players: [] }; throw e; }
}
async function writeJson(name, obj) {
  const tmp = path.join(DATA_DIR, name + '.tmp');
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2) + '\n', { mode: 0o600 });
  await fs.rename(tmp, path.join(DATA_DIR, name));
}
function validateCatalog(x) {
  if (!x || x.schemaVersion !== 1 || !Array.isArray(x.capes)) throw new Error('Expected schemaVersion 1 and a capes array.');
  const ids = new Set();
  for (const c of x.capes) {
    if (!c || !/^[a-z0-9_-]{1,48}$/.test(c.id || '')) throw new Error('Each cape needs a valid id (a-z, 0-9, _ or -).');
    if (ids.has(c.id)) throw new Error('Duplicate cape id: ' + c.id); ids.add(c.id);
    if (typeof c.displayName !== 'string' || !c.displayName.trim()) throw new Error('Each cape needs a displayName.');
    if (c.type !== 'URL' || typeof c.location !== 'string' || !/^https?:\/\//i.test(c.location)) throw new Error('Each cape needs type URL and an http(s) location.');
  }
}
function validatePlayers(x, catalog) {
  if (!x || x.schemaVersion !== 1 || !Array.isArray(x.players)) throw new Error('Expected schemaVersion 1 and a players array.');
  const ids = new Set(), capes = new Set(catalog.capes.map(c => c.id));
  for (const p of x.players) {
    if (!p || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p.uuid || '')) throw new Error('Each player needs a valid UUID.');
    if (ids.has(p.uuid)) throw new Error('Duplicate player UUID: ' + p.uuid); ids.add(p.uuid);
    if (p.activeCape && !capes.has(p.activeCape)) throw new Error('Unknown active cape for ' + p.uuid + ': ' + p.activeCape);
    if (!Array.isArray(p.unlockedCapes) || p.unlockedCapes.some(id => !capes.has(id))) throw new Error('Invalid unlockedCapes for ' + p.uuid);
    if (typeof p.capeEnabled !== 'boolean' || typeof p.capeForced !== 'boolean') throw new Error('capeEnabled and capeForced must be booleans.');
  }
}
function adminGate(req, res) {
  const s = sessionFor(req); if (!s) { json(res, 401, { error: 'Authentication required' }); return null; }
  const csrf = req.headers['x-civitas-csrf'];
  if (!csrf || csrf !== s.csrf) { json(res, 403, { error: 'Invalid CSRF token' }); return null; }
  const origin = req.headers.origin;
  if (origin && new URL(origin).host.toLowerCase() !== ADMIN_HOST) { json(res, 403, { error: 'Invalid origin' }); return null; }
  return s;
}
async function publicRoute(req, res, url) {


  // Rate limiting for public endpoints.

  if (
    req.method === 'POST' &&
    url.pathname === '/api/integration/active-cape'
  ) {
    if (!rateLimit(req, res, {
      key: 'integration',
      max: 20,
      windowMs: 60_000
    })) return;
  }

  if (
    req.method === 'GET' &&
    (url.pathname === '/capes.json' ||
      url.pathname === '/players.json')
  ) {
    if (!rateLimit(req, res, {
      key: 'public-json',
      max: 120,
      windowMs: 60_000
    })) return;
  }

  if (
    req.method === 'GET' &&
    url.pathname.startsWith('/capes/')
  ) {
    if (!rateLimit(req, res, {
      key: 'cape-images',
      max: 300,
      windowMs: 60_000
    })) return;
  }

  // Player Platform integration: change a player's active cape.
  if (req.method === 'POST' && url.pathname === '/api/integration/active-cape') {
    if (!CAPE_PLATFORM_API_SECRET) {
      return json(res, 503, { error: 'Integration is not configured' });
    }

    const authorization = String(req.headers.authorization || '');
    const suppliedSecret = authorization.startsWith('Bearer ')
      ? authorization.slice(7)
      : '';

    const expected = Buffer.from(CAPE_PLATFORM_API_SECRET);
    const supplied = Buffer.from(suppliedSecret);

    if (
      supplied.length !== expected.length ||
      !crypto.timingSafeEqual(supplied, expected)
    ) {
      return json(res, 401, { error: 'Unauthorized' });
    }

    let input;

    try {
      input = JSON.parse((await body(req, 8192)).toString('utf8'));
    } catch {
      return json(res, 400, { error: 'Invalid JSON body' });
    }

    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return json(res, 400, { error: 'Invalid request body' });
    }

    const uuid = String(input.uuid || '').toLowerCase();
    const capeId = String(input.capeId || '');

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid)) {
      return json(res, 400, { error: 'Invalid UUID' });
    }

    if (!/^[a-z0-9_-]{1,48}$/.test(capeId)) {
      return json(res, 400, { error: 'Invalid cape ID' });
    }

    const catalog = await readJson('capes.json');
    const playersData = await readJson('players.json');

    const capeExists = catalog.capes.some(cape => cape.id === capeId);

    if (!capeExists) {
      return json(res, 404, { error: 'Cape not found' });
    }

    const player = playersData.players.find(
      entry => entry.uuid.toLowerCase() === uuid
    );

    if (!player) {
      return json(res, 404, { error: 'Player not found' });
    }

    if (!player.unlockedCapes.includes(capeId)) {
      return json(res, 403, { error: 'Cape is not unlocked' });
    }

    player.activeCape = capeId;

    await writeJson('players.json', playersData);

    return json(res, 200, {
      ok: true,
      uuid,
      activeCape: capeId
    });
  }

  if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true });
  if (req.method === 'GET' && (url.pathname === '/capes.json' || url.pathname === '/players.json')) {
    const name = url.pathname.slice(1); const data = await readJson(name);
    return send(res, 200, JSON.stringify(data), 'application/json; charset=utf-8', { 'Cache-Control': 'public, max-age=15' });
  }
  if (req.method === 'GET' && url.pathname.startsWith('/capes/')) {
    const name = path.basename(decodeURIComponent(url.pathname.slice('/capes/'.length)));
    if (!/^[a-zA-Z0-9._-]+\.(png|jpg|jpeg|webp)$/i.test(name)) return json(res, 404, { error: 'Not found' });
    try { const p = path.join(DATA_DIR, 'capes', name); const data = await fs.readFile(p); return send(res, 200, data, mime[path.extname(name).toLowerCase()] || 'application/octet-stream', { 'Cache-Control': 'public, max-age=300' }); }
    catch (e) { if (e.code === 'ENOENT') return json(res, 404, { error: 'Cape not found' }); throw e; }
  }
  return json(res, 404, { error: 'Not found' });
}
async function adminRoute(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/') return send(res, 200, await fs.readFile(path.join(__dirname, 'public/admin.html'), 'utf8'), 'text/html; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/admin.js') return send(res, 200, await fs.readFile(path.join(__dirname, 'public/admin.js'), 'utf8'), 'text/javascript; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/styles.css') return send(res, 200, await fs.readFile(path.join(__dirname, 'public/styles.css'), 'utf8'), 'text/css; charset=utf-8');
  if (req.method === 'POST' && url.pathname === '/api/login') {
    if (!rateLimit(req, res, {
      key: 'admin-login',
      max: 10,
      windowMs: 15 * 60_000
    })) return;
    const b = JSON.parse((await body(req, 8192)).toString('utf8'));
    const a = Buffer.from(String(b.password || '')), expected = Buffer.from(ADMIN_PASSWORD);
    if (a.length !== expected.length || !crypto.timingSafeEqual(a, expected)) return json(res, 401, { error: 'Incorrect password' });
    const id = crypto.randomBytes(24).toString('hex'), exp = Date.now() + SESSION_MS, csrf = crypto.randomBytes(24).toString('hex');
    sessions.set(id, { exp, csrf }); return json(res, 200, { ok: true, csrf }, { 'Set-Cookie': cookie(id, exp) });
  }
  if (req.method === 'POST' && url.pathname === '/api/logout') {
    const s = sessionFor(req); if (s) { for (const [id, v] of sessions) if (v === s) sessions.delete(id); }
    return json(res, 200, { ok: true }, { 'Set-Cookie': 'civitas_admin=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0' });
  }
  if (req.method === 'GET' && url.pathname === '/api/session') {
    const s = sessionFor(req); return s ? json(res, 200, { authenticated: true, csrf: s.csrf }) : json(res, 200, { authenticated: false });
  }
  if (url.pathname.startsWith('/api/')) {
    const s = adminGate(req, res); if (!s) return;
    if (req.method === 'GET' && url.pathname === '/api/data') return json(res, 200, { capes: await readJson('capes.json'), players: await readJson('players.json') });
    if (req.method === 'PUT' && url.pathname === '/api/capes') {
      const x = JSON.parse((await body(req)).toString('utf8')); validateCatalog(x); await writeJson('capes.json', x); return json(res, 200, { ok: true });
    }
    if (req.method === 'PUT' && url.pathname === '/api/players') {
      const x = JSON.parse((await body(req)).toString('utf8')); validatePlayers(x, await readJson('capes.json')); await writeJson('players.json', x); return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/upload') {
      const filename = String(req.headers['x-file-name'] || '').replace(/[^a-zA-Z0-9._-]/g, '_');
      if (!/^[a-zA-Z0-9_-]{1,48}\.(png|jpg|jpeg|webp)$/i.test(filename)) return json(res, 400, { error: 'Filename must be a simple name ending in png, jpg, jpeg or webp.' });
      const type = String(req.headers['content-type'] || '').toLowerCase();
      const allowed = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
      if (!allowed[type] || !filename.toLowerCase().endsWith('.' + allowed[type]) && !(allowed[type] === 'jpg' && filename.toLowerCase().endsWith('.jpeg'))) return json(res, 415, { error: 'Unsupported image type or extension.' });
      const data = await body(req, 5 * 1024 * 1024);
      const sigs = { 'image/png': '89504e470d0a1a0a', 'image/jpeg': 'ffd8ff', 'image/webp': '52494646' };
      if (data.length < 12 || !data.subarray(0, sigs[type].length).toString('hex').startsWith(sigs[type])) return json(res, 400, { error: 'File content does not match image type.' });
      await fs.mkdir(path.join(DATA_DIR, 'capes'), { recursive: true });
      await fs.writeFile(path.join(DATA_DIR, 'capes', filename), data, { mode: 0o644 });
      return json(res, 200, { ok: true, filename, url: `https://${PUBLIC_HOST}/capes/${encodeURIComponent(filename)}` });
    }
  }
  return json(res, 404, { error: 'Not found' });
}
const server = http.createServer(async (req, res) => {
  try {
    const host = hostOf(req), url = new URL(req.url, 'http://localhost');
    if (host === PUBLIC_HOST) return await publicRoute(req, res, url);
    if (host === ADMIN_HOST) return await adminRoute(req, res, url);
    return json(res, 421, { error: 'Unknown host' });
  } catch (e) { console.error(e); return json(res, 500, { error: e.message || 'Internal server error' }); }
});
server.listen(PORT, '0.0.0.0', () => console.log(`Civitas Capes listening on ${PORT}; public=${PUBLIC_HOST}; admin=${ADMIN_HOST}`));
