/* ReStart — od praznog lokala do novog posla
 * Podaci:
 *  - data/spaces.json  ← Grad Zagreb, „Prazni poslovni prostori 2024." (data.zagreb.hr / data.gov.hr), adrese geokodirane (OSM Nominatim)
 *  - data/stops.json   ← Grad Zagreb geoportal, autobusna + tramvajska stajališta ZET-a
 *  - DISTRICTS (ispod) ← DZS Popis 2021., konačni rezultati, obrada Grad Zagreb (tablica 8)
 *  - Financije         ← korisničke pretpostavke (nisu službeni podaci ni ponude)
 */

const DISTRICTS = {
  'DONJI GRAD': { pop: 31209, dens: 10334 },
  'GORNJI GRAD - MEDVEŠČAK': { pop: 26423, dens: 2596 },
  'TRNJE': { pop: 40539, dens: 5508 },
  'MAKSIMIR': { pop: 47356, dens: 3163 },
  'PEŠČENICA - ŽITNJAK': { pop: 53023, dens: 1502 },
  'NOVI ZAGREB - ISTOK': { pop: 55898, dens: 3380 },
  'NOVI ZAGREB - ZAPAD': { pop: 63917, dens: 1021 },
  'TREŠNJEVKA - SJEVER': { pop: 52974, dens: 9118 },
  'TREŠNJEVKA - JUG': { pop: 65324, dens: 6639 },
  'ČRNOMEREC': { pop: 38084, dens: 1576 },
  'GORNJA DUBRAVA': { pop: 58255, dens: 1441 },
  'DONJA DUBRAVA': { pop: 33537, dens: 3108 },
  'STENJEVEC': { pop: 53862, dens: 4400 },
  'PODSUSED - VRAPČE': { pop: 44910, dens: 1241 },
  'PODSLJEME': { pop: 18974, dens: 320 },
  'SESVETE': { pop: 70800, dens: 429 },
  'BREZOVICA': { pop: 12046, dens: 95 },
};
const MAX_DENS = 10334;

// Djelatnosti — sve brojke su ilustrativne pretpostavke koje korisnik mijenja
const BIZ = [
  { id: 'servis', em: '🔧', name: 'Servis elektronike', area: [40, 80], unit: 'popravak', units: 'popravaka', contrib: 25, staff: 1400, other: 250,
    prio: { area: 2, transit: 2, density: 1, street: 1 } },
  { id: 'kafic', em: '☕', name: 'Kafić', area: [50, 130], unit: 'piće', units: 'pića', contrib: 1.3, staff: 2800, other: 400,
    prio: { area: 1, transit: 1, density: 2, street: 2 } },
  { id: 'frizer', em: '✂️', name: 'Frizerski salon', area: [25, 60], unit: 'termin', units: 'termina', contrib: 14, staff: 1400, other: 200,
    prio: { area: 1, transit: 1, density: 2, street: 2 } },
  { id: 'pekara', em: '🥐', name: 'Pekara', area: [30, 90], unit: 'proizvod', units: 'proizvoda', contrib: 0.7, staff: 2600, other: 350,
    prio: { area: 1, transit: 2, density: 2, street: 2 } },
  { id: 'it', em: '💻', name: 'IT studio / ured', area: [20, 70], unit: 'sat rada', units: 'sati rada', contrib: 28, staff: 0, other: 300,
    prio: { area: 2, transit: 2, density: 0, street: 0 } },
  { id: 'atelje', em: '🎨', name: 'Atelje / radionica', area: [20, 100], unit: 'narudžba', units: 'narudžbi', contrib: 40, staff: 0, other: 150,
    prio: { area: 2, transit: 1, density: 0, street: 0 } },
];
const PRIO = [
  { key: 'area', label: 'Površina blizu idealne' },
  { key: 'transit', label: 'Javni prijevoz (ZET)' },
  { key: 'density', label: 'Gusto naseljena četvrt' },
  { key: 'street', label: 'Ulični položaj' },
];
// Pretpostavljena zakupnina po zoni (€/m²/mj) — ilustrativno, korisnik mijenja
const ZONE_RENT = { 'I': 16, 'II': 12, 'III': 9, 'IV': 6, 'V': 4, '0': 8 };
const POS_SCORE = { 'ULIČNI': 1, 'POTHODNIK': .55, 'KAT': .45, 'DVORIŠNI': .4, 'POTKROVLJE': .3, 'PODRUM': .2 };
const LETTERS = ['A', 'B', 'C'];

const state = {
  biz: BIZ[0],
  area: [...BIZ[0].area],
  prio: { ...BIZ[0].prio },
  onlyStreet: false,
  hideTender: false,
  picks: [],          // ids
  calc: { utilM2: 3, fitM2: 150, months: 36, staff: BIZ[0].staff, other: BIZ[0].other, contrib: BIZ[0].contrib, days: 22 },
  rent: {},           // id -> €/m²
  active: 0,          // which candidate in calc
  step: 1,
};

let SPACES = [], STOPS = [], map, markers = {}, stopLayer, ringLayer;
const $ = (s) => document.querySelector(s);
const fmt = (n, d = 0) => n.toLocaleString('hr-HR', { minimumFractionDigits: d, maximumFractionDigits: d });
const eur = (n) => fmt(Math.round(n)) + ' €';
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const pretty = (s) => s.toLowerCase().replace(/(^|[\s\-.(/])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

/* ---------- data ---------- */
async function load() {
  const [sp, st] = await Promise.all([fetch('data/spaces.json').then(r => r.json()), fetch('data/stops.json').then(r => r.json())]);
  STOPS = st.map(([lat, lng, name, kind, lines]) => ({ lat, lng, name, kind, lines: String(lines).split(/[,;\s]+/).filter(Boolean) }));
  // jitter duplicate coordinates so overlapping pins stay clickable
  const seen = {};
  SPACES = sp.filter(s => s.lat).map(s => {
    const k = s.lat.toFixed(5) + s.lng.toFixed(5);
    const n = (seen[k] = (seen[k] || 0) + 1) - 1;
    const a = n * 2.4, r = n ? 0.00007 * Math.sqrt(n) : 0;
    const tender = /natje/i.test(s.note + ' ' + s.note2);
    return { ...s, lat: s.lat + r * Math.sin(a), lng: s.lng + r * Math.cos(a) * 1.4, tender, ...transit(s.lat, s.lng) };
  });
  $('#total-count').textContent = SPACES.length;
}

function distM(aLat, aLng, bLat, bLng) {
  const dx = (bLng - aLng) * 111320 * Math.cos(aLat * Math.PI / 180), dy = (bLat - aLat) * 110540;
  return Math.hypot(dx, dy);
}
function transit(lat, lng) {
  let nearest = Infinity, nearestName = '', tram = false; const lines = new Set(); let n = 0;
  for (const s of STOPS) {
    const d = distM(lat, lng, s.lat, s.lng);
    if (d < nearest) { nearest = d; nearestName = s.name; }
    if (d <= 400) { n++; s.lines.forEach(l => lines.add(s.kind + l)); if (s.kind === 'tram') tram = true; }
  }
  return { stopDist: nearest, stopName: nearestName, stops400: n, lines400: lines.size, tram400: tram };
}

/* ---------- matching & ranking ---------- */
function scores(s) {
  const [lo, hi] = state.area; const mid = (lo + hi) / 2, half = Math.max(1, (hi - lo) / 2);
  const area = clamp(1 - 0.6 * Math.abs(s.area - mid) / half);
  const transit = clamp(0.5 * clamp(1 - (s.stopDist - 60) / 540) + 0.3 * clamp(s.lines400 / 10) + 0.2 * (s.tram400 ? 1 : 0));
  const d = DISTRICTS[s.district];
  const density = d ? Math.sqrt(d.dens / MAX_DENS) : 0.3;
  const street = POS_SCORE[s.position] ?? 0.4;
  return { area, transit, density, street };
}
function passes(s) {
  if (s.area < state.area[0] || s.area > state.area[1]) return false;
  if (state.onlyStreet && s.position !== 'ULIČNI') return false;
  if (state.hideTender && s.tender) return false;
  return true;
}
function total(sc) {
  let w = 0, t = 0;
  for (const p of PRIO) { const wi = state.prio[p.key]; w += wi; t += wi * sc[p.key]; }
  return w ? t / w : 0;
}
function ranked() {
  return SPACES.filter(passes).map(s => ({ s, sc: scores(s) })).map(o => ({ ...o, t: total(o.sc) })).sort((a, b) => b.t - a.t);
}
const byId = (id) => SPACES.find(s => s.id === id);

/* ---------- map ---------- */
function initMap() {
  map = L.map('map', { zoomControl: false, preferCanvas: true }).setView([45.808, 15.98], 13);
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap · Podaci: Grad Zagreb, ZET, DZS', maxZoom: 19,
  }).addTo(map);
  stopLayer = L.layerGroup();
  const rnd = L.canvas({ padding: .5 });
  STOPS.forEach(s => L.circleMarker([s.lat, s.lng], { renderer: rnd, radius: s.kind === 'tram' ? 4 : 3, color: s.kind === 'tram' ? '#2a9df4' : '#7fb8e6', weight: 2, fillColor: '#fff', fillOpacity: 1 })
    .bindTooltip(`${s.kind === 'tram' ? '🚋' : '🚌'} ${s.name}<br><small>linije ${s.lines.join(', ')}</small>`).addTo(stopLayer));
  ringLayer = L.layerGroup().addTo(map);
  map.on('zoomend', () => { map.getZoom() >= 15 ? stopLayer.addTo(map) : stopLayer.remove(); });
  SPACES.forEach(s => {
    const m = L.marker([s.lat, s.lng], { icon: pinIcon('off', '') });
    m.on('click', () => openPopup(s));
    m.addTo(map); markers[s.id] = m;
  });
  map.getContainer().addEventListener('click', (e) => {
    const b = e.target.closest('[data-toggle]'); if (b) { togglePick(b.dataset.toggle); openPopup(byId(b.dataset.toggle)); }
  });
}
function pinIcon(cls, label) {
  const sz = cls === 'off' ? 14 : cls === 'pick' ? 36 : 30;
  return L.divIcon({ className: '', html: `<div class="pin ${cls}"><span>${label}</span></div>`, iconSize: [sz, sz], iconAnchor: [sz / 2, sz] });
}
function popupHtml(s) {
  const d = DISTRICTS[s.district]; const picked = state.picks.includes(s.id);
  const full = !picked && state.picks.length >= 3;
  return `<div class="pop">
    <h3>${pretty(s.addr)}</h3>
    <div class="sub">${pretty(s.district)} · ID ${s.id} · zona ${s.zone}</div>
    <div class="kv">
      <div><small>Površina</small><b>${fmt(s.area, s.area % 1 ? 1 : 0)} m²</b></div>
      <div><small>Položaj</small><b>${pretty(s.position || '—')}</b></div>
      <div><small>Najbliže stajalište</small><b>${Math.round(s.stopDist)} m</b></div>
      <div><small>Stanovnika u četvrti</small><b>${d ? fmt(d.pop) : '—'}</b></div>
    </div>
    ${s.desc ? `<div class="desc">„${s.desc}"</div>` : ''}
    ${s.tender ? `<div style="margin-bottom:8px"><span class="tag warn">⚑ ${s.note.replace(/[()]/g, '') || 'natječaj u tijeku'}</span></div>` : ''}
    <div class="check"><b>Treba provjeriti:</b> aktualnu raspoloživost, uvjete zakupa i je li djelatnost dopuštena u prostoru.${s.geoPrecise ? '' : ' Lokacija na karti je približna.'}<br><span style="opacity:.75">Izvor: Grad Zagreb, registar praznih prostora 2024.</span></div>
    <button class="btn ${picked ? 'pickd' : ''}" data-toggle="${s.id}" ${full ? 'disabled style="opacity:.5"' : ''}>
      ${picked ? '✓ U usporedbi — ukloni' : full ? 'Usporedba je puna (3)' : '+ Dodaj u usporedbu'}</button>
  </div>`;
}
function openPopup(s) {
  markers[s.id].unbindPopup().bindPopup(popupHtml(s), { offset: [0, -24], maxWidth: 320 }).openPopup();
}

/* ---------- render: step 1 ---------- */
function renderBiz() {
  $('#biz-chips').innerHTML = BIZ.map(b => `<button class="chip ${b.id === state.biz.id ? 'active' : ''}" data-biz="${b.id}"><span class="em">${b.em}</span>${b.name}</button>`).join('');
}
function renderPrio() {
  const opts = [['Nebitno', 0], ['Važno', 1], ['Ključno', 2]];
  $('#prio').innerHTML = PRIO.map(p => `<div class="prio-row"><span>${p.label}</span><div class="seg">${opts.map(([l, v]) =>
    `<button data-prio="${p.key}" data-v="${v}" class="${state.prio[p.key] === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>`).join('');
}
function renderArea() {
  const [lo, hi] = state.area; const min = 5, max = 300;
  $('#area-min').value = lo; $('#area-max').value = hi;
  $('#area-val').textContent = `${lo} – ${hi} m²`;
  const f = $('#area-fill'); f.style.left = ((lo - min) / (max - min) * 100) + '%'; f.style.width = ((hi - lo) / (max - min) * 100) + '%';
}
function renderList() {
  const r = ranked();
  const ok = new Set(r.map(o => o.s.id));
  const rankOf = Object.fromEntries(r.map((o, i) => [o.s.id, i + 1]));
  $('#match-count').textContent = r.length;
  $('#list').innerHTML = r.slice(0, 40).map((o, i) => {
    const s = o.s; const picked = state.picks.includes(s.id);
    const lab = picked ? LETTERS[state.picks.indexOf(s.id)] : i + 1;
    return `<li class="item ${picked ? 'picked' : ''}" data-id="${s.id}">
      <div class="rank">${lab}</div>
      <div><div class="addr">${pretty(s.addr)}</div>
        <div class="meta">${fmt(s.area, s.area % 1 ? 1 : 0)} m² · ${pretty(s.district)} · 🚏 ${Math.round(s.stopDist)} m</div>
        <div style="margin-top:5px">${reasons(o).map(t => `<span class="tag good">${t}</span>`).join('')}${s.tender ? '<span class="tag warn">natječaj</span>' : ''}</div></div>
      <button class="add-btn" data-toggle="${s.id}" title="Dodaj u usporedbu">${picked ? '✓' : '+'}</button></li>`;
  }).join('') || `<div class="empty-state"><div class="big">🔍</div>Nijedan prostor ne odgovara. Proširite raspon površine.</div>`;
  // markers
  SPACES.forEach(s => {
    const pi = state.picks.indexOf(s.id);
    const cls = pi >= 0 ? 'pick' : ok.has(s.id) ? '' : 'off';
    const lab = pi >= 0 ? LETTERS[pi] : ok.has(s.id) ? (rankOf[s.id] <= 99 ? rankOf[s.id] : '') : '';
    markers[s.id].setIcon(pinIcon(cls, lab));
    markers[s.id].setZIndexOffset(pi >= 0 ? 1000 : ok.has(s.id) ? 500 - rankOf[s.id] : -500);
  });
  renderRings(); renderTray();
}
function reasons(o) {
  const t = [];
  if (o.sc.transit > .75) t.push(o.s.tram400 ? 'tramvaj blizu' : 'ZET blizu');
  if (o.sc.area > .85) t.push('idealna površina');
  if (o.s.position === 'ULIČNI') t.push('ulični');
  if (o.sc.density > .75) t.push('gusta četvrt');
  return t.slice(0, 3);
}
function renderRings() {
  ringLayer.clearLayers();
  state.picks.forEach(id => { const s = byId(id); L.circle([s.lat, s.lng], { radius: 400, color: '#5b5bd6', weight: 1.5, dashArray: '4 6', fillColor: '#5b5bd6', fillOpacity: .05, interactive: false }).addTo(ringLayer); });
}
function renderTray() {
  const t = $('#tray'); t.classList.toggle('empty', !state.picks.length || state.step !== 1);
  t.innerHTML = [0, 1, 2].map(i => `<div class="slot ${state.picks[i] ? 'full' : ''}">${state.picks[i] ? LETTERS[i] : '+'}</div>`).join('') +
    `<button class="btn" data-go="2">Usporedi ${state.picks.length} →</button>`;
}

/* ---------- step 2: compare ---------- */
function level(v) { return v > .7 ? '' : v > .4 ? 'mid' : 'low'; }
function renderCompare() {
  const el = $('#compare');
  if (!state.picks.length) {
    el.innerHTML = `<div class="empty-state"><div class="big">📍</div>Odaberite do 3 prostora na karti ili u popisu.<div class="cta-row"><button class="btn" data-auto>Predloži 3 najbolja za mene</button><button class="btn ghost" data-go="1">← Natrag na kartu</button></div></div>`;
    return;
  }
  const C = state.picks.map(id => { const s = byId(id); const sc = scores(s); return { s, sc, t: total(sc) }; });
  const best = C.reduce((a, b) => b.t > a.t ? b : a);
  el.innerHTML = `<div class="cards">${C.map((c, i) => {
    const s = c.s; const d = DISTRICTS[s.district];
    const rows = [
      ['Površina', c.sc.area, `${fmt(s.area, s.area % 1 ? 1 : 0)} m²`],
      ['Javni prijevoz', c.sc.transit, `${Math.round(s.stopDist)} m · ${s.lines400} lin.`],
      ['Gustoća četvrti', c.sc.density, d ? `${fmt(d.dens)}/km²` : '—'],
      ['Položaj', c.sc.street, pretty(s.position || '—')],
    ];
    return `<div class="ccard ${c === best && C.length > 1 ? 'best' : ''}">
      ${c === best && C.length > 1 ? '<div class="best-tag">Najbolje uz vaše prioritete</div>' : ''}
      <div class="ccard-head"><div class="letter">${LETTERS[i]}</div><div><h3>${pretty(s.addr)}</h3><div class="sub">${pretty(s.district)} · zona ${s.zone}</div></div>
        <button class="x" data-toggle="${s.id}" title="Ukloni">✕</button></div>
      <div class="bars">${rows.map(([l, v, txt]) => `<div class="bar-row"><span class="lbl">${l}</span><div class="bar"><div class="${level(v)}" style="width:${Math.round(v * 100)}%"></div></div><span class="v">${txt}</span></div>`).join('')}</div>
      <div class="why">${explain(c, C)}</div>
    </div>`;
  }).join('')}</div>
  <div class="cta-row"><button class="btn" data-go="3">Izračunaj troškove →</button><button class="btn ghost" data-go="1">← Dodaj ili promijeni prostore</button></div>`;
}
function explain(c, C) {
  const s = c.s; const others = C.filter(o => o !== c); const good = [], bad = [];
  const names = { area: 'traženoj površini', transit: 'javnom prijevozu', density: 'gušće naseljenoj četvrti', street: 'uličnom položaju' };
  if (others.length) {
    for (const k of ['area', 'transit', 'density', 'street']) {
      if (!state.prio[k]) continue;
      if (others.every(o => c.sc[k] > o.sc[k] + .05)) good.push(k);
      else if (others.every(o => c.sc[k] < o.sc[k] - .05)) bad.push(k);
    }
  }
  let txt = '';
  const phr = { area: 'bolje odgovara traženoj površini', transit: `bliži je javnom prijevozu (${s.stopName}, ${Math.round(s.stopDist)} m)`, density: 'nalazi se u gušće naseljenoj četvrti', street: 'ima ulični položaj' };
  const phrBad = { area: 'površinom najmanje odgovara', transit: 'najslabije je povezan javnim prijevozom', density: 'je u rjeđe naseljenoj četvrti', street: 'nema ulični položaj' };
  if (good.length) txt += `Ovaj prostor <b>${good.map(k => phr[k]).join(' i ')}</b> od ostalih kandidata. `;
  if (bad.length) txt += `Slabija strana: ${bad.map(k => phrBad[k]).join(', ')}. `;
  if (!others.length) txt += `${s.tram400 ? 'Tramvaj' : 'Stajalište'} unutar ${Math.round(s.stopDist)} m; u krugu 400 m ${s.stops400} stajališta. `;
  if (!good.length && !bad.length && others.length) txt += c.t >= Math.max(...others.map(o => o.t)) ? 'Nema jedne izrazite prednosti, ali <b>ukupno najbolje pokriva vaše prioritete</b>. ' : 'Po vašim prioritetima nalazi se između ostalih kandidata. ';
  return txt + `<span class="unk">⚠ Aktualna raspoloživost i mogućnost obavljanja djelatnosti nisu potvrđene.${s.tender ? ' Za prostor je evidentiran natječaj u tijeku.' : ''}</span>`;
}

/* ---------- step 3: calculator ---------- */
function rentOf(s) { return state.rent[s.id] ?? ZONE_RENT[s.zone] ?? 8; }
function costs(s, rentM2 = rentOf(s)) {
  const c = state.calc;
  const parts = {
    rent: rentM2 * s.area,
    util: c.utilM2 * s.area,
    staff: c.staff,
    other: c.other,
    fit: c.fitM2 * s.area / c.months,
  };
  parts.total = parts.rent + parts.util + parts.staff + parts.other + parts.fit;
  parts.units = Math.ceil(parts.total / c.contrib);
  return parts;
}
const COLORS = { rent: '#ff5a36', util: '#f2a541', staff: '#5b5bd6', other: '#9aa3b5', fit: '#17b890' };
const CLAB = { rent: 'Zakupnina', util: 'Režije', staff: 'Plaće', other: 'Ostalo fiksno', fit: 'Uređenje (mjesečno)' };

function slider(id, label, val, min, max, step, show, hint = '') {
  return `<div class="slider"><div class="field-head"><label>${label}</label><span class="val" id="${id}-v">${show(val)}</span></div>
    <input type="range" class="single" data-calc="${id}" min="${min}" max="${max}" step="${step}" value="${val}" />${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
}
let lastUnits = 0;
function renderCalc(full = true) {
  const el = $('#calc');
  if (!state.picks.length) { el.innerHTML = `<div class="empty-state"><div class="big">🧮</div>Prvo odaberite barem jedan prostor.<div class="cta-row"><button class="btn" data-auto>Predloži 3 najbolja za mene</button></div></div>`; return; }
  if (state.active >= state.picks.length) state.active = 0;
  const s = byId(state.picks[state.active]); const b = state.biz; const c = state.calc;
  if (full) {
    el.innerHTML = `
      <div class="cand-tabs">${state.picks.map((id, i) => { const x = byId(id); return `<button data-active="${i}" class="${i === state.active ? 'on' : ''}">${LETTERS[i]} · ${fmt(x.area, 0)} m²<small>${pretty(x.addr).slice(0, 20)}</small></button>`; }).join('')}</div>
      <div class="hero" id="hero"></div>
      <div class="field">
        ${slider('rent', `Zakupnina — prostor ${LETTERS[state.active]}`, rentOf(s), 1, 30, 0.5, v => `${fmt(+v, 1)} €/m²`, `Pretpostavka za zonu ${s.zone}. Nije službena cijena ni ponuda.`)}
        ${slider('fitM2', 'Ulaganje u uređenje', c.fitM2, 0, 600, 10, v => `${fmt(+v)} €/m²`, `Raspoređeno na ${c.months} mjeseci`)}
        ${slider('contrib', `Ostaje vam po jedinici (${b.unit})`, c.contrib, b.contrib < 3 ? 0.1 : 1, b.contrib < 3 ? 5 : 120, b.contrib < 3 ? 0.1 : 1, v => `${fmt(+v, b.contrib < 3 ? 1 : 0)} €`, 'Cijena minus dijelovi, materijal i ostali varijabilni troškovi')}
      </div>
      <div class="field">
        ${slider('staff', 'Plaće (mjesečno)', c.staff, 0, 8000, 100, v => eur(+v))}
        ${slider('utilM2', 'Režije', c.utilM2, 0, 10, 0.5, v => `${fmt(+v, 1)} €/m²`)}
        ${slider('other', 'Ostali fiksni troškovi', c.other, 0, 2000, 50, v => eur(+v), 'Knjigovodstvo, osiguranje, softver…')}
        ${slider('months', 'Rok povrata uređenja', c.months, 6, 84, 6, v => `${v} mj.`)}
      </div>
      <div id="verdict"></div>
      <div class="field chart"><p class="sec-title">Kako zakupnina mijenja računicu</p><p class="sec-sub">Potrebno ${b.units} mjesečno ovisno o zakupnini prostora ${LETTERS[state.active]}</p><div id="chart"></div></div>
      <div class="field"><p class="sec-title">Svi kandidati uz trenutne pretpostavke</p><div class="cmp-mini" id="mini"></div></div>
      <p class="note">Ilustrativni izračun na temelju vaših pretpostavki — nije prognoza prihoda ni potvrda da je prostor dostupan. Zakupnina po zoni je polazna pretpostavka; stvarne uvjete propisuje Grad Zagreb u natječaju.</p>`;
  }
  const p = costs(s);
  // hero
  const perDay = p.units / c.days;
  $('#hero').innerHTML = `<div class="label">Mjesečni fiksni troškovi: <b>${eur(p.total)}</b> · po jedinici ostaje ${fmt(c.contrib, c.contrib < 3 ? 1 : 0)} €</div>
    <div class="num"><span id="units">${fmt(lastUnits)}</span><small>${b.units} / mj.</small></div>
    <div class="per">≈ <b>${fmt(perDay, perDay < 10 ? 1 : 0)} dnevno</b> (${c.days} radnih dana) da pokrijete troškove</div>
    <div class="breakdown">${Object.keys(COLORS).map(k => `<div style="width:${p[k] / p.total * 100}%;background:${COLORS[k]}"></div>`).join('')}</div>
    <div class="bk-legend" style="color:#c9cfdc">${Object.keys(COLORS).filter(k => p[k] > 0).map(k => `<span><i style="background:${COLORS[k]}"></i>${CLAB[k]} ${eur(p[k])}</span>`).join('')}</div>`;
  tween($('#units'), lastUnits, p.units); lastUnits = p.units;
  // verdict + mini
  const C = state.picks.map((id, i) => { const x = byId(id); return { s: x, i, p: costs(x) }; }).sort((a, b) => a.p.total - b.p.total);
  const maxU = Math.max(...C.map(x => x.p.units));
  $('#mini').innerHTML = [...C].sort((a, b) => a.i - b.i).map(x => `<div class="r"><div class="l">${LETTERS[x.i]}</div><span>${pretty(x.s.addr)} <span class="muted">· ${fmt(rentOf(x.s), 1)} €/m²</span></span><b>${fmt(x.p.units)}</b>
      <div class="bar"><div class="${x === C[0] ? '' : 'mid'}" style="width:${x.p.units / maxU * 100}%"></div></div></div>`).join('');
  let v = '';
  if (C.length > 1) {
    const A = C[0], B = C[1];
    const flip = rentOf(A.s) + (B.p.total - A.p.total) / A.s.area;
    v = `<div class="verdict">Uz ove pretpostavke <b>prostor ${LETTERS[A.i]}</b> traži najmanje posla: <b>${fmt(A.p.units)} ${b.units}</b> mjesečno, ${fmt(B.p.units - A.p.units)} manje od prostora ${LETTERS[B.i]}.
      <div class="flip">↺ Ako zakupnina prostora ${LETTERS[A.i]} prijeđe <b>${fmt(flip, 1)} €/m²</b> (${eur(flip * A.s.area)} mjesečno), prostor ${LETTERS[B.i]} postaje povoljniji.</div>`;
    const loc = state.picks.map((id, i) => ({ i, t: total(scores(byId(id))) })).sort((a, b) => b.t - a.t)[0];
    if (loc.i !== A.i) v += `<div class="flip">📍 Lokacijski najbolje odgovara prostor ${LETTERS[loc.i]} — odlučite je li razlika od ${fmt(costs(byId(state.picks[loc.i])).units - A.p.units)} ${b.units} mjesečno vrijedna toga.</div>`;
    v += '</div>';
  }
  $('#verdict').innerHTML = v;
  renderChart(s, C);
}
function renderChart(s, C) {
  const W = 400, H = 190, pl = 40, pr = 12, pt = 12, pb = 28;
  const r0 = 1, r1 = 30; const cur = rentOf(s);
  const uAt = (r) => costs(s, r).units;
  const others = C.filter(x => x.s.id !== s.id);
  const maxY = Math.max(uAt(r1), ...others.map(o => o.p.units)) * 1.08;
  const X = (r) => pl + (r - r0) / (r1 - r0) * (W - pl - pr), Y = (u) => pt + (1 - u / maxY) * (H - pt - pb);
  const pts = []; for (let r = r0; r <= r1; r += .5) pts.push(`${X(r).toFixed(1)},${Y(uAt(r)).toFixed(1)}`);
  const ticksY = 4; let grid = '';
  for (let i = 0; i <= ticksY; i++) { const u = maxY * i / ticksY; grid += `<line x1="${pl}" x2="${W - pr}" y1="${Y(u)}" y2="${Y(u)}" stroke="#eee8df"/><text x="${pl - 6}" y="${Y(u) + 3}" text-anchor="end" font-size="9" fill="#8a93a8">${fmt(u)}</text>`; }
  for (const r of [5, 10, 15, 20, 25, 30]) grid += `<text x="${X(r)}" y="${H - 12}" text-anchor="${r === 30 ? 'end' : 'middle'}" font-size="9" fill="#8a93a8">${r === 30 ? '30 €/m²' : r}</text>`;
  let prevY = -99, side = 0;
  const oth = [...others].sort((a, b) => a.p.units - b.p.units).map(o => {
    const y = Y(o.p.units); side = Math.abs(y - prevY) < 14 ? 1 - side : 0; prevY = y;
    const lx = side ? pl + 4 : W - pr - 2;
    return `<line x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}" stroke="#5b5bd6" stroke-dasharray="4 4" stroke-width="1.5" opacity=".55"/>
     <text x="${lx}" y="${y - 4}" text-anchor="${side ? 'start' : 'end'}" font-size="10" font-weight="700" fill="#5b5bd6">${LETTERS[o.i]} · ${fmt(o.p.units)}</text>`;
  }).join('');
  const cu = uAt(cur);
  $('#chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}">${grid}${oth}
    <polyline points="${pts.join(' ')}" fill="none" stroke="#ff5a36" stroke-width="3" stroke-linecap="round"/>
    <line x1="${X(cur)}" x2="${X(cur)}" y1="${pt}" y2="${H - pb}" stroke="#15233f" stroke-dasharray="2 3" opacity=".4"/>
    <circle cx="${X(cur)}" cy="${Y(cu)}" r="6" fill="#fff" stroke="#ff5a36" stroke-width="3"/>
    <text x="${X(cur) + (X(cur) > W - 90 ? -10 : 10)}" y="${Y(cu) - 8}" text-anchor="${X(cur) > W - 90 ? 'end' : 'start'}" font-size="11" font-weight="800" fill="#15233f">${LETTERS[state.active]} · ${fmt(cu)}</text>
    <text x="${(pl + W - pr) / 2}" y="${H - 1}" text-anchor="middle" font-size="9" fill="#8a93a8">zakupnina prostora ${LETTERS[state.active]} →</text></svg>`;
}
function tween(el, from, to) {
  const t0 = performance.now(), dur = 450;
  const f = (t) => { const k = clamp((t - t0) / dur); const e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(Math.round(from + (to - from) * e)); if (k < 1) requestAnimationFrame(f); };
  requestAnimationFrame(f);
}

/* ---------- navigation & events ---------- */
function go(step) {
  state.step = step;
  document.querySelectorAll('.step').forEach(b => b.classList.toggle('active', +b.dataset.step === step));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + step));
  if (step === 2) renderCompare();
  if (step === 3) { lastUnits = 0; renderCalc(); }
  renderTray();
  $('#panel').scrollTop = 0;
  if (step > 1 && state.picks.length) map.flyToBounds(L.latLngBounds(state.picks.map(id => [byId(id).lat, byId(id).lng])).pad(.6), { maxZoom: 15, duration: .8 });
}
function togglePick(id) {
  const i = state.picks.indexOf(id);
  if (i >= 0) state.picks.splice(i, 1); else if (state.picks.length < 3) state.picks.push(id); else return;
  renderList();
  if (state.step === 2) renderCompare();
  if (state.step === 3) renderCalc();
}
function autoPick() {
  state.picks = ranked().slice(0, 3).map(o => o.s.id);
  renderList();
  go(state.step === 1 ? 2 : state.step);
}
function setBiz(id) {
  const b = BIZ.find(x => x.id === id); state.biz = b;
  state.area = [...b.area]; state.prio = { ...b.prio };
  Object.assign(state.calc, { staff: b.staff, other: b.other, contrib: b.contrib });
  renderBiz(); renderPrio(); renderArea(); renderList();
}

document.addEventListener('click', (e) => {
  const t = e.target;
  const biz = t.closest('[data-biz]'); if (biz) return setBiz(biz.dataset.biz);
  const pr = t.closest('[data-prio]'); if (pr) { state.prio[pr.dataset.prio] = +pr.dataset.v; renderPrio(); return renderList(); }
  const tg = t.closest('[data-toggle]'); if (tg && !t.closest('#map')) { e.stopPropagation(); return togglePick(tg.dataset.toggle); }
  const g = t.closest('[data-go]'); if (g) return go(+g.dataset.go);
  const st = t.closest('.step'); if (st) return go(+st.dataset.step);
  if (t.closest('[data-auto]')) return autoPick();
  const ac = t.closest('[data-active]'); if (ac) { state.active = +ac.dataset.active; lastUnits = 0; return renderCalc(); }
  const it = t.closest('.item'); if (it) { const s = byId(it.dataset.id); map.flyTo([s.lat, s.lng], 16, { duration: .7 }); setTimeout(() => openPopup(s), 720); }
});
document.addEventListener('mouseover', (e) => {
  const it = e.target.closest('.item'); document.querySelectorAll('.pin.hl').forEach(p => p.classList.remove('hl'));
  if (it) markers[it.dataset.id]?.getElement()?.querySelector('.pin')?.classList.add('hl');
});
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'area-min' || t.id === 'area-max') {
    let lo = +$('#area-min').value, hi = +$('#area-max').value;
    if (lo > hi - 5) { if (t.id === 'area-min') lo = hi - 5; else hi = lo + 5; }
    state.area = [lo, hi]; renderArea(); renderList();
  }
  if (t.id === 'only-street') { state.onlyStreet = t.checked; renderList(); }
  if (t.id === 'hide-tender') { state.hideTender = t.checked; renderList(); }
  if (t.dataset.calc) {
    const k = t.dataset.calc, v = +t.value;
    if (k === 'rent') state.rent[state.picks[state.active]] = v; else state.calc[k] = v;
    const lbl = $('#' + k + '-v');
    const shows = { rent: x => `${fmt(x, 1)} €/m²`, fitM2: x => `${fmt(x)} €/m²`, contrib: x => `${fmt(x, state.biz.contrib < 3 ? 1 : 0)} €`, staff: eur, utilM2: x => `${fmt(x, 1)} €/m²`, other: eur, months: x => `${x} mj.` };
    lbl.textContent = shows[k](v);
    if (k === 'months') document.querySelector('[data-calc=fitM2]')?.parentElement.querySelector('.hint')?.replaceChildren(`Raspoređeno na ${v} mjeseci`);
    renderCalc(false);
  }
});

(async function init() {
  await load();
  initMap();
  renderBiz(); renderPrio(); renderArea(); renderList();
})();
