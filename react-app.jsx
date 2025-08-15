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
  async getTemplate() {
    const res = await this._fetch('/api/template');
    if (!res.ok) throw new Error('Error al cargar plantilla');
    return res.json(); // { template: {...} | null }
  },
  async saveTemplate(template) {
    const res = await this._fetch('/api/template', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ template }) });
    if (!res.ok) throw new Error('Error al guardar plantilla');
    return res.json();
  },
  async login(creds) {
    // creds puede ser string (password legacy) o { email, password }
    const body = typeof creds === 'string' ? { password: creds } : (creds || {});
    const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) });
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

// Template de campos (se puede editar y se guarda en localStorage)
const TEMPLATE_STORAGE_KEY = 'gastos_template_v1';
const defaultTemplate = {
  depto: [
    { key: 'gExpensa', label: 'Expensa' },
    { key: 'gAgua', label: 'Agua' },
    { key: 'gGas', label: 'Gas' },
    { key: 'gLuz', label: 'Luz' },
  ],
  otros: [
    { key: 'gInternet', label: 'Internet' },
    { key: 'gTarjeta', label: 'Tarjeta' },
    { key: 'gAuto', label: 'Auto' },
    { key: 'gCochera', label: 'Cochera' },
  ],
  ingresos: [
    { key: 'iCatastro', label: 'Catastro' },
    { key: 'iAdmin', label: 'Administrador/Profe' },
  ],
};

function useForm(initial) {
  const [form, setForm] = React.useState(initial);
  const update = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setAll = (obj) => setForm({ ...initial, ...obj });
  return { form, update, setAll };
}

function calcTotals(d, template) {
  const sumKeys = (arr) => arr.reduce((s, f) => s + toNum(d[f.key]), 0);
  const totalD = sumKeys(template.depto || []);
  const totalO = sumKeys(template.otros || []);
  const totalI = sumKeys(template.ingresos || []);
  const totalG = totalD + totalO;
  const bal = totalI - totalG;
  return { totalD, totalO, totalI, totalG, bal };
}

function MonthsChart({ dataMap, template }) {
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
      const { totalD, totalO } = calcTotals(d, template);
      return totalD + totalO;
    });
    const ingresos = months.map((m) => {
      const d = dataMap[m] || {};
      const { totalI } = calcTotals(d, template);
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
  const [showPrintMonth, setShowPrintMonth] = React.useState(false);
  const [showLogin, setShowLogin] = React.useState(false);
  const [isAuthed, setIsAuthed] = React.useState(false);
  const [editMode, setEditMode] = React.useState(true); // habilitar/deshabilitar edición de valores
  const [showTplEditor, setShowTplEditor] = React.useState(false);
  const [template, setTemplate] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem(TEMPLATE_STORAGE_KEY) || 'null') || defaultTemplate; } catch { return defaultTemplate; }
  });
  const { form, update, setAll } = useForm({
    gExpensa: '', gAgua: '', gGas: '', gLuz: '',
    gInternet: '', gTarjeta: '', gAuto: '', gCochera: '',
    iCatastro: '', iAdmin: ''
  });

  const totals = React.useMemo(() => calcTotals(form, template), [form, template]);

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
  // Load template from backend after auth
  React.useEffect(() => {
    (async () => {
      if (!isAuthed) return;
      try {
        const res = await api.getTemplate();
        const remote = res?.template;
        if (remote && typeof remote === 'object') {
          setTemplate(remote);
        }
      } catch {}
    })();
  }, [isAuthed]);
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

  // Guardar template al cambiar
  const tplSaveTimer = React.useRef(null);
  const tplDidLoad = React.useRef(false);
  React.useEffect(() => {
    // persist also in localStorage for offline/fallback
    try { localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(template)); } catch {}
    // debounce save to backend if authed
    if (!isAuthed) return;
    if (tplSaveTimer.current) clearTimeout(tplSaveTimer.current);
    tplSaveTimer.current = setTimeout(async () => {
      try { await api.saveTemplate(template); } catch {}
    }, 400);
    return () => { if (tplSaveTimer.current) clearTimeout(tplSaveTimer.current); };
  }, [template, isAuthed]);

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
  const onPrintMonth = () => setShowPrintMonth(true);

  function ReceiptDepto({ month, form, template, onClose }) {
    const d = { ...form };
    const items = (template.depto || []).map(f => ({ label: f.label, value: toNum(d[f.key]) }))
      .filter(it => toNum(it.value) > 0);
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

  function PrintMonth({ month, form, template, onClose }) {
    const d = { ...form };
    const deptoItems = (template.depto || []).map(f => ({ label: f.label, value: toNum(d[f.key]) })).filter(it => toNum(it.value) > 0);
    const otrosItems = (template.otros || []).map(f => ({ label: f.label, value: toNum(d[f.key]) })).filter(it => toNum(it.value) > 0);
    const ingresosItems = (template.ingresos || []).map(f => ({ label: f.label, value: toNum(d[f.key]) })).filter(it => toNum(it.value) > 0);
    const t = calcTotals(d, template);
    const canvasRef = React.useRef(null);
    const chartRef = React.useRef(null);
    React.useEffect(() => {
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx) return;
      if (chartRef.current) { chartRef.current.destroy(); }
      chartRef.current = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: ['Gastos Depto', 'Otros Gastos', 'Ingresos'],
          datasets: [{
            label: month,
            data: [t.totalD, t.totalO, t.totalI],
            backgroundColor: ['#ef4444', '#f59e0b', '#22c55e']
          }]
        },
        options: { responsive: true, plugins: { legend: { display: false } } }
      });
    }, [month, t.totalD, t.totalO, t.totalI]);
    return (
      <div className="print-overlay" role="dialog" aria-modal="true">
        <div className="print-sheet">
          <h1>Resumen Mensual - {month}</h1>
          <div className="meta">Fecha: {new Date().toLocaleDateString()}</div>

          <h2>Gastos departamento</h2>
          <table>
            <thead><tr><th>Concepto</th><th className="right">Importe</th></tr></thead>
            <tbody>
              {deptoItems.length ? deptoItems.map(it => (
                <tr key={it.label}><td>{it.label}</td><td className="right">{fmt(it.value)}</td></tr>
              )) : <tr><td colSpan={2}>Sin datos</td></tr>}
            </tbody>
            <tfoot><tr><td>Total</td><td className="right">{fmt(t.totalD)}</td></tr></tfoot>
          </table>

          <h2>Otros gastos</h2>
          <table>
            <thead><tr><th>Concepto</th><th className="right">Importe</th></tr></thead>
            <tbody>
              {otrosItems.length ? otrosItems.map(it => (
                <tr key={it.label}><td>{it.label}</td><td className="right">{fmt(it.value)}</td></tr>
              )) : <tr><td colSpan={2}>Sin datos</td></tr>}
            </tbody>
            <tfoot><tr><td>Total</td><td className="right">{fmt(t.totalO)}</td></tr></tfoot>
          </table>

          <h2>Ingresos</h2>
          <table>
            <thead><tr><th>Concepto</th><th className="right">Importe</th></tr></thead>
            <tbody>
              {ingresosItems.length ? ingresosItems.map(it => (
                <tr key={it.label}><td>{it.label}</td><td className="right">{fmt(it.value)}</td></tr>
              )) : <tr><td colSpan={2}>Sin datos</td></tr>}
            </tbody>
            <tfoot><tr><td>Total</td><td className="right">{fmt(t.totalI)}</td></tr></tfoot>
          </table>

          <div className="summary">
            <div>Gastos Totales: <strong>{fmt(t.totalG)}</strong></div>
            <div>Balance (Ingresos - Gastos): <strong>{fmt(t.bal)}</strong></div>
          </div>

          <div className="chart-wrap">
            <canvas ref={canvasRef} height="80"></canvas>
          </div>

          <div className="actions">
            <button className="btn" onClick={() => window.print()}>Imprimir</button>
            <button className="btn" onClick={onClose}>Cerrar</button>
          </div>
        </div>
      </div>
    );
  }

  const monthKeys = Object.keys(monthsMap).sort().reverse();

  // UI helpers para template editor
  const addField = (section) => {
    const id = `${section}_${Date.now().toString(36)}`;
    setTemplate((t) => ({ ...t, [section]: [...(t[section]||[]), { key: id, label: 'Nuevo' }] }));
    setAll((f) => ({ ...f, [id]: '' }));
  };
  const removeField = (section, key) => {
    setTemplate((t) => ({ ...t, [section]: (t[section]||[]).filter((it) => it.key !== key) }));
    // mantenemos el valor en datos guardados por compatibilidad; si querés lo puedo borrar del form aquí
  };
  const updateLabel = (section, key, label) => {
    setTemplate((t) => ({ ...t, [section]: (t[section]||[]).map((it) => it.key === key ? { ...it, label } : it) }));
  };

  return (
    <div className="app compact">
      <header className="app-header">
        <h1>Control de Gastos</h1>
        <div className="header-actions">
          <label className="month-label">
            Mes
            <input type="month" value={month} onChange={(e)=>loadMonth(e.target.value)} />
          </label>
          <button className="icon-btn" aria-label="Nuevo mes" title="Nuevo mes" onClick={onNew}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          </button>
          <button className="icon-btn" aria-label={editMode? 'Bloquear edición':'Editar valores'} title={editMode? 'Bloquear edición':'Editar valores'} onClick={()=>setEditMode((v)=>!v)}>
            {editMode ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 2a2 2 0 0 0-2 2v4H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-2V4a2 2 0 0 0-2-2h-4z"></path></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path></svg>
            )}
          </button>
          <button className="icon-btn" aria-label="Editar plantilla" title="Editar plantilla" onClick={()=>setShowTplEditor(true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path></svg>
          </button>
          {isAuthed && (
            <button className="icon-btn" aria-label="Salir" title="Salir" onClick={async()=>{ await api.logout(); window.location.reload(); }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
            </button>
          )}
        </div>
      </header>

      <main className="app-main">
        <aside className="months-sidebar">
          <h2 style={{margin: 5}}>Meses guardados</h2>
          <ul className="months-list" style={{margin: 5}}>
            {monthKeys.map((m) => (
              <li key={m} className={m===month? 'active' : ''}>
                <span>{m}</span>
                <div className="month-actions">
                  <button className="icon-btn" aria-label="Cargar" title="Cargar" onClick={()=>loadMonth(m)}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 16 12 12 8 16"></polyline><line x1="12" y1="12" x2="12" y2="21"></line><path d="M20 21H4a2 2 0 0 1-2-2V7"></path><path d="M16 3h5v5"></path><path d="M21 3l-7 7"></path></svg>
                  </button>
                  <button className="icon-btn danger" aria-label="Borrar" title="Borrar" onClick={async()=>{ await api.del(m); await loadAll(); }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <button className="icon-btn" aria-label="Exportar CSV" title="Exportar CSV" onClick={onExport}  style={{margin: 5}}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          </button>
        </aside>

        <section className="content">
          <div className="cards-grid">
            <div className="card" style={{ margin: 10}}>
              <h3>Gastos departamento</h3>
              <div className="form-grid">
                {(template.depto||[]).map((f) => (
                  <label key={f.key}>{f.label}
                    <input type="number" min="0" step="1" value={form[f.key]||''}
                      onChange={update(f.key)} placeholder="0" disabled={!editMode} />
                  </label>
                ))}
              </div>
              <div className="totals-row">
                <span>Total</span>
                <strong>{fmt(totals.totalD)}</strong>
              </div>
            </div>

            <div className="card" style={{ margin: 10}}>
              <h3>Otros gastos</h3>
              <div className="form-grid">
                {(template.otros||[]).map((f) => (
                  <label key={f.key}>{f.label}
                    <input type="number" min="0" step="1" value={form[f.key]||''}
                      onChange={update(f.key)} placeholder="0" disabled={!editMode} />
                  </label>
                ))}
              </div>
              <div className="totals-row">
                <span>Total</span>
                <strong>{fmt(totals.totalO)}</strong>
              </div>
            </div>

            <div className="card" style={{ margin: 10}}>
              <h3>Ingresos</h3>
              <div className="form-grid">
                {(template.ingresos||[]).map((f) => (
                  <label key={f.key}>{f.label}
                    <input type="number" min="0" step="1" value={form[f.key]||''}
                      onChange={update(f.key)} placeholder="0" disabled={!editMode} />
                  </label>
                ))}
              </div>
              <div className="totals-row">
                <span>Total</span>
                <strong>{fmt(totals.totalI)}</strong>
              </div>
            </div>

            <div className="card" style={{ margin: 10}}>
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
                <button className="icon-btn" aria-label="Guardar mes" title="Guardar mes" onClick={onSave}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
                </button>
                <button className="icon-btn danger" aria-label="Eliminar mes" title="Eliminar mes" onClick={onDelete}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>
                </button>
                <button className="icon-btn" aria-label="Imprimir depto" title="Imprimir depto" onClick={onPrintDepto}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9V2h12v7"></path><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
                </button>
                <button className="icon-btn" aria-label="Imprimir mes" title="Imprimir mes" onClick={onPrintMonth}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                </button>
              </div>
            </div>

          </div>
        </section>
      </main>

      <footer className="app-footer">
        <div style={{ marginTop: 12 }}>
          <MonthsChart dataMap={monthsMap} template={template} />
        </div>
      </footer>

      {showReceipt && (
        <ReceiptDepto
          month={month}
          form={form}
          template={template}
          onClose={() => setShowReceipt(false)}
        />
      )}

      {showPrintMonth && (
        <PrintMonth
          month={month}
          form={form}
          template={template}
          onClose={() => setShowPrintMonth(false)}
        />
      )}

      {showLogin && (
        <LoginModal
          onLogin={async (pwd) => {
            await api.login(pwd);
            setShowLogin(false);
            await loadAll();
            // fetch template after login
            try { const res = await api.getTemplate(); if (res?.template) setTemplate(res.template); } catch {}
          }}
          onClose={() => setShowLogin(false)}
        />
      )}

      {showTplEditor && (
        <TemplateEditor
          template={template}
          setTemplate={setTemplate}
          onClose={() => setShowTplEditor(false)}
        />
      )}
    </div>
  );
}

function LoginModal({ onLogin, onClose }) {
  const [mode, setMode] = React.useState('login'); // 'login' | 'signup'
  const [email, setEmail] = React.useState('');
  const [pwd, setPwd] = React.useState('');
  const [err, setErr] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      if (mode === 'signup') {
        const res = await fetch('/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ email: email.trim(), password: pwd }) });
        if (!res.ok) {
          const j = await res.json().catch(()=>({}));
          throw new Error(j.error === 'email_taken' ? 'El email ya está registrado' : 'Error al crear cuenta');
        }
      } else {
        // Si no hay email ingresado, intentamos modo legacy con solo password
        if (!email.trim()) {
          await onLogin(pwd);
        } else {
          await onLogin({ email: email.trim(), password: pwd });
        }
      }
      onClose();
    } catch (ex) {
      setErr(ex.message || 'Error');
    } finally { setBusy(false); }
  };
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-card">
        <h2>{mode === 'signup' ? 'Crear cuenta' : 'Acceso'}</h2>
        <form onSubmit={submit}>
          <label className="form-field">Email (opcional para login legacy)
            <input type="email" value={email} onChange={(e)=>setEmail(e.target.value)} placeholder="tu@email.com" />
          </label>
          <label className="form-field">Contraseña
            <input type="password" value={pwd} onChange={(e)=>setPwd(e.target.value)} placeholder="••••••" autoFocus />
          </label>
          {err && <div className="form-error">{err}</div>}
          <div className="actions">
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy? (mode==='signup'?'Creando…':'Ingresando…') : (mode==='signup'?'Crear cuenta':'Ingresar')}
            </button>
            <button type="button" className="btn" onClick={()=>setMode(mode==='signup'?'login':'signup')}>
              {mode==='signup' ? 'Ya tengo cuenta' : 'Crear cuenta nueva'}
            </button>
            <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TemplateEditor({ template, setTemplate, onClose }) {
  const sections = [
    { key: 'depto', title: 'Gastos departamento' },
    { key: 'otros', title: 'Otros gastos' },
    { key: 'ingresos', title: 'Ingresos' },
  ];
  const addField = (section) => {
    const id = `${section}_${Date.now().toString(36)}`;
    setTemplate((t) => ({ ...t, [section]: [...(t[section]||[]), { key: id, label: 'Nuevo' }] }));
  };
  const removeField = (section, key) => {
    setTemplate((t) => ({ ...t, [section]: (t[section]||[]).filter((it) => it.key !== key) }));
  };
  const updateLabel = (section, key, label) => {
    setTemplate((t) => ({ ...t, [section]: (t[section]||[]).map((it) => it.key === key ? { ...it, label } : it) }));
  };
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-card wide">
        <div className="tpl-editor-header">
          <h2>Editar plantilla</h2>
          <button className="icon-btn" aria-label="Cerrar" onClick={onClose} title="Cerrar">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
        {sections.map((sec) => (
          <div className="card tpl-editor-section" key={sec.key} style={{ marginTop: 8 }}>
            <div className="tpl-section-header">
              <h3>{sec.title}</h3>
              <button className="icon-btn" aria-label="Agregar campo" title="Agregar campo" onClick={()=>addField(sec.key)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              </button>
            </div>
            <div className="tpl-editor-fields">
              {(template[sec.key]||[]).map((f) => (
                <div className="tpl-field-row" key={f.key}>
                  <input type="text" value={f.label} onChange={(e)=>updateLabel(sec.key, f.key, e.target.value)} placeholder="Nombre del campo" />
                  <button type="button" className="icon-btn danger" aria-label="Eliminar" title="Eliminar" onClick={()=>removeField(sec.key, f.key)}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
