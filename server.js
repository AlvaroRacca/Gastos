// Simple Express + Postgres backend for Gastos app
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 8082;

app.use(express.json());

// Auth config
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const AUTH_SECRET = process.env.AUTH_SECRET || crypto.randomBytes(32).toString('hex');
const COOKIE_NAME = 'gastos_auth';
const COOKIE_MAX_AGE = 14 * 24 * 60 * 60; // 14 days seconds

// Database: Postgres (Neon) o archivo local JSON como fallback
const DATABASE_URL = process.env.DATABASE_URL;
const USE_FILE_DB = !DATABASE_URL;
const FILE_DB_PATH = path.join(__dirname, 'data.local.json');
if (USE_FILE_DB) {
  console.warn('DATABASE_URL no configurada. Usando almacenamiento local en archivo:', FILE_DB_PATH);
}
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL ? { rejectUnauthorized: false } : false,
});

// Template routes (protected)
app.get('/api/template', async (req, res) => {
  try {
    if (!isAuthed(req)) return res.status(401).json({ error: 'unauthorized' });
    const uid = readSession(req) ?? 0;
    const tpl = await getTemplateFor(uid);
    res.json({ template: tpl || null });
  } catch (e) {
    res.status(500).json({ error: 'template_get_error', details: String(e) });
  }
});
app.put('/api/template', async (req, res) => {
  try {
    if (!isAuthed(req)) return res.status(401).json({ error: 'unauthorized' });
    const uid = readSession(req) ?? 0;
    const { template } = req.body || {};
    if (!template || typeof template !== 'object') return res.status(400).json({ error: 'invalid_template' });
    await saveTemplateFor(uid, template);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'template_put_error', details: String(e) });
  }
});

async function initDb() {
  if (USE_FILE_DB) return; // nada que crear en modo archivo
  await pool.query(`CREATE TABLE IF NOT EXISTS meses (
    mes TEXT PRIMARY KEY,
    data JSONB NOT NULL
  )`);
  // Tabla de usuarios (para multiusuario).
  await pool.query(`CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    pass TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
  )`);
  // Plantilla por usuario
  await pool.query(`CREATE TABLE IF NOT EXISTS templates (
    uid INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
    data JSONB NOT NULL
  )`);
}
initDb().catch((e) => {
  console.error('Error creando tabla:', e);
});

// Helpers
function hmac(str) {
  return crypto.createHmac('sha256', AUTH_SECRET).update(String(str)).digest('hex');
}
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}
function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, saltB64, hashB64] = stored.split('$');
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  const got = crypto.scryptSync(password, salt, expected.length);
  return crypto.timingSafeEqual(got, expected);
}
// Session cookie: valor = `${uid}.${hmac(uid)}`
function parseCookies(req) {
  const header = req.headers['cookie'];
  if (!header) return {};
  return Object.fromEntries(header.split(';').map(c => {
    const i = c.indexOf('=');
    const k = decodeURIComponent(c.slice(0, i).trim());
    const v = decodeURIComponent(c.slice(i + 1));
    return [k, v];
  }));
}
function readSession(req) {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME] || '';
  const parts = token.split('.')
  if (parts.length !== 2) return null;
  const [uid, mac] = parts;
  if (hmac(uid) !== mac) return null;
  const id = Number(uid);
  return Number.isFinite(id) ? id : null;
}
function isAuthed(req) {
  const uid = readSession(req);
  return Number.isFinite(uid);
}
function setAuthCookie(res, uid) {
  const val = `${uid}.${hmac(String(uid))}`;
  const attrs = [
    `${COOKIE_NAME}=${encodeURIComponent(val)}`,
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${COOKIE_MAX_AGE}`,
    'Path=/'
  ];
  res.setHeader('Set-Cookie', attrs.join('; '));
}
function clearAuthCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/`);
}

async function readFileDb() {
  try {
    const raw = await fs.promises.readFile(FILE_DB_PATH, 'utf8');
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}
async function writeFileDb(obj) {
  await fs.promises.writeFile(FILE_DB_PATH, JSON.stringify(obj || {}, null, 2), 'utf8');
}

async function getAllMonths() {
  if (USE_FILE_DB) {
    return await readFileDb();
  } else {
    const { rows } = await pool.query('SELECT mes, data FROM meses');
    const map = {};
    rows.forEach((r) => { map[r.mes] = r.data || {}; });
    return map;
  }
}

async function upsertMonth(mes, data) {
  if (USE_FILE_DB) {
    const map = await readFileDb();
    map[mes] = data || {};
    await writeFileDb(map);
  } else {
    await pool.query(
      'INSERT INTO meses(mes, data) VALUES($1, $2) ON CONFLICT (mes) DO UPDATE SET data = EXCLUDED.data',
      [mes, data || {}]
    );
  }
}

async function deleteMonth(mes) {
  if (USE_FILE_DB) {
    const map = await readFileDb();
    delete map[mes];
    await writeFileDb(map);
  } else {
    await pool.query('DELETE FROM meses WHERE mes = $1', [mes]);
  }
}

// Template helpers per user
async function getTemplateFor(uid) {
  if (USE_FILE_DB) {
    const map = await readFileDb();
    const all = map.__templates || {};
    return all[String(uid)] || null;
  } else {
    const r = await pool.query('SELECT data FROM templates WHERE uid = $1', [uid]);
    return r.rows[0]?.data || null;
  }
}
async function saveTemplateFor(uid, data) {
  if (USE_FILE_DB) {
    const map = await readFileDb();
    map.__templates = map.__templates || {};
    map.__templates[String(uid)] = data || {};
    await writeFileDb(map);
  } else {
    await pool.query(
      'INSERT INTO templates(uid, data) VALUES($1, $2) ON CONFLICT (uid) DO UPDATE SET data = EXCLUDED.data',
      [uid, data || {}]
    );
  }
}

// API auth middleware (protect everything except login/logout)
app.use('/api', (req, res, next) => {
  if (req.path === '/login' || req.path === '/logout' || req.path === '/signup' || req.path === '/me') return next();
  if (!isAuthed(req)) return res.status(401).json({ error: 'unauthorized' });
  next();
});

// Auth routes
// GET current session info
app.get('/api/me', (req, res) => {
  const uid = readSession(req);
  if (!uid) return res.json({ ok: false });
  res.json({ ok: true, uid });
});
// Signup (multiusuario). Si APP_PASSWORD está definido, se permite igualmente crear usuarios y convivirán con el modo legacy.
app.post('/api/signup', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'missing_fields' });
    if (USE_FILE_DB) {
      const map = await readFileDb();
      map.__users = map.__users || [];
      if (map.__users.find(u => u.email === email)) return res.status(409).json({ error: 'email_taken' });
      const user = { id: (map.__users.at(-1)?.id || 0) + 1, email, pass: hashPassword(password) };
      map.__users.push(user);
      await writeFileDb(map);
      setAuthCookie(res, user.id);
      return res.json({ ok: true });
    } else {
      const existing = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email]);
      if (existing.rows.length) return res.status(409).json({ error: 'email_taken' });
      const hashed = hashPassword(password);
      const ins = await pool.query('INSERT INTO usuarios(email, pass) VALUES($1, $2) RETURNING id', [email, hashed]);
      const uid = ins.rows[0].id;
      setAuthCookie(res, uid);
      return res.json({ ok: true });
    }
  } catch (e) {
    res.status(500).json({ error: 'signup_error', details: String(e) });
  }
});
// Login: si viene {email,password} usar usuarios; si no, compat con APP_PASSWORD legacy
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {};
  try {
    if (email) {
      if (USE_FILE_DB) {
        const map = await readFileDb();
        const u = (map.__users || []).find(u => u.email === email);
        if (!u || !verifyPassword(password || '', u.pass)) return res.status(401).json({ error: 'invalid_credentials' });
        setAuthCookie(res, u.id);
        return res.json({ ok: true });
      } else {
        const r = await pool.query('SELECT id, pass FROM usuarios WHERE email = $1', [email]);
        if (!r.rows.length) return res.status(401).json({ error: 'invalid_credentials' });
        const u = r.rows[0];
        if (!verifyPassword(password || '', u.pass)) return res.status(401).json({ error: 'invalid_credentials' });
        setAuthCookie(res, u.id);
        return res.json({ ok: true });
      }
    }
    // Legacy APP_PASSWORD
    if (!APP_PASSWORD) return res.status(400).json({ error: 'missing_credentials' });
    if ((password || '') === APP_PASSWORD) {
      setAuthCookie(res, 0);
      return res.json({ ok: true, legacy: true });
    }
    return res.status(401).json({ error: 'invalid_password' });
  } catch (e) {
    res.status(500).json({ error: 'login_error', details: String(e) });
  }
});
app.post('/api/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

// API Routes (protected)
app.get('/api/data', async (req, res) => {
  try {
    const uid = readSession(req) ?? 0;
    const all = await getAllMonths();
    // Filtrar por usuario (keys con prefijo `${uid}:`), y devolver sin prefijo
    const out = {};
    for (const [k, v] of Object.entries(all)) {
      const p = `${uid}:`;
      if (k.startsWith(p)) out[k.slice(p.length)] = v;
    }
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: 'db_error', details: String(e) });
  }
});

app.put('/api/months/:mes', async (req, res) => {
  try {
    const uid = readSession(req) ?? 0;
    const mes = `${uid}:${req.params.mes}`;
    await upsertMonth(mes, req.body || {});
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'db_error', details: String(e) });
  }
});

app.delete('/api/months/:mes', async (req, res) => {
  try {
    const uid = readSession(req) ?? 0;
    const mes = `${uid}:${req.params.mes}`;
    await deleteMonth(mes);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'db_error', details: String(e) });
  }
});

app.get('/api/export', async (req, res) => {
  try {
    const uid = readSession(req) ?? 0;
    const all = await getAllMonths();
    const map = {};
    for (const [k, v] of Object.entries(all)) {
      const p = `${uid}:`;
      if (k.startsWith(p)) map[k.slice(p.length)] = v;
    }
    const rows = [['Mes','Internet','Expensa','Agua','Gas','Luz','Tarjeta','Auto','Cochera','Ingreso Catastro','Ingreso Admin','Total Depto','Total Otros','Total Ingresos','Gastos Totales','Balance']];
    const toNum = (v) => Number.parseFloat(v || '0') || 0;
    const calc = (d) => {
      const totalD = toNum(d.gExpensa)+toNum(d.gAgua)+toNum(d.gGas)+toNum(d.gLuz);
      const totalO = toNum(d.gInternet)+toNum(d.gTarjeta)+toNum(d.gAuto)+toNum(d.gCochera);
      const totalI = toNum(d.iCatastro)+toNum(d.iAdmin);
      const totalG = totalD + totalO; const bal = totalI - totalG;
      return { totalD, totalO, totalI, totalG, bal };
    };
    Object.keys(map).sort().forEach(m => {
      const d = map[m] || {};
      const t = calc(d);
      rows.push([
        m,
        d.gInternet||0,d.gExpensa||0,d.gAgua||0,d.gGas||0,d.gLuz||0,
        d.gTarjeta||0,d.gAuto||0,d.gCochera||0,
        d.iCatastro||0,d.iAdmin||0,
        t.totalD,t.totalO,t.totalI,t.totalG,t.bal
      ]);
    });
    const csv = rows.map(r => r.map(v => typeof v === 'string' ? '"'+v.replace(/"/g,'""')+'"' : String(v)).join(',')).join('\n');
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition','attachment; filename="gastos.csv"');
    res.send(csv);
  } catch (e) {
    res.status(500).json({ error: 'export_error', details: String(e) });
  }
});

// Static files
app.use(express.static(__dirname));

// HTML routing: if no auth, servir login.html; si authed, app
app.get('*', (req, res) => {
  const acceptsHtml = (req.headers['accept'] || '').includes('text/html') || req.path.endsWith('.html') || req.path === '/';
  if (!acceptsHtml) return res.status(404).end();
  if (!isAuthed(req)) {
    return res.sendFile(path.join(__dirname, 'login.html'));
  }
  return res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://127.0.0.1:${PORT}`);
});
