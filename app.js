/* Manasa's NYC Guide - interactive map + timeline.
   Vanilla JS + Leaflet. Progress persists in localStorage. */

const STORE_KEY = 'nyc-guide-progress';
const state = {
  data: null,
  dayIdx: 0,
  progress: loadProgress(),   // { stopId: 'done' | 'skipped' }
  selected: null,             // selected stop id
  markers: {},                // stopId -> leaflet marker (current day)
  layer: null,                // current day's layer group
  map: null,
};

function loadProgress() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; }
  catch (e) { return {}; }
}
function saveProgress() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state.progress));
}

function haversine(a, b) {
  const R = 6371, toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));   // km
}

/* --- init --- */
fetch('itinerary.json').then(r => r.json()).then(data => {
  state.data = data;
  buildDaySwitch();
  initMap();
  renderDay(0);
});

function initMap() {
  state.map = L.map('map', { zoomControl: true, tap: true });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap'
  }).addTo(state.map);
}

function buildDaySwitch() {
  const wrap = document.getElementById('dayswitch');
  wrap.innerHTML = '';
  state.data.days.forEach((d, i) => {
    const b = document.createElement('button');
    b.textContent = d.id.toUpperCase();
    b.onclick = () => renderDay(i);
    wrap.appendChild(b);
  });
  document.getElementById('resetBtn').onclick = () => {
    if (confirm('Clear all done/skipped ticks?')) {
      state.progress = {}; saveProgress(); renderDay(state.dayIdx);
    }
  };
  document.getElementById('nextBtn').onclick = suggestNext;
}

/* --- day rendering --- */
function mainStops(day) {
  return day.stops.filter(s => s.kind === 'main' && s.lat != null);
}
function allPlaceable(day) {
  // main + optional stops that have coords, for GPS next-stop
  const out = [];
  day.stops.forEach(s => {
    if (s.kind === 'main' && s.lat != null) out.push(s);
    (s.optionals || []).forEach(o => { if (o.lat != null) out.push(o); });
  });
  return out;
}

function renderDay(idx) {
  state.dayIdx = idx;
  state.selected = null;
  const day = state.data.days[idx];

  document.querySelectorAll('#dayswitch button').forEach((b, i) =>
    b.classList.toggle('active', i === idx));
  document.getElementById('daysub').textContent = day.sub;
  document.getElementById('dayend').textContent = '🕐 ~' + day.end;
  document.getElementById('daykm').textContent = '🚶 ~' + day.total_km + ' km';

  drawMarkers(day);
  renderTimeline(day);
}

function pinIcon(kind, status, num, sel) {
  const cls = ['pin', kind, status, sel ? 'sel' : ''].join(' ');
  const label = status === 'done' ? '✓' : (status === 'skipped' ? '✕' : (num != null ? num : '✦'));
  return L.divIcon({
    className: 'numicon',
    html: `<div class="${cls}"><span>${label}</span></div>`,
    iconSize: [28, 28], iconAnchor: [14, 28], popupAnchor: [0, -28],
  });
}

function drawMarkers(day) {
  if (state.layer) state.map.removeLayer(state.layer);
  state.markers = {};
  const group = L.layerGroup();
  const line = [];
  let num = 0;

  day.stops.forEach(s => {
    if (s.kind === 'main' && s.lat != null) {
      num++;
      line.push([s.lat, s.lng]);
      addMarker(group, s, num);
    }
    (s.optionals || []).forEach(o => { if (o.lat != null) addMarker(group, o, null); });
  });

  if (line.length > 1) {
    L.polyline(line, { color: '#6d3bf5', weight: 3, opacity: .5, dashArray: '1,6', lineCap: 'round' }).addTo(group);
  }
  state.layer = group.addTo(state.map);
  if (line.length) state.map.fitBounds(L.latLngBounds(line).pad(0.25));
}

function addMarker(group, s, num) {
  const status = state.progress[s.id] || 'todo';
  const m = L.marker([s.lat, s.lng], {
    icon: pinIcon(s.kind, status, num, state.selected === s.id)
  });
  m._stop = s; m._num = num;
  m.on('click', () => selectStop(s.id, true));
  m.bindPopup(popupHtml(s, num));
  m.addTo(group);
  state.markers[s.id] = m;
}

function popupHtml(s, num) {
  const status = state.progress[s.id] || 'todo';
  const time = s.arrive ? `<div class="time">${s.arrive}${s.depart ? ' – ' + s.depart : ''}</div>` : '';
  const links = [
    s.gmaps ? `<a class="chip map" href="${s.gmaps}" target="_blank">📍 Google Maps</a>` : '',
    s.reel ? `<a class="chip reel" href="${s.reel}" target="_blank">▶ reel</a>` : '',
  ].join(' ');
  return `<div style="min-width:180px">
    ${time}
    <div style="font-weight:700;font-size:15px">${num != null ? num + '. ' : '✦ '}${s.name}</div>
    ${s.note ? `<div style="font-size:12.5px;color:#555;margin-top:4px">${s.note}</div>` : ''}
    <div style="margin-top:7px">${links}</div>
    <div style="margin-top:8px;display:flex;gap:6px">
      <button onclick="toggle('${s.id}','done')" style="flex:1;border:none;border-radius:8px;padding:6px;font-weight:700;cursor:pointer;background:${status==='done'?'#37c07a':'#e7f8ee'};color:${status==='done'?'#fff':'#1c8a4e'}">✓ Done</button>
      <button onclick="toggle('${s.id}','skipped')" style="flex:1;border:none;border-radius:8px;padding:6px;font-weight:700;cursor:pointer;background:${status==='skipped'?'#999':'#f2f2f5'};color:${status==='skipped'?'#fff':'#777'}">Skip</button>
    </div>
  </div>`;
}

/* --- timeline --- */
function renderTimeline(day) {
  const tl = document.getElementById('timeline');
  tl.innerHTML = '';
  let num = 0;
  day.stops.forEach(s => {
    const isMain = s.kind === 'main';
    if (isMain && s.lat != null) num++;
    if (s.kind === 'start') { tl.appendChild(stopCard(s, null, day)); return; }
    tl.appendChild(stopCard(s, isMain && s.lat != null ? num : null, day));
  });
  // costs
  if (day.costs && day.costs.length) {
    const d = document.createElement('details'); d.className = 'costs';
    const rows = day.costs.map(([l, v]) =>
      `<tr class="${/total/i.test(l) ? 'total' : ''}"><td>${l}</td><td>${v}</td></tr>`).join('');
    d.innerHTML = `<summary>💰 Rough cost (per person)</summary><table>${rows}</table>`;
    tl.appendChild(d);
  }
}

function stopCard(s, num, day) {
  const status = state.progress[s.id] || 'todo';
  const card = document.createElement('div');
  card.className = 'stop ' + (status !== 'todo' ? status : '') + (state.selected === s.id ? ' sel' : '');
  card.id = 'card-' + s.id;

  const time = s.arrive ? `<span class="time">${s.arrive}${s.depart ? ' – ' + s.depart : ''}</span>` : '';
  const leg = s.leg ? `<div class="leg">${legIcon(s.leg)} ${s.leg}</div>` : '';
  const links = [
    s.gmaps ? `<a class="chip map" href="${s.gmaps}" target="_blank">📍 Map</a>` : '',
    s.reel ? `<a class="chip reel" href="${s.reel}" target="_blank">▶ reel</a>` : '',
  ].join(' ');

  const acts = s.kind === 'start' ? '' : `
    <div class="acts">
      <button class="done ${status === 'done' ? 'active-done' : ''}" onclick="toggle('${s.id}','done')">✓ Done</button>
      <button class="skip ${status === 'skipped' ? 'active-skip' : ''}" onclick="toggle('${s.id}','skipped')">Skip</button>
    </div>`;

  const opts = (s.optionals || []).map(o => {
    const os = state.progress[o.id] || 'todo';
    const olinks = [
      o.gmaps ? `<a class="chip map" href="${o.gmaps}" target="_blank">📍 Map</a>` : '',
      o.reel ? `<a class="chip reel" href="${o.reel}" target="_blank">▶ reel</a>` : '',
    ].join(' ');
    return `<div class="opt stop ${os !== 'todo' ? os : ''}" style="box-shadow:none;padding:4px 0;margin:6px 0;border:none" id="card-${o.id}">
      <div class="name"><span class="oflag">✦</span> ${o.name}</div>
      <div class="note">${o.note}</div>
      <div class="links">${olinks}</div>
      <div class="acts">
        <button class="done ${os === 'done' ? 'active-done' : ''}" onclick="toggle('${o.id}','done')">✓ Done</button>
        <button class="skip ${os === 'skipped' ? 'active-skip' : ''}" onclick="toggle('${o.id}','skipped')">Skip</button>
      </div>
    </div>`;
  }).join('');

  card.innerHTML = `
    <div class="srow">
      <div class="snum">${status === 'done' ? '✓' : status === 'skipped' ? '✕' : (num != null ? num : '•')}</div>
      <div class="sbody">
        ${time}${leg}
        <div class="name">${s.name}</div>
        ${s.note ? `<div class="note">${s.note}</div>` : ''}
        <div class="links">${links}</div>
        ${acts}
        ${opts ? `<div class="optwrap">${opts}</div>` : ''}
      </div>
    </div>`;

  if (s.lat != null) card.querySelector('.srow').onclick = (e) => {
    if (e.target.closest('button') || e.target.closest('a')) return;
    selectStop(s.id, false);
  };
  return card;
}

function legIcon(leg) {
  const m = leg.split(' ')[0];
  return { walking: '🚶', transit: '🚇', ferry: '⛴️', tram: '🚡', driving: '🚕' }[m] || '→';
}

/* --- interactions --- */
window.toggle = function (id, status) {
  state.progress[id] = (state.progress[id] === status) ? undefined : status;
  if (state.progress[id] === undefined) delete state.progress[id];
  saveProgress();
  renderDay(state.dayIdx);           // simplest: re-render current day
};

function selectStop(id, fromMap) {
  state.selected = id;
  // refresh marker icons for selection outline
  const day = state.data.days[state.dayIdx];
  drawMarkers(day);
  const m = state.markers[id];
  if (m) {
    if (!fromMap) { state.map.panTo(m.getLatLng()); m.openPopup(); }
  }
  // highlight + scroll timeline card
  document.querySelectorAll('.stop.sel').forEach(el => el.classList.remove('sel'));
  const card = document.getElementById('card-' + id);
  if (card) {
    card.classList.add('sel');
    if (fromMap) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

/* --- GPS next stop --- */
function suggestNext() {
  const day = state.data.days[state.dayIdx];
  const candidates = allPlaceable(day).filter(s => {
    const st = state.progress[s.id];
    return st !== 'done' && st !== 'skipped';
  });
  const txt = document.getElementById('nextText');
  if (!candidates.length) { txt.textContent = 'All done for today! 🎉'; return; }

  if (!navigator.geolocation) { fallbackNext(candidates, txt, 'No GPS'); return; }
  txt.textContent = 'Locating…';
  navigator.geolocation.getCurrentPosition(pos => {
    const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    let best = null, bestD = Infinity;
    candidates.forEach(s => {
      const d = haversine(here, { lat: s.lat, lng: s.lng });
      if (d < bestD) { bestD = d; best = s; }
    });
    const dirs = `https://www.google.com/maps/dir/?api=1&destination=${best.lat},${best.lng}` +
      (best.place_id ? `&destination_place_id=${best.place_id}` : '');
    txt.innerHTML = `Next: <b>${best.name}</b> · ${bestD.toFixed(bestD < 1 ? 2 : 1)} km ` +
      `<a class="chip map" href="${dirs}" target="_blank">directions</a>`;
    selectStop(best.id, false);
  }, err => {
    fallbackNext(candidates, txt, 'Location off');
  }, { enableHighAccuracy: true, timeout: 8000 });
}

function fallbackNext(candidates, txt, reason) {
  // next un-done in planned order (main stops first by their order in the day)
  const best = candidates[0];
  txt.innerHTML = `${reason}. Next in plan: <b>${best.name}</b>`;
  selectStop(best.id, false);
}
