/* global React, ReactDOM, Chart */

// REST API helper (with credentials)
const api = {
  async _fetch(path, opts={}) {
    const res = await fetch(path, { credentials: 'include', ...opts });
    if (res.status === 401) {
      const err = new Error('unauthorized');
      err.status = 401;
      throw err;
    }
    return res;
  },
  async getAll() {
    const res = await this._fetch('/api/data');
    if (!res.ok) throw new Error('Error al cargar datos');
    return res.json();
  },
  async set(month, value) {
    const res = await this._fetch(`/api/months/${encodeURIComponent(month)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value)
    });
    if (!res.ok) throw new Error('Error al guardar');
  },
  async del(month) {
    const res = await this._fetch(`/api/months/${encodeURIComponent(month)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Error al borrar');
  },
  async exportCSV() {
    const res = await this._fetch('/api/export');
    if (!res.ok) throw new Error('Error al exportar');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'gastos.csv'; a.click();
    URL.revokeObjectURL(url);
  },
  async login(password) {
    const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ password }) });
    if (res.status === 401) throw new Error('Clave incorrecta');
    if (!res.ok) throw new Error('Error de login');
    return res.json();
  },
  async logout() {
    await fetch('/api/logout', { method: 'POST', credentials: 'include' });
  }
};

const fmt = (n) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n || 0);
const toNum = (v) => Number.parseFloat(v || '0') || 0;

function useForm(initial) {
  const [form, setForm] = React.useState(initial);
  const update = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setAll = (obj) => setForm({ ...initial, ...obj });
  return { form, update, setAll };
}

function calcTotals(d) {
  const totalD = toNum(d.gExpensa) + toNum(d.gAgua) + toNum(d.gGas) + toNum(d.gLuz);
  const totalO = toNum(d.gInternet) + toNum(d.gTarjeta) + toNum(d.gAuto) + toNum(d.gCochera);
  const totalI = toNum(d.iCatastro) + toNum(d.iAdmin);
  const totalG = totalD + totalO;
  const bal = totalI - totalG;
  return { totalD, totalO, totalI, totalG, bal };
}

function MonthsChart({ dataMap }) {
  const canvasRef = React.useRef(null);
  const chartRef = React.useRef(null);

  React.useEffect(() => {
    const ctx = canvasRef.current.getContext('2d');
    if (chartRef.current) {
      chartRef.current.destroy();
    }
    const months = Object.keys(dataMap).sort();
    const gastos = months.map((m) => {
      const d = dataMap[m] || {};
      const { totalD, totalO } = calcTotals(d);
      return totalD + totalO;
    });
    const ingresos = months.map((m) => {
      const d = dataMap[m] || {};
      const { totalI } = calcTotals(d);
      return totalI;
    });
    chartRef.current = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: months,
        datasets: [
          {
            label: 'Gastos Totales',
            data: gastos,
            backgroundColor: '#ef4444',
          },
          {
            label: 'Ingresos Totales',
            data: ingresos,
            backgroundColor: '#22c55e',
          }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { labels: { color: '#e5e7eb' } },
        },
        scales: {
          x: { ticks: { color: '#9ca3af' }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { ticks: { color: '#9ca3af' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        }
      }
    });
  }, [dataMap]);

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h3>Resumen por Mes</h3>
      <canvas ref={canvasRef} height="100"></canvas>
    </div>
  );
}

function App() {
  const [monthsMap, setMonthsMap] = React.useState({});
  const [month, setMonth] = React.useState(() => new Date().toISOString().slice(0,7));
  const [showReceipt, setShowReceipt] = React.useState(false);
  const [showLogin, setShowLogin] = React.useState(false);
  const [isAuthed, setIsAuthed] = React.useState(false);
  const { form, update, setAll } = useForm({
    gExpensa: '', gAgua: '', gGas: '', gLuz: '',
    gInternet: '', gTarjeta: '', gAuto: '', gCochera: '',
    iCatastro: '', iAdmin: ''
  });

  const totals = React.useMemo(() => calcTotals(form), [form]);

  const loadAll = React.useCallback(async () => {
    try {
      const all = await api.getAll();
      setMonthsMap(all);
      setIsAuthed(true);
    } catch (e) {
      if (e.status === 401) {
        setShowLogin(true);
        setIsAuthed(false);
      } else {
        throw e;
      }
    }
  }, []);

  const loadMonth = React.useCallback((m) => {
    setMonth(m);
    const data = monthsMap[m] || {};
    setAll(data);
  }, [monthsMap, setAll]);

  React.useEffect(() => { loadAll(); }, [loadAll]);
  // One-time migration from previous localStorage storage if present (send to backend)
  React.useEffect(() => {
    (async () => {
      if (Object.keys(monthsMap).length > 0) return;
      try {
        const raw = localStorage.getItem('gastos_app_v1');
        if (!raw) return;
        const parsed = JSON.parse(raw || '{}');
        const keys = Object.keys(parsed || {});
        if (!keys.length) return;
        for (const k of keys) { await api.set(k, parsed[k]); }
        await loadAll();
      } catch {}
    })();
  }, [monthsMap, loadAll]);
  React.useEffect(() => {
    // when monthsMap updates, if current month exists use it else clear
    const data = monthsMap[month] || {};
    setAll(data);
  }, [monthsMap]);

  const onNew = () => {
    const m = new Date().toISOString().slice(0,7);
    setMonth(m);
    setAll({});
  };

  const onSave = async () => {
    try { await api.set(month, form); await loadAll(); }
    catch (e) { if (e.status === 401) setShowLogin(true); else throw e; }
  };

  const onDelete = async () => {
    try { await api.del(month); await loadAll(); setAll({}); }
    catch (e) { if (e.status === 401) setShowLogin(true); else throw e; }
  };

  const onExport = async () => {
    try { await api.exportCSV(); } catch (e) { if (e.status === 401) setShowLogin(true); else throw e; }
  };

  const onPrintDepto = () => setShowReceipt(true);

  function ReceiptDepto({ month, form, onClose }) {
    const d = { ...form };
    const items = [
      { label: 'Expensa', value: toNum(d.gExpensa) },
      { label: 'Agua', value: toNum(d.gAgua) },
      { label: 'Gas', value: toNum(d.gGas) },
      { label: 'Luz', value: toNum(d.gLuz) },
    ].filter(it => toNum(it.value) > 0);
    const total = items.reduce((s, it) => s + toNum(it.value), 0);
    return (
      <div className="receipt-overlay" role="dialog" aria-modal="true">
        <div className="receipt-sheet">
          <h1>Gastos Departamento - {month}</h1>
          <div className="meta">Fecha: {new Date().toLocaleDateString()}</div>
          <table>
            <thead>
              <tr><th>Concepto</th><th className="right">Importe</th></tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr><td colSpan={2}>Sin cargos para este mes</td></tr>
              ) : (
                items.map((it) => (
                  <tr key={it.label}><td>{it.label}</td><td className="right">{fmt(toNum(it.value))}</td></tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr><td className="total">Total a pagar al Depto</td><td className="right total">{fmt(total)}</td></tr>
            </tfoot>
          </table>
          <div className="actions">
            <button className="btn" onClick={() => window.print()}>Imprimir</button>
            <button className="btn" onClick={onClose}>Cerrar</button>
          </div>
        </div>
      </div>
    );
  }

  const monthKeys = Object.keys(monthsMap).sort().reverse();

  return (
    <div className="app compact">
      <header className="app-header">
        <h1>Control de Gastos</h1>
        <div className="header-actions">
          <label className="month-label">
            Mes
            <input type="month" value={month} onChange={(e)=>loadMonth(e.target.value)} />
          </label>
          <button className="btn" onClick={onNew}>Nuevo Mes</button>
          {isAuthed && <button className="btn" onClick={async()=>{ await api.logout(); setIsAuthed(false); setShowLogin(true); }}>Salir</button>}
        </div>
      </header>

      <main className="app-main">
        <aside className="months-sidebar">
          <h2>Meses guardados</h2>
          <ul className="months-list">
            {monthKeys.map((m) => (
              <li key={m} className={m===month? 'active' : ''}>
                <span>{m}</span>
                <div className="month-actions">
                  <button className="btn" onClick={()=>loadMonth(m)}>Cargar</button>
                  <button className="btn btn-danger" onClick={async()=>{ await api.del(m); await loadAll(); }}>Borrar</button>
                </div>
              </li>
            ))}
          </ul>
          <button className="btn btn-secondary" onClick={onExport}>Exportar CSV</button>
        </aside>

        <section className="content">
          <div className="cards-grid">
            <div className="card" style={{ margin: 10}}>
              <h3>Gastos departamento</h3>
              <div className="form-grid">
                <label>Expensa<input type="number" min="0" step="1" value={form.gExpensa} onChange={update('gExpensa')} placeholder="0" /></label>
                <label>Agua<input type="number" min="0" step="1" value={form.gAgua} onChange={update('gAgua')} placeholder="0" /></label>
                <label>Gas<input type="number" min="0" step="1" value={form.gGas} onChange={update('gGas')} placeholder="0" /></label>
                <label>Luz<input type="number" min="0" step="1" value={form.gLuz} onChange={update('gLuz')} placeholder="0" /></label>
              </div>
              <div className="totals-row">
                <span>Total</span>
                <strong>{fmt(totals.totalD)}</strong>
              </div>
            </div>
 
            <div className="card" style={{ margin: 10}}>
              <h3>Otros gastos</h3>
              <div className="form-grid">
                <label>Internet<input type="number" min="0" step="1" value={form.gInternet} onChange={update('gInternet')} placeholder="0" /></label>
                <label>Tarjeta<input type="number" min="0" step="1" value={form.gTarjeta} onChange={update('gTarjeta')} placeholder="0" /></label>
                <label>Auto<input type="number" min="0" step="1" value={form.gAuto} onChange={update('gAuto')} placeholder="0" /></label>
                <label>Cochera<input type="number" min="0" step="1" value={form.gCochera} onChange={update('gCochera')} placeholder="0" /></label>
              </div>
              <div className="totals-row">
                <span>Total</span>
                <strong>{fmt(totals.totalO)}</strong>
              </div>
            </div>

            <div className="card" style={{ margin: 10}}>
              <h3>Ingresos</h3>
              <div className="form-grid">
                <label>Catastro<input type="number" min="0" step="1" value={form.iCatastro} onChange={update('iCatastro')} placeholder="0" /></label>
                <label>Administrador/Profe<input type="number" min="0" step="1" value={form.iAdmin} onChange={update('iAdmin')} placeholder="0" /></label>
              </div>
              <div className="totals-row">
                <span>Total</span>
                <strong>{fmt(totals.totalI)}</strong>
              </div>
            </div>

            <div className="card" >
              <h3>Resumen</h3>
              <div className="summary-grid">
                <div className="summary-item">
                  <span>A pagar depto: </span>
                  <strong>{fmt(totals.totalD)}</strong>
                </div>
                <div className="summary-item">
                  <span>Gastos Totales: </span>
                  <strong>{fmt(totals.totalG)}</strong>
                </div>
                <div className="summary-item">
                  <span>Balance (Ingresos - Gastos): </span>
                  <strong>{fmt(totals.bal)}</strong>
                </div>
              </div>
              <div className="actions">
                <button className="btn btn-primary" onClick={onSave}>Guardar Mes</button>
                <button className="btn btn-danger" onClick={onDelete}>Eliminar Mes</button>
                <button className="btn" onClick={onPrintDepto}>Imprimir Depto</button>
              </div>
            </div>

          </div>
        </section>
      </main>

      <footer className="app-footer">
        <div style={{ marginTop: 12 }}>
          <MonthsChart dataMap={monthsMap} />
        </div>
      </footer>

      {showReceipt && (
        <ReceiptDepto
          month={month}
          form={form}
          onClose={() => setShowReceipt(false)}
        />
      )}

      {showLogin && (
        <LoginModal
          onLogin={async (pwd) => {
            await api.login(pwd);
            setShowLogin(false);
            await loadAll();
          }}
          onClose={() => setShowLogin(false)}
        />
      )}
    </div>
  );
}

function LoginModal({ onLogin, onClose }) {
  const [pwd, setPwd] = React.useState('');
  const [err, setErr] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try { await onLogin(pwd); } catch (ex) { setErr(ex.message || 'Error'); } finally { setBusy(false); }
  };
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-card">
        <h2>Acceso</h2>
        <form onSubmit={submit}>
          <label className="form-field">Contraseña
            <input type="password" value={pwd} onChange={(e)=>setPwd(e.target.value)} placeholder="••••••" autoFocus />
          </label>
          {err && <div className="form-error">{err}</div>}
          <div className="actions">
            <button className="btn btn-primary" type="submit" disabled={busy}>{busy? 'Ingresando…':'Ingresar'}</button>
            <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          </div>
        </form>
        <p className="hint">Configura APP_PASSWORD en el servidor.</p>
      </div>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
