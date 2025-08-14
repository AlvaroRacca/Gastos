// Simple Express + SQLite backend for Gastos app
const express = require('express');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 8082;

app.use(express.json());

// Database setup (allow custom data dir for persistent disks)
const DATA_DIR = process.env.DATA_DIR || __dirname;
if (!fs.existsSync(DATA_DIR)) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
}
const DB_FILE = path.join(DATA_DIR, 'data.db');
const db = new sqlite3.Database(DB_FILE);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS meses (
    mes TEXT PRIMARY KEY,
    data TEXT NOT NULL
  )`);
});

// Helpers
function getAllMonths() {
  return new Promise((resolve, reject) => {
    db.all('SELECT mes, data FROM meses', (err, rows) => {
      if (err) return reject(err);
      const map = {};
      rows.forEach(r => { map[r.mes] = JSON.parse(r.data); });
      resolve(map);
    });
  });
}

function upsertMonth(mes, data) {
  return new Promise((resolve, reject) => {
    const json = JSON.stringify(data || {});
    db.run('INSERT INTO meses(mes, data) VALUES(?, ?) ON CONFLICT(mes) DO UPDATE SET data=excluded.data', [mes, json], (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function deleteMonth(mes) {
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM meses WHERE mes = ?', [mes], (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
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
