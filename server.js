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

async function initDb() {
  if (USE_FILE_DB) return; // nada que crear en modo archivo
  await pool.query(`CREATE TABLE IF NOT EXISTS meses (
    mes TEXT PRIMARY KEY,
    data JSONB NOT NULL
  )`);
}
initDb().catch((e) => {
  console.error('Error creando tabla:', e);
});

// Helpers
function signAuth() {
  return crypto.createHmac('sha256', AUTH_SECRET).update('auth').digest('hex');
}
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
function isAuthed(req) {
  const cookies = parseCookies(req);
  return cookies[COOKIE_NAME] === signAuth();
}
function setAuthCookie(res) {
  const val = signAuth();
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

// API auth middleware (protect everything except login/logout)
app.use('/api', (req, res, next) => {
  if (req.path === '/login' || req.path === '/logout') return next();
  if (!isAuthed(req)) return res.status(401).json({ error: 'unauthorized' });
  next();
});

// Auth routes
app.post('/api/login', (req, res) => {
  if (!APP_PASSWORD) return res.status(500).json({ error: 'server_password_not_set' });
  const { password } = req.body || {};
  if (password === APP_PASSWORD) {
    setAuthCookie(res);
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: 'invalid_password' });
});
app.post('/api/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

// API Routes (protected)
app.get('/api/data', async (req, res) => {
  try {
    const map = await getAllMonths();
    res.json(map);
  } catch (e) {
    res.status(500).json({ error: 'db_error', details: String(e) });
  }
});

app.put('/api/months/:mes', async (req, res) => {
  try {
    const mes = req.params.mes;
    await upsertMonth(mes, req.body || {});
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'db_error', details: String(e) });
  }
});

app.delete('/api/months/:mes', async (req, res) => {
  try {
    const mes = req.params.mes;
    await deleteMonth(mes);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'db_error', details: String(e) });
  }
});

app.get('/api/export', async (req, res) => {
  try {
    const map = await getAllMonths();
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
