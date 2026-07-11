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
  pos: null,                  // last known {lat,lng} from GPS
  locWatch: null,             // geolocation watch id
  userMarker: null,           // marker for user's location
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
  maybeAutoLocate();
});

// On load, if location was already granted before, resume it silently (no prompt).
function maybeAutoLocate() {
  if (!navigator.permissions || !navigator.permissions.query) return;
  navigator.permissions.query({ name: 'geolocation' }).then(p => {
    if (p.state === 'granted') requestLocation(false);
    else if (p.state === 'denied') setLocBtn('blocked', 'Blocked — tap 🔒');
  }).catch(() => {});
}

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
  document.getElementById('locBtn').onclick = () => requestLocation(true);
  document.getElementById('mapHandle').onclick = toggleMap;
}

/* --- map collapse/expand --- */
function setMap(expanded) {
  const wrap = document.getElementById('mapwrap');
  const handle = document.getElementById('mapHandle');
  wrap.classList.toggle('expanded', expanded);
  wrap.classList.toggle('collapsed', !expanded);
  handle.querySelector('.handle-label').textContent = expanded ? '🗺️ Hide map' : '🗺️ Show map';
  // Leaflet needs a size recalc after the container changes height
  setTimeout(() => { if (state.map) state.map.invalidateSize(); }, 300);
}
function toggleMap() {
  const collapsed = document.getElementById('mapwrap').classList.contains('collapsed');
  setMap(collapsed);   // if currently collapsed, expand; else collapse
}

/* --- location permission + tracking --- */
function setLocBtn(cls, label) {
  const b = document.getElementById('locBtn');
  b.className = 'locbtn ' + cls;
  document.getElementById('locState').textContent = label;
}

function requestLocation(userInitiated) {
  if (!navigator.geolocation) { setLocBtn('blocked', 'No GPS'); return; }
  setLocBtn('locating', 'Locating…');

  // If the Permissions API says it's blocked, guide the user.
  if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: 'geolocation' }).then(p => {
      if (p.state === 'denied') {
        setLocBtn('blocked', 'Blocked — tap 🔒');
        if (userInitiated) alert(
          'Location is blocked for this site.\n\nTo enable on Android Chrome:\n' +
          '1. Tap the 🔒 / ⓘ icon left of the address bar\n' +
          '2. Permissions → Location → Allow\n3. Reload the page.');
      }
    });
  }

  // Start a watch so we keep an updated position for "next stop".
  if (state.locWatch != null) navigator.geolocation.clearWatch(state.locWatch);
  state.locWatch = navigator.geolocation.watchPosition(
    pos => {
      state.pos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setLocBtn('on', 'Location on');
      showUserMarker();
    },
    err => {
      if (err.code === err.PERMISSION_DENIED) {
        setLocBtn('blocked', 'Blocked — tap 🔒');
        if (userInitiated) alert(
          'Location permission was denied.\n\nEnable it via the 🔒 icon in the address bar → ' +
          'Permissions → Location → Allow, then reload.');
      } else {
        setLocBtn('', 'Location off');
      }
    },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
  );
}

function showUserMarker() {
  if (!state.pos || !state.map) return;
  const ll = [state.pos.lat, state.pos.lng];
  if (state.userMarker) { state.userMarker.setLatLng(ll); return; }
  state.userMarker = L.circleMarker(ll, {
    radius: 8, color: '#fff', weight: 3, fillColor: '#1a73e8', fillOpacity: 1
  }).addTo(state.map).bindPopup('You are here');
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

function drawMarkers(day, fit = true) {
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
  if (fit && line.length) state.map.fitBounds(L.latLngBounds(line).pad(0.25));
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
  // refresh marker icons for selection outline (don't re-fit bounds)
  const day = state.data.days[state.dayIdx];
  drawMarkers(day, false);
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

  // Use the shared watched position. If we don't have one yet, request it and retry.
  if (!state.pos) {
    txt.textContent = 'Getting your location…';
    requestLocation(true);
    setTimeout(() => { if (state.pos) suggestNext(); else fallbackNext(candidates, txt, 'Location off'); }, 3500);
    return;
  }

  const here = state.pos;
  let best = null, bestD = Infinity;
  candidates.forEach(s => {
    const d = haversine(here, { lat: s.lat, lng: s.lng });
    if (d < bestD) { bestD = d; best = s; }
  });
  const dirs = `https://www.google.com/maps/dir/?api=1&destination=${best.lat},${best.lng}` +
    (best.place_id ? `&destination_place_id=${best.place_id}` : '');
  txt.innerHTML = `Next: <b>${best.name}</b> · ${bestD.toFixed(bestD < 1 ? 2 : 1)} km ` +
    `<a class="chip map" href="${dirs}" target="_blank">directions</a>`;
  setMap(true);            // expand map so she can see where she's headed
  selectStop(best.id, false);
}

function fallbackNext(candidates, txt, reason) {
  // next un-done in planned order (main stops first by their order in the day)
  const best = candidates[0];
  txt.innerHTML = `${reason}. Next in plan: <b>${best.name}</b>`;
  setMap(true);
  selectStop(best.id, false);
}
