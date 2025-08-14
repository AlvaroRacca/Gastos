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
function resetState() {
  tiles = [];
  board = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
  nextId = 1;
  score = 0;
  scoreDisplay.textContent = score;
  bestDisplay.textContent = bestScore;
  gameMessage.classList.remove('show-game-over');
  // remove all existing tiles
  [...document.querySelectorAll('.tile')].forEach(n => n.remove());
  spawnRandom();
  spawnRandom();
}

function spawnRandom() {
  const empty = [];
  for (let x = 0; x < SIZE; x++) {
    for (let y = 0; y < SIZE; y++) {
      if (board[x][y] === 0) empty.push({ x, y });
    }
  }
  if (!empty.length) return false;
  const { x, y } = empty[Math.floor(Math.random() * empty.length)];
  const value = Math.random() < 0.9 ? 2 : 4;
  const id = nextId++;
  board[x][y] = value;
  tiles.push({ id, value, x, y });
  // render new tile with pop
  const el = ensureTileElement(id, value);
  setTilePosition(el, x, y);
  el.classList.add(`tile-${value}`);
  el.classList.add('bump');
  setTimeout(() => el.classList.remove('bump'), 130);
  return true;
}

function ensureTileElement(id, value) {
  let el = document.querySelector(`[data-id="${id}"]`);
  if (!el) {
    el = document.createElement('div');
    el.className = `tile tile-${value}`;
    el.dataset.id = String(id);
    const inner = document.createElement('div');
    inner.className = 'tile-inner';
    inner.textContent = value;
    el.appendChild(inner);
    grid.appendChild(el);
  } else {
    // update class/value if changed
    [...el.classList].forEach(c => {
      if (c.startsWith('tile-') && c !== 'tile') el.classList.remove(c);
    });
    el.classList.add(`tile-${value}`);
    el.querySelector('.tile-inner').textContent = value;
  }
  return el;
}

function setTilePosition(el, x, y) {
  el.style.top = posToPx(x) + 'px';
  el.style.left = posToPx(y) + 'px';
}

function forEachLine(dir, fn) {
  // dir: 'up','down','left','right'
  for (let i = 0; i < SIZE; i++) {
    const cells = [];
    for (let j = 0; j < SIZE; j++) {
      let x, y;
      if (dir === 'left') x = i, y = j;
      if (dir === 'right') x = i, y = SIZE - 1 - j;
      if (dir === 'up') x = j, y = i;
      if (dir === 'down') x = SIZE - 1 - j, y = i;
      cells.push({ x, y });
    }
    fn(cells);
  }
}

function canMove() {
  for (let x = 0; x < SIZE; x++) {
    for (let y = 0; y < SIZE; y++) {
      if (board[x][y] === 0) return true;
      if (x + 1 < SIZE && board[x][y] === board[x + 1][y]) return true;
      if (y + 1 < SIZE && board[x][y] === board[x][y + 1]) return true;
    }
  }
  return false;
}

function move(dir) {
  if (moving) return false;
  let moved = false;
  const toRemoveIds = new Set();
  const bumps = [];

  // map of id by position
  const idAt = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  tiles.forEach(t => { idAt[t.x][t.y] = t.id; });

  forEachLine(dir, (cells) => {
    // gather non-zero values with their ids
    const line = cells.map(({ x, y }) => ({ x, y, value: board[x][y], id: idAt[x][y] })).filter(c => c.value !== 0);
    if (line.length === 0) return;

    const result = [];
    let i = 0;
    while (i < line.length) {
      if (i + 1 < line.length && line[i].value === line[i + 1].value) {
        // merge
        const mergedValue = line[i].value * 2;
        const fromA = line[i];
        const fromB = line[i + 1];
        result.push({ value: mergedValue, from: [fromA, fromB] });
        score += mergedValue;
        bumps.push({ fromId: fromA.id, intoValue: mergedValue });
        toRemoveIds.add(fromB.id);
        i += 2;
        moved = true;
      } else {
        result.push({ value: line[i].value, from: [line[i]] });
        i += 1;
      }
    }

    // write back into cells order
    for (let k = 0; k < cells.length; k++) {
      const { x, y } = cells[k];
      const piece = result[k];
      const prev = board[x][y];
      if (piece) {
        if (board[x][y] !== piece.value) moved = true;
        board[x][y] = piece.value;
      } else {
        if (prev !== 0) moved = true;
        board[x][y] = 0;
      }
    }
  });

  if (!moved) return false;

  scoreDisplay.textContent = score;
  if (score > bestScore) {
    bestScore = score;
    bestDisplay.textContent = bestScore;
    localStorage.setItem('bestScore', String(bestScore));
  }

  animateToBoard(toRemoveIds, bumps);
  return true;
}

function animateToBoard(toRemoveIds, bumps) {
  moving = true;
  // update or create tiles per board
  // rebuild tiles array from board but try to reuse ids: keep an index of current tiles by value and target positions
  const oldTilesByPos = new Map(tiles.map(t => [t.x + ',' + t.y, t]));
  const newTiles = [];

  for (let x = 0; x < SIZE; x++) {
    for (let y = 0; y < SIZE; y++) {
      const value = board[x][y];
      if (value === 0) continue;
      // try to reuse a tile from same value and closest old position; fallback create
      let reuse = null;
      // prefer a tile that is now merged target: one whose id is not marked for removal and had same value or half of current
      // but simpler: reuse any tile not removed yet with matching value; else create new
      for (const t of tiles) {
        if (toRemoveIds.has(t.id)) continue;
        if (t.reused) continue;
        if (t.value === value || t.value * 2 === value) { reuse = t; break; }
      }
      if (reuse) {
        reuse.reused = true;
        reuse.value = value;
        reuse.x = x; reuse.y = y;
        newTiles.push(reuse);
        const el = ensureTileElement(reuse.id, reuse.value);
        requestAnimationFrame(() => setTilePosition(el, x, y));
      } else {
        const id = nextId++;
        const t = { id, value, x, y };
        newTiles.push(t);
        const el = ensureTileElement(id, value);
        // start at final pos (no movement). For merged-created tile, we add bump below if applicable.
        setTilePosition(el, x, y);
      }
    }
  }

  // remove tiles marked for deletion
  tiles.forEach(t => {
    if (toRemoveIds.has(t.id)) {
      const el = document.querySelector(`[data-id="${t.id}"]`);
      if (el) el.remove();
    }
  });

  tiles = newTiles;

  // bump merged results
  const bumpEls = new Set();
  tiles.forEach(t => {
    // if any bump targets this value where fromId existed
    const found = bumps.find(b => !toRemoveIds.has(b.fromId) && t.value === b.intoValue);
    if (found) {
      const el = document.querySelector(`[data-id="${t.id}"]`);
      if (el && !bumpEls.has(el)) {
        el.classList.add('bump');
        setTimeout(() => el.classList.remove('bump'), 140);
        bumpEls.add(el);
      }
    }
  });

  // wait for transitions to finish (~120ms)
  setTimeout(() => {
    moving = false;
    // spawn new tile and check game over
    spawnRandom();
    if (!canMove()) {
      gameMessage.classList.add('show-game-over');
      gameMessage.querySelector('.game-message-text').textContent = 'Game Over!';
    }
  }, 140);
}

// Input
function onKeyDown(e) {
  const direction = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'up',
    ArrowDown: 'down',
  }[e.key];
  if (!direction) return;
  e.preventDefault();
  const did = move(direction);
  if (did) {
    // movement handled with animation
  }
}

// Touch support
let touchStartX = 0, touchStartY = 0;
function onTouchStart(e) {
  if (!e.touches || !e.touches[0]) return;
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
}
function onTouchEnd(e) {
  const dx = (e.changedTouches[0].clientX - touchStartX);
  const dy = (e.changedTouches[0].clientY - touchStartY);
  const absX = Math.abs(dx), absY = Math.abs(dy);
  if (Math.max(absX, absY) < 20) return; // ignore small swipes
  let dir = null;
  if (absX > absY) dir = dx > 0 ? 'right' : 'left';
  else dir = dy > 0 ? 'down' : 'up';
  move(dir);
}

// Restart
restartButton.addEventListener('click', () => resetState());

document.addEventListener('keydown', onKeyDown, { passive: false });
grid.addEventListener('touchstart', onTouchStart, { passive: true });
grid.addEventListener('touchend', onTouchEnd, { passive: true });

// Init
resetState();
