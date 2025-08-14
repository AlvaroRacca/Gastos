// Simple Express + Postgres backend for Gastos app
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 8082;

app.use(express.json());

// Database: Postgres (Neon free tier compatible)
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.warn('DATABASE_URL no está configurada. Configure una conexión a Postgres (Neon).');
}
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL ? { rejectUnauthorized: false } : false,
});

async function initDb() {
  await pool.query(`CREATE TABLE IF NOT EXISTS meses (
    mes TEXT PRIMARY KEY,
    data JSONB NOT NULL
  )`);
}
initDb().catch((e) => {
  console.error('Error creando tabla:', e);
});

// Helpers
async function getAllMonths() {
  const { rows } = await pool.query('SELECT mes, data FROM meses');
  const map = {};
  rows.forEach((r) => { map[r.mes] = r.data || {}; });
  return map;
}

async function upsertMonth(mes, data) {
  await pool.query(
    'INSERT INTO meses(mes, data) VALUES($1, $2) ON CONFLICT (mes) DO UPDATE SET data = EXCLUDED.data',
    [mes, data || {}]
  );
}

async function deleteMonth(mes) {
  await pool.query('DELETE FROM meses WHERE mes = $1', [mes]);
}

// API Routes
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
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://127.0.0.1:${PORT}`);
});
