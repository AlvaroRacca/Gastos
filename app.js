// App de Control de Gastos Mensuales

// --- Selectores UI ---
const $ = (sel) => document.querySelector(sel);
const inputMes = $('#input-mes');
const btnNuevo = $('#btn-nuevo');
const btnGuardar = $('#btn-guardar');
const btnEliminar = $('#btn-eliminar');
const btnExport = $('#btn-export');
const listaMeses = $('#lista-meses');

// Depto
const gInternet = $('#g-internet');
const gExpensa = $('#g-expensa');
const gAgua = $('#g-agua');
const gGas = $('#g-gas');
const gLuz = $('#g-luz');
const totalDepto = $('#total-depto');

// Otros
const gTarjeta = $('#g-tarjeta');
const gAuto = $('#g-auto');
const gCochera = $('#g-cochera');
const totalOtros = $('#total-otros');

// Ingresos
const iCatastro = $('#i-catastro');
const iAdmin = $('#i-admin');
const totalIngresos = $('#total-ingresos');

// Resumen
const aPagarDepto = $('#a-pagar-depto');
const gastosTotales = $('#gastos-totales');
const balance = $('#balance');

// --- Persistencia ---
const STORAGE_KEY = 'gastos_app_v1';
function loadAll() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}
function saveAll(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// --- Utilidades ---
const toNum = (v) => Number.parseFloat(v || '0') || 0;
const fmt = (n) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);

function getCurrentMonth() {
  return inputMes.value || new Date().toISOString().slice(0, 7); // YYYY-MM
}

function setInputs(data) {
  gInternet.value = data.gInternet ?? '';
  gExpensa.value = data.gExpensa ?? '';
  gAgua.value = data.gAgua ?? '';
  gGas.value = data.gGas ?? '';
  gLuz.value = data.gLuz ?? '';

  gTarjeta.value = data.gTarjeta ?? '';
  gAuto.value = data.gAuto ?? '';
  gCochera.value = data.gCochera ?? '';

  iCatastro.value = data.iCatastro ?? '';
  iAdmin.value = data.iAdmin ?? '';
}

function readInputs() {
  return {
    gInternet: toNum(gInternet.value),
    gExpensa: toNum(gExpensa.value),
    gAgua: toNum(gAgua.value),
    gGas: toNum(gGas.value),
    gLuz: toNum(gLuz.value),
    gTarjeta: toNum(gTarjeta.value),
    gAuto: toNum(gAuto.value),
    gCochera: toNum(gCochera.value),
    iCatastro: toNum(iCatastro.value),
    iAdmin: toNum(iAdmin.value),
  };
}

function recalcAndRenderTotals() {
  const d = readInputs();
  const totalD = d.gInternet + d.gExpensa + d.gAgua + d.gGas + d.gLuz;
  const totalO = d.gTarjeta + d.gAuto + d.gCochera;
  const totalI = d.iCatastro + d.iAdmin;
  const totalG = totalD + totalO;
  const bal = totalI - totalG;

  totalDepto.textContent = fmt(totalD);
  totalOtros.textContent = fmt(totalO);
  totalIngresos.textContent = fmt(totalI);
  aPagarDepto.textContent = fmt(totalD);
  gastosTotales.textContent = fmt(totalG);
  balance.textContent = fmt(bal);
}

function renderMonthsList() {
  const all = loadAll();
  const keys = Object.keys(all).sort().reverse(); // más reciente primero
  listaMeses.innerHTML = '';
  keys.forEach(key => {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = key;
    const actions = document.createElement('div');
    actions.className = 'month-actions';
    const btnLoad = document.createElement('button');
    btnLoad.className = 'btn';
    btnLoad.textContent = 'Cargar';
    btnLoad.addEventListener('click', () => {
      inputMes.value = key;
      loadMonthToUI(key);
    });
    const btnDel = document.createElement('button');
    btnDel.className = 'btn btn-danger';
    btnDel.textContent = 'Borrar';
    btnDel.addEventListener('click', () => {
      const all2 = loadAll();
      delete all2[key];
      saveAll(all2);
      if (inputMes.value === key) clearInputs();
      renderMonthsList();
    });
    actions.append(btnLoad, btnDel);
    li.append(label, actions);
    listaMeses.appendChild(li);
  });
}

function clearInputs() {
  setInputs({});
  recalcAndRenderTotals();
}

function loadMonthToUI(month) {
  const all = loadAll();
  const data = all[month];
  if (!data) { setInputs({}); recalcAndRenderTotals(); return; }
  setInputs(data);
  recalcAndRenderTotals();
}

function saveCurrentMonth() {
  const month = getCurrentMonth();
  inputMes.value = month;
  const current = readInputs();
  const all = loadAll();
  all[month] = current;
  saveAll(all);
  renderMonthsList();
}

function deleteCurrentMonth() {
  const month = getCurrentMonth();
  const all = loadAll();
  if (all[month]) {
    delete all[month];
    saveAll(all);
  }
  clearInputs();
  renderMonthsList();
}

function exportCSV() {
  const all = loadAll();
  const rows = [
    ['Mes','Internet','Expensa','Agua','Gas','Luz','Tarjeta','Auto','Cochera','Ingreso Catastro','Ingreso Admin','Total Depto','Total Otros','Total Ingresos','Gastos Totales','Balance']
  ];
  Object.keys(all).sort().forEach(m => {
    const d = all[m];
    const totalD = d.gInternet + d.gExpensa + d.gAgua + d.gGas + d.gLuz;
    const totalO = d.gTarjeta + d.gAuto + d.gCochera;
    const totalI = d.iCatastro + d.iAdmin;
    const totalG = totalD + totalO;
    const bal = totalI - totalG;
    rows.push([
      m,
      d.gInternet, d.gExpensa, d.gAgua, d.gGas, d.gLuz,
      d.gTarjeta, d.gAuto, d.gCochera,
      d.iCatastro, d.iAdmin,
      totalD, totalO, totalI, totalG, bal
    ]);
  });
  const csv = rows.map(r => r.map(v => typeof v === 'string' ? '"' + v.replace(/"/g,'""') + '"' : String(v)).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'gastos.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// --- Eventos ---
const numberInputs = [gInternet,gExpensa,gAgua,gGas,gLuz,gTarjeta,gAuto,gCochera,iCatastro,iAdmin];
numberInputs.forEach(inp => inp.addEventListener('input', recalcAndRenderTotals));

btnNuevo.addEventListener('click', () => {
  inputMes.value = new Date().toISOString().slice(0, 7);
  clearInputs();
});

btnGuardar.addEventListener('click', () => {
  saveCurrentMonth();
});

btnEliminar.addEventListener('click', () => {
  deleteCurrentMonth();
});

btnExport.addEventListener('click', exportCSV);

inputMes.addEventListener('change', () => {
  if (!inputMes.value) return;
  loadMonthToUI(inputMes.value);
});

// --- Init ---
(function init() {
  if (!inputMes.value) inputMes.value = new Date().toISOString().slice(0, 7);
  renderMonthsList();
  loadMonthToUI(getCurrentMonth());
})();
