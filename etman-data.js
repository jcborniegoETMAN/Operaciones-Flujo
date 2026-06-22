/* ═══════════════════════════════════════════════════════════════
   ETMAN OpFlux — Capa de datos compartida
   Lee las 4 hojas de Google Sheets (datos_operativos, capacidades,
   transferencias, complementos) vía export CSV público y expone
   funciones normalizadas para index.html, reporte.html y mapa.html.
   ═══════════════════════════════════════════════════════════════ */

const SHEET_ID = '15qWn7nmEpCXEfA4fwPkTj9uS3yYnyXJ6P0Oc385ovjg';

function csvUrl(sheetName) {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
}

/* ── PARSER CSV MÍNIMO (soporta comillas y comas dentro de campos) ── */
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i+1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c !== ''));
}

async function fetchSheet(sheetName) {
  const res = await fetch(csvUrl(sheetName));
  if (!res.ok) throw new Error(`No se pudo leer la hoja "${sheetName}" (HTTP ${res.status})`);
  let text = await res.text();
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // strip BOM
  return parseCSV(text);
}

/* ── NORMALIZACIÓN DE NOMBRES DE SUCURSAL ── */
// Acepta variantes con/sin tilde, "Bahia Blanca" vs "Bahía Blanca", etc.
const SUC_CANON = [
  { name: 'Moreno',       tag: 'HUB', color: '#4fc3f7', match: ['moreno'] },
  { name: 'Bahía Blanca', tag: 'BBL', color: '#a78bfa', match: ['bahia blanca','bahía blanca'] },
  { name: 'Rosario',      tag: 'ROS', color: '#34d399', match: ['rosario'] },
  { name: 'Córdoba',      tag: 'CBA', color: '#fb923c', match: ['cordoba','córdoba'] },
  { name: 'Mendoza',      tag: 'MDZ', color: '#f472b6', match: ['mendoza'] },
  { name: 'Paraná',       tag: 'PRA', color: '#facc15', match: ['parana','paraná'] },
  { name: 'Rafaela',      tag: 'RAF', color: '#60a5fa', match: ['rafaela'] },
];

function normSucursal(raw) {
  const v = (raw || '').trim().toLowerCase();
  const found = SUC_CANON.find(s => s.match.includes(v));
  return found ? found.name : (raw || '').trim();
}

const SUC = SUC_CANON.map(s => ({ name: s.name, tag: s.tag }));
const SUC_COLORS = SUC_CANON.map(s => s.color);

function sucIndex(name) {
  return SUC.findIndex(s => s.name === name);
}

/* ── PARÁMETROS DE CÁLCULO DE CAPACIDAD ── */
const SEMANAS_MES = 4.33;
const DIAS_EQ_SEMANA = 5.25; // 5 días completos + sábado al 25%

/* ── PARSEO datos_operativos → estructura ALL_DATES_DATA ──
   Formato esperado (fila 1 = grupos merged, fila 2 = encabezados,
   filas 3+ = datos):
   fecha, sucursal, tBuf_L, tBuf_U, tBuf_cajas, tBuf_pallets, tBuf_demora, tBuf_sat,
   rec_L, rec_U, rBuf_L, rBuf_U, rBuf_sat, guard_L, guard_U,
   pBuf_ped, pBuf_L, pBuf_U, pBuf_dias, pBuf_sat,
   pick_ped, pick_L, pick_U, audit_ped, audit_L, audit_U,
   desp_ped, desp_L, desp_U, desp_bultos, desp_pallets
*/
function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }

function parseDatosOperativos(rows) {
  // Los encabezados pueden venir en una fila ("fecha", "tBuf_L") o combinados con
  // el grupo en la misma celda ("IDENTIFICACIÓN fecha", "TRÁNSITO INBOUND tBuf_L")
  // si Google Sheets aplanó celdas fusionadas al exportar. Para ser robustos,
  // identificamos cada columna por su NOMBRE TÉCNICO como última palabra de la celda.

  // 1) Encontrar la fila de encabezados: la que tiene una celda terminada en "fecha"
  //    y otra que sea (o termine en) "sucursal".
  const lastToken = c => (c || '').trim().split(/\s+/).pop(); // última palabra
  let headerRow = -1;
  for (let r = 0; r < rows.length; r++) {
    const tokens = rows[r].map(lastToken);
    if (tokens.includes('fecha') && tokens.includes('sucursal')) { headerRow = r; break; }
  }
  if (headerRow === -1) return {};

  const header = rows[headerRow].map(lastToken);
  const idx = name => header.indexOf(name);

  const col = {
    fecha: idx('fecha'), sucursal: idx('sucursal'),
    tBuf_L: idx('tBuf_L'), tBuf_U: idx('tBuf_U'), tBuf_cajas: idx('tBuf_cajas'),
    tBuf_pallets: idx('tBuf_pallets'), tBuf_demora: idx('tBuf_demora'), tBuf_sat: idx('tBuf_sat'),
    rec_L: idx('rec_L'), rec_U: idx('rec_U'),
    rBuf_L: idx('rBuf_L'), rBuf_U: idx('rBuf_U'), rBuf_sat: idx('rBuf_sat'),
    guard_L: idx('guard_L'), guard_U: idx('guard_U'),
    pBuf_ped: idx('pBuf_ped'), pBuf_L: idx('pBuf_L'), pBuf_U: idx('pBuf_U'),
    pBuf_dias: idx('pBuf_dias'), pBuf_sat: idx('pBuf_sat'),
    pick_ped: idx('pick_ped'), pick_L: idx('pick_L'), pick_U: idx('pick_U'),
    audit_ped: idx('audit_ped'), audit_L: idx('audit_L'), audit_U: idx('audit_U'),
    desp_ped: idx('desp_ped'), desp_L: idx('desp_L'), desp_U: idx('desp_U'),
    desp_bultos: idx('desp_bultos'), desp_pallets: idx('desp_pallets'),
  };

  const byDate = {}; // { 'YYYY-MM-DD': [ rowPerSuc... ] }
  const firstDataRow = headerRow + 1;

  for (let r = firstDataRow; r < rows.length; r++) {
    const row = rows[r];
    const fecha = (row[col.fecha] || '').trim();
    if (!fecha) continue;
    const suc = normSucursal(row[col.sucursal]);
    const si = sucIndex(suc);
    if (si === -1) continue; // sucursal no reconocida, se ignora

    if (!byDate[fecha]) {
      byDate[fecha] = SUC.map(() => null);
    }

    byDate[fecha][si] = {
      tBuf:  { L: num(row[col.tBuf_L]), U: num(row[col.tBuf_U]), cajas: num(row[col.tBuf_cajas]), pallets: num(row[col.tBuf_pallets]), demora: num(row[col.tBuf_demora]), sat: num(row[col.tBuf_sat]) },
      rec:   { L: num(row[col.rec_L]), U: num(row[col.rec_U]) },
      rBuf:  { L: num(row[col.rBuf_L]), U: num(row[col.rBuf_U]), sat: num(row[col.rBuf_sat]) },
      guard: { L: num(row[col.guard_L]), U: num(row[col.guard_U]) },
      pBuf:  { ped: num(row[col.pBuf_ped]), L: num(row[col.pBuf_L]), U: num(row[col.pBuf_U]), dias: num(row[col.pBuf_dias]), sat: num(row[col.pBuf_sat]) },
      pick:  { ped: num(row[col.pick_ped]), L: num(row[col.pick_L]), U: num(row[col.pick_U]) },
      audit: { ped: num(row[col.audit_ped]), L: num(row[col.audit_L]), U: num(row[col.audit_U]) },
      desp:  { ped: num(row[col.desp_ped]), L: num(row[col.desp_L]), U: num(row[col.desp_U]), bultos: num(row[col.desp_bultos]), pallets: num(row[col.desp_pallets]) },
    };
  }

  return byDate;
}

/* ── PARSEO capacidades → { sucursal: { fase: capDiaria } } ──
   La hoja tiene título en fila1, encabezados en fila3, datos desde fila5.
   Columnas: Sucursal | Fase | Cap.Mensual | Cap.Semanal | Cap.Diaria | (spacer) | UmbralAtencion | UmbralCritico
*/
function parseCapacidades(rows) {
  // Headers pueden venir limpios ("Sucursal") o combinados con grupo.
  // Comparamos por última palabra para tolerar ambos casos.
  const lastToken = c => (c || '').trim().split(/\s+/).pop();
  let headerRow = -1;
  for (let r = 0; r < rows.length; r++) {
    const tokens = rows[r].map(lastToken);
    if (tokens.includes('Sucursal') && tokens.includes('Fase')) {
      headerRow = r;
      break;
    }
  }
  if (headerRow === -1) return {};

  const header = rows[headerRow].map(h => (h || '').trim());
  const tokens = rows[headerRow].map(lastToken);
  const cSuc  = tokens.indexOf('Sucursal');
  const cFase = tokens.indexOf('Fase');
  // Cap. Diaria: buscamos la columna cuyo texto contenga "diaria".
  let cDiaria = header.findIndex(h => h.toLowerCase().includes('diaria'));
  if (cDiaria === -1) cDiaria = cFase + 3; // fallback al layout esperado

  const FASE_KEY = {
    'Recepción': 'rec', 'Recepcion': 'rec',
    'Guardado': 'guard',
    'Picking': 'pick',
    'Auditoría': 'audit', 'Auditoria': 'audit',
    'Despacho': 'desp',
  };

  const cap = {}; // { sucursalName: { rec: diaria, guard: diaria, ... } }
  let currentSuc = null;

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row[cFase]) continue;
    const sucCell = (row[cSuc] || '').trim();
    if (sucCell) currentSuc = normSucursal(sucCell);
    if (!currentSuc) continue;

    const faseKey = FASE_KEY[(row[cFase] || '').trim()];
    if (!faseKey) continue;

    const diaria = num(row[cDiaria]);
    if (!cap[currentSuc]) cap[currentSuc] = {};
    cap[currentSuc][faseKey] = diaria;
  }

  return cap;
}

/* ── CALCULAR _cap EN BASE A LÍNEAS REALES / CAPACIDAD DIARIA ── */
function aplicarCapacidades(byDate, capacidades) {
  const FLU_KEYS = ['rec', 'guard', 'pick', 'audit', 'desp'];
  Object.keys(byDate).forEach(fecha => {
    byDate[fecha].forEach((row, si) => {
      if (!row) return;
      const sucName = SUC[si].name;
      const capSuc = capacidades[sucName] || {};
      FLU_KEYS.forEach(key => {
        const capDiaria = capSuc[key];
        if (capDiaria && capDiaria > 0) {
          row[key].cap = Math.round((row[key].L / capDiaria) * 100);
        } else {
          row[key].cap = 0; // sin capacidad configurada
        }
      });
    });
  });
  return byDate;
}

/* ── PARSEO transferencias / complementos →
   { 'YYYY-MM-DD': [ {from, to, L, U, dias}, ... ] }
   Acepta nombres de nodo en minúscula sin tilde para from/to (igual que mapa.html)
*/
const NODE_KEY = {
  'Moreno': 'moreno', 'Bahía Blanca': 'bahia', 'Rosario': 'rosario',
  'Córdoba': 'cordoba', 'Mendoza': 'guaymallen', 'Paraná': 'parana', 'Rafaela': 'rafaela',
};

function parseFlujo(rows) {
  // Buscar la fila de encabezados real (fecha, origen, destino).
  // Tolera celdas combinadas: "fecha\nFecha del registro" o "GRUPO fecha".
  // Tomamos la última palabra de la primera línea de cada celda.
  const token = c => (c || '').split('\n')[0].trim().split(/\s+/).pop().toLowerCase();
  let headerRowIdx = -1;
  for (let r = 0; r < rows.length; r++) {
    const cells = rows[r].map(token);
    if (cells.includes('fecha') && cells.includes('origen') && cells.includes('destino')) {
      headerRowIdx = r;
      break;
    }
  }
  if (headerRowIdx === -1) return {};

  const hdr = rows[headerRowIdx].map(token);
  const cFecha = hdr.indexOf('fecha');
  const cOrigen = hdr.indexOf('origen');
  const cDestino = hdr.indexOf('destino');
  const cL = hdr.indexOf('l');
  const cU = hdr.indexOf('u');
  const cDias = hdr.indexOf('dias');

  const byDate = {};
  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    const fecha = (row[cFecha] || '').trim();
    if (!fecha) continue;
    const origenName = normSucursal(row[cOrigen]);
    const destinoName = normSucursal(row[cDestino]);
    const fromKey = NODE_KEY[origenName];
    const toKey = NODE_KEY[destinoName];
    if (!fromKey || !toKey) continue;

    if (!byDate[fecha]) byDate[fecha] = [];
    byDate[fecha].push({
      from: fromKey, to: toKey,
      L: num(row[cL]), U: num(row[cU]), dias: num(row[cDias]),
    });
  }
  return byDate;
}

/* ── CARGA COMPLETA ── */
let _cache = null;

async function loadETMANData() {
  if (_cache) return _cache;

  const [datosRows, capRows, transfRows, complRows] = await Promise.all([
    fetchSheet('datos_operativos'),
    fetchSheet('capacidades'),
    fetchSheet('transferencias'),
    fetchSheet('complementos'),
  ]);

  const capacidades = parseCapacidades(capRows);
  const byDate = parseDatosOperativos(datosRows);
  aplicarCapacidades(byDate, capacidades);

  const transferencias = parseFlujo(transfRows);
  const complementos   = parseFlujo(complRows);

  // Fecha más reciente disponible = "hoy" operativo
  const allDates = Object.keys(byDate).sort();
  const latestDate = allDates.length ? allDates[allDates.length - 1] : null;

  _cache = {
    byDate, capacidades, transferencias, complementos,
    allDates, latestDate,
  };
  return _cache;
}

/* Exponer en window para uso desde index.html / reporte.html / mapa.html */
window.ETMAN = {
  SUC, SUC_COLORS,
  loadETMANData,
  normSucursal, sucIndex,
  NODE_KEY,
};
