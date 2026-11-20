/* LN DaTeh GPS - ứng dụng thu thập dữ liệu thực địa
   Công ty TNHH MTV Lâm nghiệp Đạ Tẻh */
(function () {
'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const fmtLen = m => m >= 1000 ? (m / 1000).toFixed(3) + ' km' : m.toFixed(1) + ' m';
const fmtArea = a => a >= 10000 ? (a / 10000).toFixed(4) + ' ha' : a.toFixed(1) + ' m² (' + (a / 10000).toFixed(4) + ' ha)';
const fmtTime = t => new Date(t).toLocaleString('vi-VN', { hour12: false });
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Chạy trong bản APK (Capacitor) hay trình duyệt
const NATIVE = !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());
const PLG = NATIVE ? Capacitor.Plugins : {};

function toast(msg, ms = 2500) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms);
}
function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res();
    const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s);
  });
}

/* ================= Trạng thái & cài đặt ================= */
const S = {
  set: {
    crs: CRS.DEFAULT, base: 'otm', labels: true, trackMinDist: 5, trackMaxAcc: 30, autoVertexDist: 10,
    avgCount: 10, stampPhoto: true, photoMax: 1600, mapboxToken: '', surveyor: ''
  },
  feats: new Map(), lyr: new Map(), pos: null, heading: null, follow: true,
  track: null, draw: null, nav: null, forms: [], custom: [], mbt: new Map(), sat: new Map(), lastFix: null
};
const KIND = {
  point: { n: 'Điểm', c: '#1e88e5', ic: '📍' }, line: { n: 'Đường', c: '#ef6c00', ic: '〰️' },
  polygon: { n: 'Vùng', c: '#2e7d32', ic: '⬠' }, marker: { n: 'Điểm mốc', c: '#c62828', ic: '🔺' },
  check: { n: 'Điểm kiểm tra', c: '#d81b60', ic: '🚩' }, track: { n: 'Tracklog', c: '#7b1fa2', ic: '🛰️' },
  import: { n: 'Dữ liệu nhập', c: '#455a64', ic: '📂' }
};

/* ================= Bản đồ ================= */
const map = L.map('map', { zoomControl: false, attributionControl: true, maxZoom: 22, tap: true }).setView([11.53, 107.53], 12);
L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
map.attributionControl.setPrefix('LN DaTeh GPS');

const OfflineTile = L.TileLayer.extend({
  createTile(coords, done) {
    const img = document.createElement('img'); img.alt = '';
    img.setAttribute('role', 'presentation');
    const url = this.getTileUrl(coords);
    const key = this.options.cid + '/' + coords.z + '/' + coords.x + '/' + coords.y;
    img.onload = () => { if (img._u) URL.revokeObjectURL(img._u); done(null, img); };
    img.onerror = e => done(e, img);
    DB.get('tiles', key).then(b => {
      if (b) { img._u = URL.createObjectURL(b); img.src = img._u; }
      else { if (this.options.crossOrigin) img.crossOrigin = ''; img.src = url; }
    }).catch(() => { img.src = url; });
    return img;
  }
});
const BASES = {
  otm: { n: 'Địa hình (OpenTopoMap - có đường bình độ)', u: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', mz: 17, a: '© OpenTopoMap, © OSM' },
  osm: { n: 'OpenStreetMap', u: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', mz: 19, a: '© OpenStreetMap' },
  esri: { n: 'Ảnh vệ tinh (Esri World Imagery)', u: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', mz: 19, a: '© Esri' },
  esritopo: { n: 'Esri World Topo', u: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', mz: 19, a: '© Esri' },
  mbsat: { n: 'Mapbox vệ tinh (cần token)', u: 'https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/256/{z}/{x}/{y}?access_token={token}', mz: 20, a: '© Mapbox', token: true },
  mbout: { n: 'Mapbox Outdoors (cần token)', u: 'https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/tiles/256/{z}/{x}/{y}?access_token={token}', mz: 20, a: '© Mapbox', token: true },
  none: { n: 'Không nền (chỉ dữ liệu offline)', u: null }
};
let baseLayer = null;
function allBases() {
  const o = Object.assign({}, BASES);
  S.custom.forEach(c => o[c.id] = { n: c.name, u: c.url, mz: c.mz || 20, a: c.name });
  return o;
}
function setBase(id) {
  const b = allBases()[id] || BASES.otm;
  if (baseLayer) map.removeLayer(baseLayer);
  baseLayer = null;
  S.set.base = id; saveSet();
  if (!b.u) return;
  let u = b.u;
  if (b.token) u = u.replace('{token}', S.set.mapboxToken || 'NO_TOKEN');
  baseLayer = new OfflineTile(u, { cid: id, maxNativeZoom: b.mz, maxZoom: 22, attribution: b.a, crossOrigin: true, subdomains: 'abc' }).addTo(map);
  baseLayer.bringToBack();
  baseLayer._srcUrl = u;
}

const groups = {};
Object.keys(KIND).forEach(k => groups[k] = L.featureGroup().addTo(map));
const tmpLayer = L.layerGroup().addTo(map);
const navLayer = L.layerGroup().addTo(map);

/* ================= Cài đặt lưu trữ ================= */
async function saveSet() { await DB.put('kv', 'settings', S.set); }
async function loadAll() {
  const s = await DB.get('kv', 'settings'); if (s) Object.assign(S.set, s);
  if (!CRS.BY[S.set.crs]) S.set.crs = CRS.DEFAULT;
  S.custom = (await DB.get('kv', 'customBases')) || [];
  S.forms = (await DB.get('kv', 'forms')) || defaultForms();
  const all = await DB.all('features');
  all.forEach(f => { S.feats.set(f.id, f); render(f); });
  setBase(S.set.base);
  const v = await DB.get('kv', 'view');
  if (v) map.setView(v.c, v.z);
  else if (all.length) try { map.fitBounds(L.featureGroup(Object.values(groups)).getBounds(), { maxZoom: 16 }); } catch (e) { }
  // MBTiles đã lưu
  const keys = await DB.keys('files');
  for (const k of keys) if (String(k).startsWith('mbt:')) {
    try { const r = await DB.get('files', k); await addMBTiles(r.buf, r.name, r.visible !== false, r.opacity, false); } catch (e) { console.warn(e); }
  }
  const at = await DB.get('kv', 'activeTrack');
  if (at && S.feats.get(at)) {
    if (confirm('Có tracklog đang ghi dở. Tiếp tục ghi?')) startTrack(S.feats.get(at)); else DB.del('kv', 'activeTrack');
  }
  updateCrsLabel();
}
map.on('moveend', () => DB.put('kv', 'view', { c: map.getCenter(), z: map.getZoom() }));

function defaultForms() {
  return [
    { id: 'f_lo', name: 'Điều tra lô rừng', fields: [
      { l: 'Tiểu khu', t: 'text' }, { l: 'Khoảnh', t: 'text' }, { l: 'Lô', t: 'text' },
      { l: 'Trạng thái rừng', t: 'select', o: 'Rừng giàu|Rừng trung bình|Rừng nghèo|Rừng phục hồi|Rừng tre nứa|Rừng hỗn giao|Rừng trồng|Đất trống có cây gỗ tái sinh|Đất trống|Đất khác' },
      { l: 'Loài cây ưu thế', t: 'text' }, { l: 'Năm trồng', t: 'number' }, { l: 'Mật độ (cây/ha)', t: 'number' },
      { l: 'D1.3 bình quân (cm)', t: 'number' }, { l: 'Hvn bình quân (m)', t: 'number' }, { l: 'Độ tàn che (0-1)', t: 'number' },
      { l: 'Chủ quản lý', t: 'select', o: 'Công ty LN Đạ Tẻh|Hộ nhận khoán|Cộng đồng|Khác' }, { l: 'Ghi chú', t: 'textarea' }] },
    { id: 'f_vp', name: 'Vi phạm lâm luật', fields: [
      { l: 'Loại vi phạm', t: 'select', o: 'Phá rừng trái pháp luật|Lấn chiếm đất lâm nghiệp|Khai thác rừng trái phép|Vận chuyển lâm sản trái phép|Gây cháy rừng|Săn bắt động vật rừng|Khác', r: 1 },
      { l: 'Tiểu khu', t: 'text' }, { l: 'Khoảnh', t: 'text' }, { l: 'Lô', t: 'text' },
      { l: 'Diện tích thiệt hại (m²)', t: 'number' }, { l: 'Khối lượng lâm sản (m³)', t: 'number' },
      { l: 'Đối tượng vi phạm', t: 'text' }, { l: 'Đã lập biên bản', t: 'checkbox' }, { l: 'Số biên bản', t: 'text' },
      { l: 'Người phát hiện', t: 'text' }, { l: 'Thời điểm phát hiện', t: 'datetime' }, { l: 'Mô tả hiện trường', t: 'textarea' }] },
    { id: 'f_pccc', name: 'PCCCR - Điểm cháy', fields: [
      { l: 'Cấp dự báo cháy', t: 'select', o: 'I|II|III|IV|V' }, { l: 'Diện tích cháy (m²)', t: 'number' },
      { l: 'Loại thực bì', t: 'select', o: 'Cỏ tranh|Le, lồ ô|Thông|Rừng trồng|Rừng tự nhiên|Khác' },
      { l: 'Nguyên nhân', t: 'select', o: 'Đốt nương rẫy|Vô ý|Cố ý|Chưa xác định' },
      { l: 'Lực lượng tham gia (người)', t: 'number' }, { l: 'Thời điểm phát hiện', t: 'datetime' }, { l: 'Đã khống chế', t: 'checkbox' }, { l: 'Ghi chú', t: 'textarea' }] },
    { id: 'f_tt', name: 'Tuần tra bảo vệ rừng', fields: [
      { l: 'Tổ/Chốt BVR', t: 'text' }, { l: 'Người tuần tra', t: 'text' },
      { l: 'Kết quả', t: 'select', o: 'Bình thường|Phát hiện vi phạm|Phát hiện điểm cháy|Cần kiểm tra lại', r: 1 }, { l: 'Ghi chú', t: 'textarea' }] }
  ];
}
async function saveForms() { await DB.put('kv', 'forms', S.forms); }

/* ================= Vẽ đối tượng lên bản đồ ================= */
function geomLatLngs(g) {
  if (g.type === 'Point') return L.latLng(g.coordinates[1], g.coordinates[0]);
  if (g.type === 'LineString') return g.coordinates.map(c => L.latLng(c[1], c[0]));
  if (g.type === 'Polygon') return g.coordinates[0].slice(0, -1).map(c => L.latLng(c[1], c[0]));
}
function lengthOf(lls) { let d = 0; for (let i = 1; i < lls.length; i++) d += lls[i - 1].distanceTo(lls[i]); return d; }
function areaOf(lls) {
  if (lls.length < 3) return 0;
  const p = lls.map(l => CRS.planar(S.set.crs, l.lng, l.lat));
  let a = 0; for (let i = 0; i < p.length; i++) { const j = (i + 1) % p.length; a += p[i][0] * p[j][1] - p[j][0] * p[i][1]; }
  return Math.abs(a / 2);
}
function measureOf(f) {
  const g = f.geom; if (!g) return {};
  if (g.type === 'LineString') return { len: lengthOf(geomLatLngs(g)) };
  if (g.type === 'Polygon') { const l = geomLatLngs(g); return { len: lengthOf(l.concat([l[0]])), area: areaOf(l) }; }
  return {};
}
function iconFor(f) {
  const k = KIND[f.kind] || KIND.import;
  if (f.kind === 'point' || f.kind === 'import') return null;
  return L.divIcon({ className: 'mk-icon', html: k.ic, iconSize: [24, 24], iconAnchor: f.kind === 'check' ? [4, 22] : [12, 18] });
}
function render(f) {
  const old = S.lyr.get(f.id); if (old) old.remove();
  const k = KIND[f.kind] || KIND.import, g = f.geom; let l;
  const grp = groups[f.kind] || groups.import;
  const color = (f.style && f.style.c) || k.c;
  try {
    if (g.type === 'Point') {
      const ic = iconFor(f);
      l = ic ? L.marker(geomLatLngs(g), { icon: ic }) : L.circleMarker(geomLatLngs(g), { radius: 7, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 });
    } else if (g.type === 'LineString') l = L.polyline(geomLatLngs(g), { color, weight: f.kind === 'track' ? 3 : 4, dashArray: f.kind === 'track' ? '6 4' : null });
    else if (g.type === 'Polygon') l = L.polygon(geomLatLngs(g), { color, weight: 3, fillOpacity: .2 });
    else l = L.geoJSON(g, { style: { color, weight: 3 }, pointToLayer: (p, ll) => L.circleMarker(ll, { radius: 6, color })});
  } catch (e) { console.warn('render', e); return; }
  if (S.set.labels && f.name) l.bindTooltip(esc(f.name), { permanent: g.type === 'Point', direction: 'right', className: 'vx-label', offset: [8, 0] });
  l.on('click', e => {
    L.DomEvent.stop(e);
    if (S.draw) return addVertex(e.latlng);
    openFeature(f.id);
  });
  l.addTo(grp); S.lyr.set(f.id, l);
}
async function saveFeature(f) {
  f.updated = Date.now();
  S.feats.set(f.id, f); await DB.put('features', f.id, f); render(f);
}
async function deleteFeature(id) {
  const f = S.feats.get(id); if (!f) return;
  for (const p of f.photos || []) await DB.del('photos', p);
  S.feats.delete(id); await DB.del('features', id);
  const l = S.lyr.get(id); if (l) l.remove(); S.lyr.delete(id);
}
function newFeature(kind, geom, extra) {
  return Object.assign({ id: uid(), kind, geom, name: '', formId: '', values: {}, note: '', photos: [], created: Date.now(), by: S.set.surveyor }, extra || {});
}

/* ================= GPS ================= */
let gpsMarker, accCircle, headCone, watchId;
function startGPS() {
  if (!('geolocation' in navigator)) { toast('Thiết bị không hỗ trợ GPS'); return; }
  watchId = navigator.geolocation.watchPosition(onPos, e => {
    $('#gpsDot').className = 'dot bad';
    if (e.code === 1) toast('Chưa cấp quyền vị trí. Vào cài đặt trình duyệt để cho phép.', 5000);
  }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
}
function onPos(p) {
  const c = p.coords; const ll = L.latLng(c.latitude, c.longitude);
  S.pos = { ll, acc: c.accuracy, alt: c.altitude, spd: c.speed, hdg: c.heading, t: p.timestamp };
  $('#gpsDot').className = 'dot ' + (c.accuracy <= 10 ? 'good' : c.accuracy <= 30 ? 'mid' : 'bad');
  if (!gpsMarker) {
    gpsMarker = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="gps-marker"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), interactive: false, zIndexOffset: 1000 }).addTo(map);
    accCircle = L.circle(ll, { radius: c.accuracy, color: '#1e88e5', weight: 1, fillOpacity: .08, interactive: false }).addTo(map);
    if (S.follow) map.setView(ll, Math.max(map.getZoom(), 16));
  } else { gpsMarker.setLatLng(ll); accCircle.setLatLng(ll).setRadius(c.accuracy); }
  if (S.follow) map.panTo(ll, { animate: true });
  // Nếu không có la bàn, dùng hướng di chuyển
  if (S.heading == null && c.heading != null && !isNaN(c.heading) && c.speed > 0.8) drawCone(c.heading);
  else drawCone(S.heading);
  updateStatus();
  if (S.track) trackPoint();
  if (S.draw && S.draw.auto) autoVertex();
  if (S.nav) updateNav();
  if (S.avg) S.avg.push(S.pos);
}
function drawCone(h) {
  if (!S.pos) return;
  if (h == null) { if (headCone) { headCone.remove(); headCone = null; } return; }
  const ll = S.pos.ll, z = map.getZoom();
  const r = 40 * Math.pow(2, 17 - z) * 1.2; // ~ pixel cố định
  const pts = [ll];
  for (let a = -25; a <= 25; a += 5) pts.push(dest(ll, h + a, r));
  if (!headCone) headCone = L.polygon(pts, { color: '#1e88e5', weight: 0, fillOpacity: .28, interactive: false }).addTo(map);
  else headCone.setLatLngs(pts);
}
function dest(ll, brg, d) {
  const R = 6371008.8, b = brg * Math.PI / 180, la = ll.lat * Math.PI / 180, lo = ll.lng * Math.PI / 180, dr = d / R;
  const la2 = Math.asin(Math.sin(la) * Math.cos(dr) + Math.cos(la) * Math.sin(dr) * Math.cos(b));
  const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(dr) * Math.cos(la), Math.cos(dr) - Math.sin(la) * Math.sin(la2));
  return L.latLng(la2 * 180 / Math.PI, lo2 * 180 / Math.PI);
}
function bearing(a, b) {
  const la1 = a.lat * Math.PI / 180, la2 = b.lat * Math.PI / 180, dl = (b.lng - a.lng) * Math.PI / 180;
  const y = Math.sin(dl) * Math.cos(la2), x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dl);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
function updateCrsLabel() { $('#stCrs').textContent = CRS.BY[S.set.crs].name; }
function updateStatus() {
  const p = S.pos; if (!p) return;
  const r = CRS.fromWGS(S.set.crs, p.ll.lng, p.ll.lat);
  $('#stLa').textContent = r.la; $('#stLb').textContent = r.lb; $('#stA').textContent = r.a; $('#stB').textContent = r.b;
  $('#stAcc').textContent = '±' + p.acc.toFixed(0) + ' m';
  $('#stAlt').textContent = 'Cao: ' + (p.alt != null ? p.alt.toFixed(0) + ' m' : '--');
  $('#stSpd').textContent = 'V: ' + (p.spd != null ? (p.spd * 3.6).toFixed(1) + ' km/h' : '--');
  const h = S.heading != null ? S.heading : p.hdg;
  $('#stHdg').textContent = 'Hướng: ' + (h != null && !isNaN(h) ? Math.round(h) + '° ' + dirName(h) : '--');
}
function dirName(h) { return ['B', 'ĐB', 'Đ', 'ĐN', 'N', 'TN', 'T', 'TB'][Math.round(h / 45) % 8]; }

/* ======= La bàn số ======= */
let compassOn = false;
function onOrient(e) {
  let h = null;
  if (e.webkitCompassHeading != null) h = e.webkitCompassHeading;
  else if (e.absolute && e.alpha != null) h = 360 - e.alpha;
  if (h == null) return;
  const so = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
  h = (h + so + 360) % 360;
  S.heading = S.heading == null ? h : smoothAngle(S.heading, h, 0.3);
  drawCone(S.heading);
  updateStatus();
  const rose = document.querySelector('.compass .rose');
  if (rose) { rose.style.transform = `rotate(${-S.heading}deg)`; const v = $('#compassVal'); if (v) v.textContent = Math.round(S.heading) + '° ' + dirName(S.heading); }
  if (S.nav) updateNav();
}
function smoothAngle(a, b, k) { let d = ((b - a + 540) % 360) - 180; return (a + d * k + 360) % 360; }
async function startCompass() {
  if (compassOn) return true;
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const r = await DeviceOrientationEvent.requestPermission(); if (r !== 'granted') { toast('Chưa cấp quyền la bàn'); return false; }
    }
  } catch (e) { }
  if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', onOrient);
  else window.addEventListener('deviceorientation', onOrient);
  compassOn = true; return true;
}

/* ================= Tracklog ================= */
let wakeLock = null, trackSaveT = 0;
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator) { wakeLock = await navigator.wakeLock.request('screen'); }
    else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) { }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.track) keepAwake(true);
  if (document.visibilityState === 'hidden' && S.track) persistTrack();
});
function startTrack(resume) {
  const f = resume || newFeature('track', { type: 'LineString', coordinates: [] }, { name: 'Tracklog ' + fmtTime(Date.now()), times: [] });
  S.track = f;
  if (!resume) saveFeature(f);
  DB.put('kv', 'activeTrack', f.id);
  $('#tbTrack').classList.add('rec'); $('#trkBadge').classList.remove('hidden');
  keepAwake(true); updateTrackBadge();
  if (PLG.BackgroundGeolocation) {
    PLG.BackgroundGeolocation.addWatcher({ backgroundTitle: 'LN DaTeh GPS', backgroundMessage: 'Đang ghi tracklog — chạm để mở ứng dụng', requestPermissions: true, stale: false, distanceFilter: S.set.trackMinDist },
      (loc, err) => {
        if (err) { if (err.code === 'NOT_AUTHORIZED' && confirm('Cần quyền vị trí "Luôn cho phép" để ghi tracklog nền. Mở cài đặt?')) PLG.BackgroundGeolocation.openSettings(); return; }
        if (loc) onPos({ coords: { latitude: loc.latitude, longitude: loc.longitude, accuracy: loc.accuracy, altitude: loc.altitude, speed: loc.speed, heading: loc.bearing }, timestamp: loc.time || Date.now() });
      }).then(id => { S.bgWatch = id; });
  }
  toast('Bắt đầu ghi tracklog. Có thể đồng thời vẽ Điểm/Đường/Vùng.');
}
function trackPoint() {
  const t = S.track, p = S.pos; if (!t || !p) return;
  if (p.acc > S.set.trackMaxAcc) return;
  const cs = t.geom.coordinates, last = cs[cs.length - 1];
  if (last && L.latLng(last[1], last[0]).distanceTo(p.ll) < S.set.trackMinDist) return;
  cs.push([+p.ll.lng.toFixed(7), +p.ll.lat.toFixed(7), p.alt != null ? +p.alt.toFixed(1) : 0]);
  (t.times = t.times || []).push(p.t);
  const l = S.lyr.get(t.id); if (l && l.addLatLng) l.addLatLng(p.ll); else render(t);
  updateTrackBadge();
  if (Date.now() - trackSaveT > 5000) persistTrack();
}
function persistTrack() { if (!S.track) return; trackSaveT = Date.now(); DB.put('features', S.track.id, S.track); }
function updateTrackBadge() {
  const t = S.track; if (!t) return;
  const len = lengthOf(geomLatLngs(t.geom));
  const dur = t.times && t.times.length ? (t.times[t.times.length - 1] - t.times[0]) / 60000 : 0;
  $('#trkInfo').textContent = `${fmtLen(len)} · ${t.geom.coordinates.length} điểm · ${dur.toFixed(0)} phút`;
}
async function stopTrack() {
  const t = S.track; S.track = null;
  $('#tbTrack').classList.remove('rec'); $('#trkBadge').classList.add('hidden');
  keepAwake(false); await DB.del('kv', 'activeTrack');
  if (S.bgWatch && PLG.BackgroundGeolocation) { PLG.BackgroundGeolocation.removeWatcher({ id: S.bgWatch }); S.bgWatch = null; }
  if (t.geom.coordinates.length < 2) { await deleteFeature(t.id); toast('Tracklog quá ngắn, đã hủy'); return; }
  await saveFeature(t); openFeature(t.id);
}

/* ================= Vẽ / đo ================= */
function startDraw(kind) {
  if (S.draw) cancelDraw();
  S.draw = { kind, pts: [], auto: false };
  $('#drawPanel').classList.remove('hidden'); $('#crosshair').classList.remove('hidden');
  $('#dpTitle').textContent = kind === 'line' ? 'Vẽ đường' : kind === 'polygon' ? 'Vẽ vùng' : 'Đo khoảng cách / diện tích';
  $('#dpAuto').classList.remove('on');
  document.querySelectorAll('#toolbar button').forEach(b => b.classList.toggle('on', b.dataset.act === kind || (kind === 'measure' && b.dataset.act === 'measure')));
  updateDraw();
}
function addVertex(ll) { if (!S.draw) return; S.draw.pts.push(L.latLng(ll.lat, ll.lng)); updateDraw(); if (navigator.vibrate) navigator.vibrate(20); }
function autoVertex() {
  const d = S.draw, p = S.pos; if (!d || !p || p.acc > S.set.trackMaxAcc) return;
  const last = d.pts[d.pts.length - 1];
  if (!last || last.distanceTo(p.ll) >= S.set.autoVertexDist) addVertex(p.ll);
}
function updateDraw() {
  const d = S.draw; tmpLayer.clearLayers(); if (!d) return;
  const pts = d.pts, poly = d.kind === 'polygon' || (d.kind === 'measure' && pts.length >= 3 && d.closed);
  if (pts.length > 1) {
    if (d.kind === 'polygon' || d.kind === 'measure') L.polygon(pts, { color: '#d50000', weight: 2, fillOpacity: .12, dashArray: d.kind === 'measure' ? '5 5' : null, interactive: false }).addTo(tmpLayer);
    else L.polyline(pts, { color: '#d50000', weight: 3, interactive: false }).addTo(tmpLayer);
  }
  pts.forEach((p, i) => L.circleMarker(p, { radius: 5, color: '#d50000', fillColor: '#fff', fillOpacity: 1, weight: 2, interactive: false }).addTo(tmpLayer));
  // nhãn cạnh
  for (let i = 1; i < pts.length; i++) {
    const m = L.latLng((pts[i - 1].lat + pts[i].lat) / 2, (pts[i - 1].lng + pts[i].lng) / 2);
    L.tooltip({ permanent: true, direction: 'center', className: 'vx-label' }).setLatLng(m).setContent(fmtLen(pts[i - 1].distanceTo(pts[i]))).addTo(tmpLayer);
  }
  let txt = '';
  if (d.kind === 'line') txt = 'Dài: ' + fmtLen(lengthOf(pts));
  else {
    const per = pts.length > 2 ? lengthOf(pts.concat([pts[0]])) : lengthOf(pts);
    txt = (d.kind === 'measure' ? 'Dài: ' + fmtLen(lengthOf(pts)) + ' · ' : '') + 'Chu vi: ' + fmtLen(per) + (pts.length > 2 ? ' · S: ' + fmtArea(areaOf(pts)) : '');
  }
  $('#dpMeasure').textContent = pts.length + ' đỉnh';
  $('#dpHint').textContent = txt;
}
function cancelDraw() {
  S.draw = null; tmpLayer.clearLayers();
  $('#drawPanel').classList.add('hidden'); $('#crosshair').classList.add('hidden');
  document.querySelectorAll('#toolbar button').forEach(b => b.classList.remove('on'));
}
async function finishDraw() {
  const d = S.draw; if (!d) return;
  const pts = d.pts.map(p => [+p.lng.toFixed(7), +p.lat.toFixed(7)]);
  if (d.kind === 'measure') {
    const lls = d.pts; cancelDraw();
    const len = lengthOf(lls), per = lls.length > 2 ? lengthOf(lls.concat([lls[0]])) : 0, ar = areaOf(lls);
    openSheet('Kết quả đo', body => {
      body.innerHTML = `<table class="kv"><tr><td>Số đỉnh</td><td>${lls.length}</td></tr><tr><td>Chiều dài tuyến</td><td>${fmtLen(len)}</td></tr>
        ${lls.length > 2 ? `<tr><td>Chu vi</td><td>${fmtLen(per)}</td></tr><tr><td>Diện tích</td><td><b>${ar.toFixed(1)} m²</b><br>${(ar / 10000).toFixed(4)} ha</td></tr>` : ''}</table>
        <p class="muted">Diện tích tính trên mặt phẳng chiếu ${esc(CRS.BY[S.set.crs].geo ? CRS.BY[CRS.DEFAULT].name : CRS.BY[S.set.crs].name)}.</p>
        <div class="row"><button class="btn" id="mSL">Lưu thành Đường</button>${lls.length > 2 ? '<button class="btn primary" id="mSP">Lưu thành Vùng</button>' : ''}</div>`;
      $('#mSL').onclick = async () => { const f = newFeature('line', { type: 'LineString', coordinates: pts }); await saveFeature(f); openFeature(f.id, true); };
      if ($('#mSP')) $('#mSP').onclick = async () => { const f = newFeature('polygon', { type: 'Polygon', coordinates: [pts.concat([pts[0]])] }); await saveFeature(f); openFeature(f.id, true); };
    });
    return;
  }
  if (d.kind === 'line' && pts.length < 2) return toast('Đường cần tối thiểu 2 đỉnh');
  if (d.kind === 'polygon' && pts.length < 3) return toast('Vùng cần tối thiểu 3 đỉnh');
  const geom = d.kind === 'line' ? { type: 'LineString', coordinates: pts } : { type: 'Polygon', coordinates: [pts.concat([pts[0]])] };
  const f = newFeature(d.kind, geom, d.editId ? {} : {});
  if (d.editId) { const o = S.feats.get(d.editId); o.geom = geom; cancelDraw(); await saveFeature(o); return openFeature(o.id); }
  cancelDraw(); await saveFeature(f); openFeature(f.id, true);
}

/* ================= Sheet (bảng trượt) ================= */
const stack = [];
function openSheet(title, fn, push) {
  if (!push) stack.length = 0;
  stack.push({ title, fn });
  showTop();
}
function showTop() {
  const top = stack[stack.length - 1];
  if (!top) return closeSheet();
  $('#sheet').classList.remove('hidden'); $('#sheetBg').classList.remove('hidden');
  $('#sheetTitle').textContent = top.title;
  $('#sheetBack').style.visibility = stack.length > 1 ? 'visible' : 'hidden';
  const b = $('#sheetBody'); b.innerHTML = ''; b.scrollTop = 0;
  if (top.cleanup) top.cleanup();
  top.cleanup = top.fn(b) || null;
}
function closeSheet() {
  stack.forEach(s => { if (typeof s.cleanup === 'function') s.cleanup(); });
  stack.length = 0; $('#sheet').classList.add('hidden'); $('#sheetBg').classList.add('hidden');
}
$('#sheetClose').onclick = closeSheet; $('#sheetBg').onclick = closeSheet;
$('#sheetBack').onclick = () => { const s = stack.pop(); if (s && typeof s.cleanup === 'function') s.cleanup(); showTop(); };
const sub = (title, fn) => openSheet(title, fn, true);

/* ================= Chi tiết đối tượng & thuộc tính ================= */
function fieldInput(fd, i, v) {
  const id = 'fv' + i, req = fd.r ? ' *' : '';
  let h = `<label class="f" for="${id}">${esc(fd.l)}${req}</label>`;
  v = v == null ? '' : v;
  switch (fd.t) {
    case 'number': return h + `<input id="${id}" type="number" step="any" inputmode="decimal" value="${esc(v)}">`;
    case 'textarea': return h + `<textarea id="${id}">${esc(v)}</textarea>`;
    case 'date': return h + `<input id="${id}" type="date" value="${esc(v)}">`;
    case 'datetime': return h + `<input id="${id}" type="datetime-local" value="${esc(v)}">`;
    case 'checkbox': return `<label class="f"><input id="${id}" type="checkbox" ${v ? 'checked' : ''}>${esc(fd.l)}</label>`;
    case 'select': return h + `<select id="${id}"><option value=""></option>${String(fd.o || '').split('|').map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    default: return h + `<input id="${id}" type="text" value="${esc(v)}">`;
  }
}
function coordRows(f) {
  const g = f.geom; let h = '';
  if (g.type === 'Point') {
    const r = CRS.fromWGS(S.set.crs, g.coordinates[0], g.coordinates[1]);
    const w = CRS.fromWGS('WGS84', g.coordinates[0], g.coordinates[1]);
    h += `<tr><td>${r.la} / ${r.lb}</td><td><b>${r.a} / ${r.b}</b></td></tr><tr><td>Vĩ / Kinh độ</td><td>${w.a}, ${w.b}</td></tr>`;
    if (S.pos) h += `<tr><td>Cách vị trí hiện tại</td><td>${fmtLen(S.pos.ll.distanceTo(geomLatLngs(g)))}</td></tr>`;
    if (f.acc) h += `<tr><td>Sai số khi đo</td><td>±${f.acc.toFixed(1)} m${f.avgN ? ' (TB ' + f.avgN + ' lần)' : ''}</td></tr>`;
  } else {
    const m = measureOf(f);
    if (m.len != null) h += `<tr><td>${g.type === 'Polygon' ? 'Chu vi' : 'Chiều dài'}</td><td><b>${fmtLen(m.len)}</b></td></tr>`;
    if (m.area != null) h += `<tr><td>Diện tích</td><td><b>${m.area.toFixed(1)} m² = ${(m.area / 10000).toFixed(4)} ha</b></td></tr>`;
    if (g.coordinates) h += `<tr><td>Số đỉnh</td><td>${g.type === 'Polygon' ? g.coordinates[0].length - 1 : g.coordinates.length}</td></tr>`;
    if (f.kind === 'track' && f.times && f.times.length > 1) h += `<tr><td>Thời gian</td><td>${fmtTime(f.times[0])} → ${fmtTime(f.times[f.times.length - 1])}</td></tr>`;
  }
  return h;
}
function openFeature(id, isNew) {
  const f = S.feats.get(id); if (!f) return;
  const k = KIND[f.kind] || KIND.import;
  const fn = body => {
    const form = S.forms.find(x => x.id === f.formId);
    body.innerHTML = `
      <div class="row"><span class="chip">${k.ic} ${k.n}</span><span class="muted" style="text-align:right">${fmtTime(f.created)}</span></div>
      <label class="f">Tên / Số hiệu</label><input id="fName" value="${esc(f.name)}" placeholder="VD: Lô 3 - K.2 - TK 412">
      <label class="f">Loại đối tượng</label>
      <select id="fKind">${Object.keys(KIND).filter(x => (f.geom.type === 'Point') === ['point', 'marker', 'check'].includes(x) || x === 'import' || x === f.kind)
        .map(x => `<option value="${x}" ${x === f.kind ? 'selected' : ''}>${KIND[x].n}</option>`).join('')}</select>
      <label class="f">Mẫu biểu thu thập</label>
      <select id="fForm"><option value="">— Không dùng mẫu —</option>${S.forms.map(x => `<option value="${x.id}" ${x.id === f.formId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
      <div id="fFields">${form ? form.fields.map((fd, i) => fieldInput(fd, i, f.values[fd.l])).join('') : ''}</div>
      ${f.kind === 'import' && f.values && Object.keys(f.values).length ? `<div class="sec">Thuộc tính gốc</div><table class="kv">${Object.keys(f.values).filter(x => !form || !form.fields.find(fd => fd.l === x)).map(x => `<tr><td>${esc(x)}</td><td>${esc(f.values[x])}</td></tr>`).join('')}</table>` : ''}
      <label class="f">Ghi chú</label><textarea id="fNote">${esc(f.note)}</textarea>
      <div class="sec">Hình ảnh hiện trường</div>
      <div class="photos" id="fPhotos"></div>
      <div class="row" style="margin-top:8px"><button class="btn" id="fCam">📷 Chụp ảnh</button><button class="btn" id="fGal">🖼️ Chọn ảnh</button></div>
      <div class="sec">Không gian</div><table class="kv">${coordRows(f)}</table>
      <div class="gap"></div>
      <button class="btn primary block" id="fSave">💾 Lưu thông tin</button>
      <div class="gap"></div>
      <div class="row">
        <button class="btn" id="fZoom">🔍 Xem</button>
        <button class="btn" id="fNav">🧭 Dẫn đường</button>
        <button class="btn" id="fShare">📤 Chia sẻ</button>
      </div><div class="gap"></div>
      <div class="row">
        ${f.geom.type === 'Point' ? '<button class="btn" id="fMove">📍 Dời về GPS</button>' : (f.geom.type !== 'MultiPolygon' && f.kind !== 'track' ? '<button class="btn" id="fRedraw">✏️ Vẽ lại</button>' : '')}
        <button class="btn danger" id="fDel">🗑️ Xóa</button>
      </div>`;
    const collect = () => {
      f.name = $('#fName').value.trim(); f.note = $('#fNote').value; f.kind = $('#fKind').value;
      const fm = S.forms.find(x => x.id === f.formId);
      if (fm) fm.fields.forEach((fd, i) => { const el = $('#fv' + i); if (el) f.values[fd.l] = fd.t === 'checkbox' ? el.checked : fd.t === 'number' ? (el.value === '' ? '' : +el.value) : el.value; });
    };
    $('#fForm').onchange = () => { collect(); f.formId = $('#fForm').value; showTop(); };
    renderPhotos(f, $('#fPhotos'));
    const addPh = cap => pickPhoto(cap).then(async file => { if (!file) return; collect(); toast('Đang xử lý ảnh…'); const pid = await storePhoto(file, f); f.photos.push(pid); await saveFeature(f); renderPhotos(f, $('#fPhotos')); });
    $('#fCam').onclick = () => addPh(true); $('#fGal').onclick = () => addPh(false);
    $('#fSave').onclick = async () => {
      collect();
      const fm = S.forms.find(x => x.id === f.formId);
      const miss = fm ? fm.fields.filter(fd => fd.r && (f.values[fd.l] === '' || f.values[fd.l] == null)).map(fd => fd.l) : [];
      if (miss.length) return toast('Thiếu trường bắt buộc: ' + miss.join(', '));
      await saveFeature(f); toast('Đã lưu'); closeSheet();
    };
    $('#fZoom').onclick = () => { collect(); saveFeature(f); closeSheet(); zoomTo(f); };
    $('#fNav').onclick = () => { collect(); saveFeature(f); closeSheet(); startNav(f.name || k.n, f.geom.type === 'Point' ? geomLatLngs(f.geom) : S.lyr.get(f.id).getBounds().getCenter()); };
    $('#fShare').onclick = async () => { collect(); await saveFeature(f); exportFeatures([f], 'geojson', true); };
    $('#fDel').onclick = async () => { if (confirm('Xóa đối tượng này?')) { await deleteFeature(f.id); closeSheet(); toast('Đã xóa'); } };
    if ($('#fMove')) $('#fMove').onclick = async () => { if (!S.pos) return toast('Chưa có GPS'); collect(); f.geom.coordinates = [S.pos.ll.lng, S.pos.ll.lat]; f.acc = S.pos.acc; await saveFeature(f); showTop(); };
    if ($('#fRedraw')) $('#fRedraw').onclick = () => { collect(); saveFeature(f); closeSheet(); startDraw(f.geom.type === 'LineString' ? 'line' : 'polygon'); S.draw.editId = f.id; S.draw.pts = geomLatLngs(f.geom).slice(); updateDraw(); };
  };
  if (isNew) openSheet((KIND[f.kind] || {}).n + ' mới', fn); else openSheet('Thông tin đối tượng', fn);
}
function zoomTo(f) {
  const l = S.lyr.get(f.id); if (!l) return;
  S.follow = false; $('#btnLocate').classList.remove('active');
  if (l.getBounds) map.fitBounds(l.getBounds(), { maxZoom: 18, padding: [30, 30] }); else map.setView(l.getLatLng(), Math.max(map.getZoom(), 17));
}

/* ======= Ảnh ======= */
function pickPhoto(capture) {
  return new Promise(res => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*';
    if (capture) i.capture = 'environment';
    i.onchange = () => res(i.files[0]); i.click();
  });
}
async function storePhoto(file, f) {
  const bmp = await createImageBitmap(file).catch(() => null);
  let blob = file;
  if (bmp) {
    const sc = Math.min(1, S.set.photoMax / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
    const x = c.getContext('2d'); x.drawImage(bmp, 0, 0, c.width, c.height);
    if (S.set.stampPhoto) {
      const lines = [fmtTime(Date.now())];
      if (S.pos) { const r = CRS.fromWGS(S.set.crs, S.pos.ll.lng, S.pos.ll.lat); lines.push(`${r.la}: ${r.a}  ${r.lb}: ${r.b}  (±${S.pos.acc.toFixed(0)}m)`); lines.push(CRS.BY[S.set.crs].name); }
      if (f.name) lines.push(f.name);
      if (S.heading != null) lines.push('Hướng chụp: ' + Math.round(S.heading) + '° ' + dirName(S.heading));
      lines.push('LN DaTeh GPS' + (S.set.surveyor ? ' - ' + S.set.surveyor : ''));
      const fs = Math.max(14, Math.round(c.width / 42));
      x.font = `600 ${fs}px sans-serif`;
      const hgt = lines.length * fs * 1.3 + fs * 0.6;
      x.fillStyle = 'rgba(0,0,0,.55)'; x.fillRect(0, c.height - hgt, c.width, hgt);
      x.fillStyle = '#fff'; lines.forEach((t, i) => x.fillText(t, fs * 0.6, c.height - hgt + fs * 1.15 + i * fs * 1.3));
    }
    blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.82));
  }
  const pid = 'ph_' + uid();
  await DB.put('photos', pid, { blob, t: Date.now(), ll: S.pos ? [S.pos.ll.lng, S.pos.ll.lat] : null, h: S.heading });
  return pid;
}
async function renderPhotos(f, el) {
  el.innerHTML = '';
  for (const pid of f.photos || []) {
    const p = await DB.get('photos', pid); if (!p) continue;
    const u = URL.createObjectURL(p.blob);
    const d = document.createElement('div'); d.className = 'ph';
    d.innerHTML = `<img src="${u}"><button>✕</button>`;
    d.querySelector('img').onclick = () => window.open(u, '_blank');
    d.querySelector('button').onclick = async () => { if (!confirm('Xóa ảnh?')) return; f.photos = f.photos.filter(x => x !== pid); await DB.del('photos', pid); await saveFeature(f); renderPhotos(f, el); };
    el.appendChild(d);
  }
  if (!f.photos || !f.photos.length) el.innerHTML = '<span class="muted">Chưa có ảnh</span>';
}

/* ================= Tạo điểm ================= */
function pointMenu() {
  openSheet('Tạo điểm', body => {
    body.innerHTML = `
      <label class="f">Loại điểm</label>
      <select id="pK"><option value="point">📍 Điểm thường</option><option value="marker">🔺 Điểm mốc tọa độ</option><option value="check">🚩 Điểm kiểm tra</option></select>
      <div class="gap"></div>
      <button class="btn primary block" id="pGps">📡 Tại vị trí GPS hiện tại</button><div class="gap"></div>
      <button class="btn block" id="pAvg">⏱️ GPS lấy trung bình ${S.set.avgCount} lần đo (chính xác hơn)</button><div class="gap"></div>
      <button class="btn block" id="pCenter">✚ Tại tâm màn hình bản đồ</button><div class="gap"></div>
      <button class="btn block" id="pTap">👆 Chạm chọn trên bản đồ</button><div class="gap"></div>
      <button class="btn block" id="pCoord">⌨️ Nhập tọa độ (VN2000/WGS84)</button>
      <div class="note">Mẹo: nhấn giữ trên bản đồ để xem tọa độ và tạo điểm tại vị trí bất kỳ.</div>`;
    const mk = async (ll, extra) => {
      const f = newFeature($('#pK').value, { type: 'Point', coordinates: [+ll.lng.toFixed(7), +ll.lat.toFixed(7)] }, extra);
      await saveFeature(f); openFeature(f.id, true);
    };
    $('#pGps').onclick = () => { if (!S.pos) return toast('Đang chờ tín hiệu GPS…'); mk(S.pos.ll, { acc: S.pos.acc, alt: S.pos.alt }); };
    $('#pAvg').onclick = async () => {
      if (!S.pos) return toast('Đang chờ tín hiệu GPS…');
      const kind = $('#pK').value; S.avg = [];
      body.innerHTML = '<p style="text-align:center;font-size:18px" id="avgT">Đang lấy trung bình… 0/' + S.set.avgCount + '</p><p class="muted" style="text-align:center">Giữ máy đứng yên tại vị trí</p>';
      while (S.avg && S.avg.length < S.set.avgCount) { await sleep(500); const t = $('#avgT'); if (t) t.textContent = `Đang lấy trung bình… ${S.avg ? S.avg.length : 0}/${S.set.avgCount}`; else { S.avg = null; return; } }
      const a = S.avg; S.avg = null;
      const w = a.map(p => 1 / Math.max(1, p.acc * p.acc)); const sw = w.reduce((x, y) => x + y, 0);
      const lat = a.reduce((s, p, i) => s + p.ll.lat * w[i], 0) / sw, lng = a.reduce((s, p, i) => s + p.ll.lng * w[i], 0) / sw;
      const acc = Math.min(...a.map(p => p.acc)) / Math.sqrt(a.length) * 1.5;
      const f = newFeature(kind, { type: 'Point', coordinates: [+lng.toFixed(7), +lat.toFixed(7)] }, { acc, avgN: a.length });
      await saveFeature(f); openFeature(f.id, true);
    };
    $('#pCenter').onclick = () => mk(map.getCenter());
    $('#pTap').onclick = () => { const k = $('#pK').value; closeSheet(); toast('Chạm vào bản đồ để đặt điểm'); S.pickPoint = ll => { const f = newFeature(k, { type: 'Point', coordinates: [+ll.lng.toFixed(7), +ll.lat.toFixed(7)] }); saveFeature(f).then(() => openFeature(f.id, true)); }; };
    $('#pCoord').onclick = () => coordEntry($('#pK').value);
  });
}
function crsSelect(id, sel) { return `<select id="${id}">${CRS.LIST.map(c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>`; }
function coordEntry(kind) {
  sub('Nhập tọa độ', body => {
    body.innerHTML = `<label class="f">Hệ tọa độ</label>${crsSelect('ceC', S.set.crs)}
      <div class="row"><div><label class="f" id="ceLa">X (Bắc)</label><input id="ceA" inputmode="decimal"></div><div><label class="f" id="ceLb">Y (Đông)</label><input id="ceB" inputmode="decimal"></div></div>
      <label class="f">Tên điểm</label><input id="ceN">
      <div class="gap"></div><button class="btn primary block" id="ceOk">Tạo điểm</button>`;
    const lab = () => { const g = CRS.BY[$('#ceC').value].geo; $('#ceLa').textContent = g ? 'Vĩ độ' : 'X (Bắc)'; $('#ceLb').textContent = g ? 'Kinh độ' : 'Y (Đông)'; };
    $('#ceC').onchange = lab; lab();
    $('#ceOk').onclick = async () => {
      const r = CRS.toWGS($('#ceC').value, $('#ceA').value, $('#ceB').value);
      if (!isFinite(r.lat) || !isFinite(r.lng) || Math.abs(r.lat) > 90) return toast('Tọa độ không hợp lệ');
      const f = newFeature(kind || 'check', { type: 'Point', coordinates: [+r.lng.toFixed(7), +r.lat.toFixed(7)] }, { name: $('#ceN').value.trim(), values: { 'Tọa độ nhập': $('#ceA').value + ', ' + $('#ceB').value + ' (' + CRS.BY[$('#ceC').value].name + ')' } });
      await saveFeature(f); closeSheet(); zoomTo(f); toast('Đã tạo điểm');
    };
  });
}

/* ================= Điều hướng ================= */
function startNav(name, ll) {
  S.nav = { name, ll }; $('#navPanel').classList.remove('hidden'); $('#navName').textContent = '➜ ' + name;
  startCompass(); updateNav();
  if (S.pos) map.fitBounds(L.latLngBounds([S.pos.ll, ll]), { padding: [60, 60], maxZoom: 18 });
}
function updateNav() {
  const n = S.nav; navLayer.clearLayers(); if (!n) return;
  L.circleMarker(n.ll, { radius: 10, color: '#d50000', weight: 3, fill: false, interactive: false }).addTo(navLayer);
  if (!S.pos) { $('#navDist').textContent = 'Chờ GPS…'; return; }
  L.polyline([S.pos.ll, n.ll], { color: '#d50000', dashArray: '6 6', weight: 2, interactive: false }).addTo(navLayer);
  const d = S.pos.ll.distanceTo(n.ll), b = bearing(S.pos.ll, n.ll);
  $('#navDist').textContent = fmtLen(d);
  const h = S.heading != null ? S.heading : null;
  $('#navBrg').textContent = `Phương vị ${b.toFixed(0)}° (${dirName(b)})` + (h != null ? ` · Lệch ${(((b - h + 540) % 360) - 180).toFixed(0)}°` : ' · Mũi tên theo hướng Bắc');
  $('#navArrow').style.transform = `rotate(${h != null ? b - h : b}deg)`;
  if (d < 5 && !n.arrived) { n.arrived = true; toast('Đã đến điểm đích (≤5 m)'); if (navigator.vibrate) navigator.vibrate([200, 100, 200]); }
}
$('#navStop').onclick = () => { S.nav = null; navLayer.clearLayers(); $('#navPanel').classList.add('hidden'); };

/* ================= Sự kiện bản đồ ================= */
map.on('click', e => {
  if (S.pickPoint) { const f = S.pickPoint; S.pickPoint = null; return f(e.latlng); }
  if (S.draw) return addVertex(e.latlng);
  // Truy vấn thuộc tính MBTiles vector
  let hits = [];
  S.mbt.forEach(o => { if (o.visible && o.layer.isVector) hits = hits.concat(o.layer.query(e.latlng, map).map(h => Object.assign({ src: o.name }, h))); });
  if (hits.length) {
    L.popup({ maxWidth: 280 }).setLatLng(e.latlng).setContent(hits.map(h => `<b>${esc(h.src)} › ${esc(h.layer)}</b><table class="kv">${Object.keys(h.props).map(k => `<tr><td>${esc(k)}</td><td>${esc(h.props[k])}</td></tr>`).join('')}</table>`).join('<hr>')).openOn(map);
  }
});
map.on('contextmenu', e => {
  if (S.draw) return;
  const r = CRS.fromWGS(S.set.crs, e.latlng.lng, e.latlng.lat);
  const d = S.pos ? `<br>Cách bạn: ${fmtLen(S.pos.ll.distanceTo(e.latlng))}, phương vị ${bearing(S.pos.ll, e.latlng).toFixed(0)}°` : '';
  const div = document.createElement('div');
  div.innerHTML = `<b>${r.la}:</b> ${r.a}<br><b>${r.lb}:</b> ${r.b}<br><span class="muted">${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}</span>${d}<div class="row" style="margin-top:6px"><button class="btn" data-a="p">📍 Tạo điểm</button><button class="btn" data-a="n">🧭 Đến đây</button></div>`;
  const pop = L.popup().setLatLng(e.latlng).setContent(div).openOn(map);
  div.querySelector('[data-a=p]').onclick = async () => { map.closePopup(pop); const f = newFeature('point', { type: 'Point', coordinates: [+e.latlng.lng.toFixed(7), +e.latlng.lat.toFixed(7)] }); await saveFeature(f); openFeature(f.id, true); };
  div.querySelector('[data-a=n]').onclick = () => { map.closePopup(pop); startNav('Vị trí chọn', e.latlng); };
});
map.on('dragstart', () => { S.follow = false; $('#btnLocate').classList.remove('active'); });
map.on('zoomend', () => drawCone(S.heading));

$('#btnLocate').onclick = () => {
  S.follow = true; $('#btnLocate').classList.add('active');
  if (S.pos) map.setView(S.pos.ll, Math.max(map.getZoom(), 17)); else toast('Đang chờ tín hiệu GPS…');
};
$('#btnCompass').onclick = () => compassSheet();
$('#btnLayers').onclick = () => layersSheet();
$('#stCrs').onclick = () => settingsSheet();
$('#dpGps').onclick = () => { if (!S.pos) return toast('Chưa có GPS'); addVertex(S.pos.ll); };
$('#dpCenter').onclick = () => addVertex(map.getCenter());
$('#dpUndo').onclick = () => { if (S.draw) { S.draw.pts.pop(); updateDraw(); } };
$('#dpCancel').onclick = () => { if (!S.draw.pts.length || confirm('Hủy bản vẽ?')) cancelDraw(); };
$('#dpDone').onclick = finishDraw;
$('#dpAuto').onclick = () => {
  if (!S.draw) return; S.draw.auto = !S.draw.auto; $('#dpAuto').classList.toggle('on', S.draw.auto);
  toast(S.draw.auto ? `Tự động thêm đỉnh mỗi ${S.set.autoVertexDist} m khi di chuyển` : 'Tắt tự động');
  if (S.draw.auto) { keepAwake(true); autoVertex(); }
};
document.querySelectorAll('#toolbar button').forEach(b => b.onclick = () => {
  const a = b.dataset.act;
  if (a === 'point') pointMenu();
  else if (a === 'line' || a === 'polygon' || a === 'measure') { if (S.draw && S.draw.kind === a) return; startDraw(a); }
  else if (a === 'track') { if (S.track) { if (confirm('Dừng ghi tracklog?')) stopTrack(); } else startTrack(); }
  else if (a === 'menu') mainMenu();
});

/* ================= Menu chính ================= */
function mainMenu() {
  openSheet('LN DaTeh GPS', body => {
    const items = [
      ['📋', 'Dữ liệu đã thu thập', dataSheet], ['🔺', 'Điểm mốc & điểm kiểm tra', markerSheet], ['📝', 'Mẫu biểu thu thập', formsSheet],
      ['🔄', 'Chuyển đổi tọa độ', convertSheet], ['📥', 'Mở file GPX/KML/GeoJSON/MBTiles', () => importFile()], ['📤', 'Xuất & chia sẻ dữ liệu', exportSheet],
      ['🗺️', 'Bản đồ nền & tải offline', layersSheet], ['🛰️', 'Ảnh vệ tinh Landsat 8/Sentinel 2', satSheet], ['🧭', 'La bàn số', compassSheet],
      ['⚙️', 'Cài đặt', settingsSheet], ['💾', 'Sao lưu / phục hồi', backupSheet], ['ℹ️', 'Hướng dẫn', helpSheet]
    ];
    body.innerHTML = `<div class="menu-grid">${items.map((it, i) => `<button data-i="${i}"><i>${it[0]}</i>${it[1]}</button>`).join('')}</div>
      <p class="muted" style="text-align:center;margin-top:18px">Công ty TNHH MTV Lâm nghiệp Đạ Tẻh<br>Phiên bản 1.0 · ${S.feats.size} đối tượng</p>`;
    body.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { const f = items[+b.dataset.i][2]; stack.length = 1; f(true); });
  });
}
const sheetFn = (title, fn) => fromMenu => fromMenu === true ? sub(title, fn) : openSheet(title, fn);

/* ======= Danh sách dữ liệu ======= */
const dataSheet = sheetFn('Dữ liệu đã thu thập', body => {
  body.innerHTML = `<div class="row"><input id="dQ" placeholder="🔎 Tìm theo tên, thuộc tính…"><select id="dK" style="flex:.6"><option value="">Tất cả</option>${Object.keys(KIND).map(k => `<option value="${k}">${KIND[k].n}</option>`).join('')}</select></div>
    <div class="row" style="margin-top:8px">${Object.keys(KIND).map(k => `<label style="font-size:12px;flex:none"><input type="checkbox" data-g="${k}" ${map.hasLayer(groups[k]) ? 'checked' : ''}>${KIND[k].ic}</label>`).join('')}</div>
    <ul class="list" id="dL"></ul>`;
  body.querySelectorAll('[data-g]').forEach(c => c.onchange = () => c.checked ? map.addLayer(groups[c.dataset.g]) : map.removeLayer(groups[c.dataset.g]));
  const draw = () => {
    const q = $('#dQ').value.toLowerCase(), kk = $('#dK').value;
    const arr = [...S.feats.values()].filter(f => (!kk || f.kind === kk) && (!q || JSON.stringify([f.name, f.note, f.values]).toLowerCase().includes(q))).sort((a, b) => b.created - a.created);
    $('#dL').innerHTML = arr.slice(0, 500).map(f => {
      const m = measureOf(f), k = KIND[f.kind] || KIND.import;
      const info = m.area != null ? (m.area / 10000).toFixed(4) + ' ha' : m.len != null ? fmtLen(m.len) : '';
      return `<li data-id="${f.id}"><span style="font-size:22px">${k.ic}</span><div class="grow"><div class="t">${esc(f.name || '(chưa đặt tên)')}</div><div class="s">${k.n} · ${fmtTime(f.created)} ${info ? '· ' + info : ''} ${f.photos && f.photos.length ? '· 📷' + f.photos.length : ''}</div></div><span>›</span></li>`;
    }).join('') || '<li class="muted">Chưa có dữ liệu</li>';
    $('#dL').querySelectorAll('li[data-id]').forEach(li => li.onclick = () => { const f = S.feats.get(li.dataset.id); closeSheet(); zoomTo(f); setTimeout(() => openFeature(f.id), 350); });
  };
  $('#dQ').oninput = draw; $('#dK').onchange = draw; draw();
});

/* ======= Điểm mốc & kiểm tra ======= */
const markerSheet = sheetFn('Điểm mốc & điểm kiểm tra', body => {
  body.innerHTML = `<input id="mQ" placeholder="🔎 Tìm điểm mốc theo tên/số hiệu">
    <div class="row" style="margin-top:8px"><button class="btn" id="mXls">📊 Nhập từ Excel/CSV</button><button class="btn" id="mList">⌨️ Nhập danh sách</button></div>
    <div class="row" style="margin-top:8px"><button class="btn" id="mTpl">⬇️ File Excel mẫu</button><button class="btn" id="mOne">➕ Nhập 1 điểm</button></div>
    <div class="note">Dùng "Nhập danh sách" để kiểm tra vị trí trích lục, tọa độ góc thửa trên sổ đỏ (GCN QSDĐ): nhập tọa độ VN2000 → tạo điểm kiểm tra → dẫn đường tới từng điểm.</div>
    <ul class="list" id="mL"></ul>`;
  const draw = () => {
    const q = $('#mQ').value.toLowerCase();
    const arr = [...S.feats.values()].filter(f => (f.kind === 'marker' || f.kind === 'check') && (!q || (f.name + ' ' + JSON.stringify(f.values)).toLowerCase().includes(q)))
      .sort((a, b) => S.pos ? S.pos.ll.distanceTo(geomLatLngs(a.geom)) - S.pos.ll.distanceTo(geomLatLngs(b.geom)) : String(a.name).localeCompare(b.name, 'vi', { numeric: true }));
    $('#mL').innerHTML = arr.slice(0, 500).map(f => {
      const r = CRS.fromWGS(S.set.crs, f.geom.coordinates[0], f.geom.coordinates[1]);
      const d = S.pos ? ' · cách ' + fmtLen(S.pos.ll.distanceTo(geomLatLngs(f.geom))) : '';
      return `<li><span style="font-size:20px">${KIND[f.kind].ic}</span><div class="grow" data-z="${f.id}"><div class="t">${esc(f.name || '(không tên)')}</div><div class="s">X ${r.a} · Y ${r.b}${d}</div></div><button class="btn" data-n="${f.id}">🧭</button></li>`;
    }).join('') || '<li class="muted">Chưa có điểm mốc</li>';
    $('#mL').querySelectorAll('[data-z]').forEach(e => e.onclick = () => { const f = S.feats.get(e.dataset.z); closeSheet(); zoomTo(f); });
    $('#mL').querySelectorAll('[data-n]').forEach(e => e.onclick = () => { const f = S.feats.get(e.dataset.n); closeSheet(); startNav(f.name || 'Điểm mốc', geomLatLngs(f.geom)); });
  };
  $('#mQ').oninput = draw; draw();
  $('#mXls').onclick = () => excelImport(); $('#mList').onclick = listImport; $('#mOne').onclick = () => coordEntry('check');
  $('#mTpl').onclick = async () => {
    await loadScript('vendor/xlsx.full.min.js');
    const ws = XLSX.utils.aoa_to_sheet([['Ten', 'X', 'Y', 'GhiChu'], ['Moc 01', 1286543.21, 552310.45, 'Mốc ranh giới TK 412'], ['Goc thua 1', 1286600.00, 552400.00, 'Sổ đỏ số ...']]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'DiemMoc');
    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    shareBlob(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'Mau_DiemMoc_VN2000.xlsx');
  };
});
function listImport() {
  sub('Nhập danh sách điểm', body => {
    body.innerHTML = `<label class="f">Hệ tọa độ của danh sách</label>${crsSelect('lC', S.set.crs)}
      <label class="f">Loại điểm</label><select id="lK"><option value="check">🚩 Điểm kiểm tra</option><option value="marker">🔺 Điểm mốc</option></select>
      <label class="f">Danh sách (mỗi dòng: Tên; X; Y — hoặc Tên; Vĩ độ; Kinh độ)</label>
      <textarea id="lT" style="min-height:160px" placeholder="1; 1286543.21; 552310.45&#10;2; 1286600.00; 552400.00&#10;3; 1286650.5; 552380.2"></textarea>
      <label class="f"><input type="checkbox" id="lP" checked>Nối các điểm thành vùng (thửa đất/lô)</label>
      <div class="gap"></div><button class="btn primary block" id="lOk">Nhập</button>`;
    $('#lOk').onclick = async () => {
      const c = $('#lC').value, kind = $('#lK').value; const pts = []; let bad = 0;
      $('#lT').value.split(/\r?\n/).map(s => s.trim()).filter(Boolean).forEach((line, i) => {
        const p = line.split(/[;\t]|,(?=\s*-?\d)|\s{2,}/).map(s => s.trim()).filter(s => s !== '');
        let name, a, b;
        if (p.length >= 3) [name, a, b] = p; else if (p.length === 2) { name = String(i + 1); [a, b] = p; } else { bad++; return; }
        const r = CRS.toWGS(c, a, b);
        if (!isFinite(r.lat) || !isFinite(r.lng) || Math.abs(r.lat) > 90) { bad++; return; }
        pts.push({ name, r, a, b });
      });
      if (!pts.length) return toast('Không đọc được điểm nào');
      const g = 'DS ' + new Date().toLocaleDateString('vi-VN');
      for (const p of pts) await saveFeature(newFeature(kind, { type: 'Point', coordinates: [+p.r.lng.toFixed(7), +p.r.lat.toFixed(7)] }, { name: p.name, values: { 'Tọa độ nhập': p.a + ', ' + p.b, 'Nhóm': g } }));
      if ($('#lP').checked && pts.length >= 3) {
        const cs = pts.map(p => [+p.r.lng.toFixed(7), +p.r.lat.toFixed(7)]);
        const f = newFeature('polygon', { type: 'Polygon', coordinates: [cs.concat([cs[0]])] }, { name: 'Thửa/vùng kiểm tra ' + g });
        await saveFeature(f);
      }
      toast(`Đã nhập ${pts.length} điểm${bad ? ', lỗi ' + bad + ' dòng' : ''}`);
      closeSheet(); map.fitBounds(L.latLngBounds(pts.map(p => [p.r.lat, p.r.lng])), { maxZoom: 18, padding: [40, 40] });
    };
  });
}
async function excelImport(file) {
  if (!(file instanceof Blob)) file = await pickFile('.xlsx,.xls,.csv,.txt,.ods'); if (!file) return;
  await loadScript('vendor/xlsx.full.min.js');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true }).filter(r => r.length);
  if (rows.length < 2) return toast('File không có dữ liệu');
  const hdr = rows[0].map((h, i) => String(h || 'Cột ' + (i + 1)));
  const guess = re => Math.max(0, hdr.findIndex(h => re.test(h)));
  sub('Nhập điểm từ Excel', body => {
    const opt = sel => hdr.map((h, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${esc(h)}</option>`).join('');
    body.innerHTML = `<p class="muted">${esc(file.name)} · ${rows.length - 1} dòng</p>
      <label class="f">Hệ tọa độ</label>${crsSelect('xC', S.set.crs)}
      <label class="f">Cột Tên/Số hiệu</label><select id="xN">${opt(guess(/t[eê]n|name|s[ốo]|id|stt/i))}</select>
      <div class="row"><div><label class="f">Cột X (Bắc) / Vĩ độ</label><select id="xA">${opt(guess(/^x|b[ắa]c|lat|v[ĩi]/i))}</select></div>
      <div><label class="f">Cột Y (Đông) / Kinh độ</label><select id="xB">${opt(guess(/^y|đ[ôo]ng|lon|lng|kinh/i))}</select></div></div>
      <label class="f">Loại điểm</label><select id="xK"><option value="marker">🔺 Điểm mốc</option><option value="check">🚩 Điểm kiểm tra</option><option value="point">📍 Điểm thường</option></select>
      <div class="gap"></div><button class="btn primary block" id="xOk">Nhập ${rows.length - 1} điểm</button>`;
    $('#xOk').onclick = async () => {
      const c = $('#xC').value, n = +$('#xN').value, a = +$('#xA').value, b = +$('#xB').value, k = $('#xK').value;
      let ok = 0, bad = 0; const lls = [];
      for (const r of rows.slice(1)) {
        const w = CRS.toWGS(c, r[a], r[b]);
        if (!isFinite(w.lat) || !isFinite(w.lng) || Math.abs(w.lat) > 90) { bad++; continue; }
        const vals = {}; hdr.forEach((h, i) => { if (r[i] != null && r[i] !== '') vals[h] = r[i]; });
        await saveFeature(newFeature(k, { type: 'Point', coordinates: [+w.lng.toFixed(7), +w.lat.toFixed(7)] }, { name: String(r[n] == null ? '' : r[n]), values: vals, layer: file.name }));
        lls.push([w.lat, w.lng]); ok++;
      }
      toast(`Đã nhập ${ok} điểm${bad ? ', bỏ qua ' + bad + ' dòng lỗi' : ''}`);
      closeSheet(); if (lls.length) map.fitBounds(L.latLngBounds(lls), { maxZoom: 17, padding: [30, 30] });
    };
  });
}

/* ======= Mẫu biểu ======= */
const formsSheet = sheetFn('Mẫu biểu thu thập', body => {
  body.innerHTML = `<ul class="list" id="fmL"></ul><div class="gap"></div>
    <button class="btn primary block" id="fmNew">➕ Tạo mẫu biểu mới</button><div class="gap"></div>
    <div class="row"><button class="btn" id="fmScan">📷 Quét QR nhận mẫu</button><button class="btn" id="fmImp">📂 Nhập từ file</button></div>`;
  $('#fmL').innerHTML = S.forms.map((f, i) => `<li><div class="grow" data-e="${i}"><div class="t">${esc(f.name)}</div><div class="s">${f.fields.length} trường</div></div><button class="btn" data-q="${i}">QR</button><button class="btn" data-x="${i}">📤</button></li>`).join('');
  $('#fmL').querySelectorAll('[data-e]').forEach(e => e.onclick = () => formEditor(S.forms[+e.dataset.e]));
  $('#fmL').querySelectorAll('[data-q]').forEach(e => e.onclick = () => formQR(S.forms[+e.dataset.q]));
  $('#fmL').querySelectorAll('[data-x]').forEach(e => e.onclick = () => { const f = S.forms[+e.dataset.x]; shareBlob(new Blob([JSON.stringify({ lndateh_form: 1, form: f }, null, 1)], { type: 'application/json' }), 'MauBieu_' + slug(f.name) + '.json'); });
  $('#fmNew').onclick = () => formEditor(null);
  $('#fmScan').onclick = () => qrScan(txt => receiveForm(txt));
  $('#fmImp').onclick = async () => { const f = await pickFile('.json,.txt'); if (f) receiveForm(await f.text()); };
});
const slug = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[^A-Za-z0-9]+/g, '_');
function formEditor(form) {
  const f = form ? JSON.parse(JSON.stringify(form)) : { id: 'f_' + uid(), name: '', fields: [{ l: 'Tên trường 1', t: 'text' }] };
  sub(form ? 'Sửa mẫu biểu' : 'Mẫu biểu mới', body => {
    const types = { text: 'Chữ', number: 'Số', select: 'Danh sách chọn', date: 'Ngày', datetime: 'Ngày giờ', checkbox: 'Có/Không', textarea: 'Đoạn văn' };
    const draw = () => {
      body.innerHTML = `<label class="f">Tên mẫu biểu</label><input id="feN" value="${esc(f.name)}">
        <div class="sec">Các trường dữ liệu</div>
        ${f.fields.map((fd, i) => `<div class="glass" style="padding:8px;margin-bottom:8px;box-shadow:none;border:1px solid var(--line)">
          <div class="row"><input data-l="${i}" value="${esc(fd.l)}" placeholder="Tên trường"><select data-t="${i}" style="flex:.7">${Object.keys(types).map(t => `<option value="${t}" ${t === fd.t ? 'selected' : ''}>${types[t]}</option>`).join('')}</select></div>
          ${fd.t === 'select' ? `<input data-o="${i}" style="margin-top:6px" value="${esc(fd.o || '')}" placeholder="Lựa chọn, cách nhau bởi |  (VD: Tốt|Trung bình|Kém)">` : ''}
          <div class="row" style="margin-top:6px"><label style="font-size:13px"><input type="checkbox" data-r="${i}" ${fd.r ? 'checked' : ''}>Bắt buộc</label>
          <button class="btn" data-u="${i}" style="flex:none">↑</button><button class="btn" data-d="${i}" style="flex:none">↓</button><button class="btn danger" data-x="${i}" style="flex:none">✕</button></div></div>`).join('')}
        <button class="btn block" id="feAdd">➕ Thêm trường</button><div class="gap"></div>
        <div class="row">${form ? '<button class="btn danger" id="feDel">Xóa mẫu</button>' : ''}<button class="btn primary" id="feSave">💾 Lưu mẫu</button></div>`;
      const sync = () => {
        f.name = $('#feN').value;
        body.querySelectorAll('[data-l]').forEach(e => f.fields[+e.dataset.l].l = e.value.trim());
        body.querySelectorAll('[data-o]').forEach(e => f.fields[+e.dataset.o].o = e.value);
        body.querySelectorAll('[data-r]').forEach(e => f.fields[+e.dataset.r].r = e.checked ? 1 : 0);
      };
      body.querySelectorAll('[data-t]').forEach(e => e.onchange = () => { sync(); f.fields[+e.dataset.t].t = e.value; draw(); });
      body.querySelectorAll('[data-x]').forEach(e => e.onclick = () => { sync(); f.fields.splice(+e.dataset.x, 1); draw(); });
      body.querySelectorAll('[data-u]').forEach(e => e.onclick = () => { sync(); const i = +e.dataset.u; if (i > 0) [f.fields[i - 1], f.fields[i]] = [f.fields[i], f.fields[i - 1]]; draw(); });
      body.querySelectorAll('[data-d]').forEach(e => e.onclick = () => { sync(); const i = +e.dataset.d; if (i < f.fields.length - 1) [f.fields[i + 1], f.fields[i]] = [f.fields[i], f.fields[i + 1]]; draw(); });
      $('#feAdd').onclick = () => { sync(); f.fields.push({ l: 'Trường ' + (f.fields.length + 1), t: 'text' }); draw(); };
      $('#feSave').onclick = async () => {
        sync(); if (!f.name.trim()) return toast('Nhập tên mẫu biểu');
        const i = S.forms.findIndex(x => x.id === f.id); if (i >= 0) S.forms[i] = f; else S.forms.push(f);
        await saveForms(); toast('Đã lưu mẫu biểu'); stack.pop(); showTop();
      };
      if ($('#feDel')) $('#feDel').onclick = async () => { if (!confirm('Xóa mẫu biểu?')) return; S.forms = S.forms.filter(x => x.id !== f.id); await saveForms(); stack.pop(); showTop(); };
    };
    draw();
  });
}
function formToQR(f) { return 'LNDT1:' + JSON.stringify({ n: f.name, i: f.id, f: f.fields.map(x => [x.l, x.t, x.o || '', x.r ? 1 : 0]) }); }
function formQR(f) {
  sub('Chia sẻ mẫu qua QR', body => {
    const txt = formToQR(f);
    try {
      const q = qrcode(0, 'L'); q.addData(txt, 'Byte'); q.make();
      body.innerHTML = `<p style="text-align:center"><b>${esc(f.name)}</b></p><div class="qr">${q.createImgTag(6, 8)}</div>
        <p class="muted" style="text-align:center">Đồng nghiệp mở LN DaTeh GPS → Menu → Mẫu biểu → Quét QR</p>
        <button class="btn block" id="qrSave">⬇️ Lưu ảnh QR / chia sẻ</button>`;
      $('#qrSave').onclick = async () => { const b = await (await fetch(body.querySelector('.qr img').src)).blob(); shareBlob(b, 'QR_' + slug(f.name) + '.gif'); };
    } catch (e) { body.innerHTML = '<div class="note warn">Mẫu biểu quá lớn cho mã QR. Hãy dùng chức năng xuất file 📤.</div>'; }
  });
}
qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
async function receiveForm(txt) {
  try {
    let f;
    if (txt.startsWith('LNDT1:')) { const o = JSON.parse(txt.slice(6)); f = { id: o.i || 'f_' + uid(), name: o.n, fields: o.f.map(a => ({ l: a[0], t: a[1], o: a[2], r: a[3] })) }; }
    else { const o = JSON.parse(txt); f = o.form || o; if (!f.fields) throw 0; }
    const i = S.forms.findIndex(x => x.id === f.id);
    if (i >= 0) { if (!confirm(`Mẫu "${f.name}" đã có. Ghi đè?`)) return; S.forms[i] = f; } else S.forms.push(f);
    await saveForms(); toast('Đã nhận mẫu biểu: ' + f.name); stack.length = 0; formsSheet();
  } catch (e) { toast('Dữ liệu không phải mẫu biểu hợp lệ'); }
}
function qrScan(onText) {
  sub('Quét mã QR', body => {
    body.innerHTML = `<video class="scan" playsinline muted></video><p class="muted" style="text-align:center">Đưa mã QR vào khung hình</p><button class="btn block" id="qsImg">🖼️ Quét từ ảnh có sẵn</button>`;
    const v = body.querySelector('video'); let stream, alive = true;
    const cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
    const tick = () => {
      if (!alive) return;
      if (v.readyState >= 2) {
        cv.width = v.videoWidth; cv.height = v.videoHeight; cx.drawImage(v, 0, 0);
        const r = jsQR(cx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height);
        if (r && r.data) { alive = false; stop(); stack.pop(); onText(r.data); return; }
      }
      requestAnimationFrame(tick);
    };
    const stop = () => { alive = false; if (stream) stream.getTracks().forEach(t => t.stop()); };
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(s => { stream = s; v.srcObject = s; v.play(); tick(); }).catch(() => toast('Không mở được camera'));
    $('#qsImg').onclick = async () => {
      const f = await pickFile('image/*'); if (!f) return;
      const bmp = await createImageBitmap(f); cv.width = bmp.width; cv.height = bmp.height; cx.drawImage(bmp, 0, 0);
      const r = jsQR(cx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height);
      if (r) { stop(); stack.pop(); onText(r.data); } else toast('Không tìm thấy mã QR trong ảnh');
    };
    return stop;
  });
}

/* ======= Chuyển đổi tọa độ ======= */
const convertSheet = sheetFn('Chuyển đổi tọa độ', body => {
  body.innerHTML = `<label class="f">Từ hệ</label>${crsSelect('cvF', S.set.crs)}
    <div class="row"><div><label class="f" id="cvLa">X</label><input id="cvA" inputmode="decimal"></div><div><label class="f" id="cvLb">Y</label><input id="cvB" inputmode="decimal"></div></div>
    <div class="row" style="margin-top:8px"><button class="btn" id="cvGps">📡 Lấy GPS</button><button class="btn" id="cvMap">✚ Tâm bản đồ</button></div>
    <label class="f">Sang hệ</label>${crsSelect('cvT', 'WGS84')}
    <div class="gap"></div><button class="btn primary block" id="cvGo">Chuyển đổi</button>
    <div id="cvR" style="margin-top:10px"></div>
    <div class="sec">Chuyển đổi hàng loạt</div>
    <textarea id="cvBatch" placeholder="Mỗi dòng: Tên; A; B (theo hệ 'Từ hệ')"></textarea>
    <div class="gap"></div><button class="btn block" id="cvBGo">Chuyển hàng loạt & sao chép</button><pre id="cvBR" style="white-space:pre-wrap;font-size:12px"></pre>`;
  const lab = () => { const g = CRS.BY[$('#cvF').value].geo; $('#cvLa').textContent = g ? 'Vĩ độ' : 'X (Bắc)'; $('#cvLb').textContent = g ? 'Kinh độ' : 'Y (Đông)'; };
  $('#cvF').onchange = lab; lab();
  const fill = ll => { const r = CRS.fromWGS($('#cvF').value, ll.lng, ll.lat); $('#cvA').value = r.a; $('#cvB').value = r.b; };
  $('#cvGps').onclick = () => S.pos ? fill(S.pos.ll) : toast('Chưa có GPS');
  $('#cvMap').onclick = () => fill(map.getCenter());
  let last;
  $('#cvGo').onclick = () => {
    const w = CRS.toWGS($('#cvF').value, $('#cvA').value, $('#cvB').value);
    if (!isFinite(w.lat) || !isFinite(w.lng)) return toast('Tọa độ không hợp lệ');
    last = w;
    const r = CRS.fromWGS($('#cvT').value, w.lng, w.lat);
    const vn = CRS.fromWGS(S.set.crs, w.lng, w.lat);
    $('#cvR').innerHTML = `<table class="kv"><tr><td>${r.la}</td><td><b>${r.a}</b></td></tr><tr><td>${r.lb}</td><td><b>${r.b}</b></td></tr>
      <tr><td>WGS84</td><td>${w.lat.toFixed(7)}, ${w.lng.toFixed(7)}</td></tr><tr><td>${esc(CRS.BY[S.set.crs].name)}</td><td>${vn.a}, ${vn.b}</td></tr></table>
      <div class="row" style="margin-top:8px"><button class="btn" id="cvShow">🔍 Xem trên bản đồ</button><button class="btn" id="cvPt">📍 Tạo điểm</button></div>`;
    $('#cvShow').onclick = () => { closeSheet(); S.follow = false; map.setView([w.lat, w.lng], 17); startNav('Điểm chuyển đổi', L.latLng(w.lat, w.lng)); };
    $('#cvPt').onclick = async () => { const f = newFeature('check', { type: 'Point', coordinates: [+w.lng.toFixed(7), +w.lat.toFixed(7)] }); await saveFeature(f); openFeature(f.id, true); };
  };
  $('#cvBGo').onclick = () => {
    const out = $('#cvBatch').value.split(/\r?\n/).filter(s => s.trim()).map(line => {
      const p = line.split(/[;\t]|,(?=\s*-?\d)/).map(s => s.trim());
      const [n, a, b] = p.length >= 3 ? p : ['', p[0], p[1]];
      const w = CRS.toWGS($('#cvF').value, a, b); if (!isFinite(w.lat)) return n + '; LỖI';
      const r = CRS.fromWGS($('#cvT').value, w.lng, w.lat); return `${n}; ${r.a}; ${r.b}`;
    }).join('\n');
    $('#cvBR').textContent = out;
    navigator.clipboard && navigator.clipboard.writeText(out).then(() => toast('Đã sao chép kết quả'));
  };
});

/* ======= Nhập file ======= */
function pickFile(accept) {
  return new Promise(res => { const i = $('#fileInput'); i.value = ''; i.accept = accept || ''; i.onchange = () => res(i.files[0]); i.click(); });
}
async function importFile(file) {
  file = file || await pickFile('.gpx,.kml,.geojson,.json,.mbtiles,.xlsx,.xls,.csv');
  if (!file) return;
  const n = file.name.toLowerCase();
  try {
    if (n.endsWith('.mbtiles')) { toast('Đang mở MBTiles…'); await addMBTiles(await file.arrayBuffer(), file.name, true, 1, true); closeSheet(); return; }
    if (/\.(xlsx|xls|csv)$/.test(n)) { markerSheet(); return excelImport(file); }
    const txt = await file.text();
    if (n.endsWith('.json') && txt.includes('lndateh_form')) return receiveForm(txt);
    if (n.endsWith('.json') && txt.includes('lndateh_backup')) return restoreBackup(JSON.parse(txt));
    let gj;
    if (n.endsWith('.gpx')) gj = toGeoJSON.gpx(new DOMParser().parseFromString(txt, 'text/xml'));
    else if (n.endsWith('.kml')) gj = toGeoJSON.kml(new DOMParser().parseFromString(txt, 'text/xml'));
    else gj = JSON.parse(txt);
    const feats = gj.type === 'FeatureCollection' ? gj.features : gj.type === 'Feature' ? [gj] : [{ type: 'Feature', geometry: gj, properties: {} }];
    let c = 0;
    for (const ft of feats) {
      if (!ft.geometry) continue;
      const p = ft.properties || {};
      const own = p._lndt;
      const kind = own && KIND[own.kind] ? own.kind : ft.geometry.type === 'Point' ? 'point' : 'import';
      const f = newFeature(kind, ft.geometry, { name: String(p.name || p.Name || p.ten || p.TEN || p.Ten || ''), layer: file.name });
      if (own) Object.assign(f, { formId: own.formId || '', note: own.note || '', created: own.created || f.created, values: own.values || {} });
      else Object.keys(p).forEach(k => { if (typeof p[k] !== 'object') f.values[k] = p[k]; });
      if (ft.geometry.type === 'LineString' && kind === 'import') f.kind = /gpx/.test(n) ? 'track' : 'line';
      if (ft.geometry.type === 'Polygon' && kind === 'import') f.kind = 'polygon';
      if (own && own.photos && own.photos.length) {
        f.photos = [];
        for (const d of own.photos) { const pid = 'ph_' + uid(); await DB.put('photos', pid, { blob: await (await fetch(d)).blob(), t: Date.now() }); f.photos.push(pid); }
      }
      await saveFeature(f); c++;
    }
    toast(`Đã nhập ${c} đối tượng từ ${file.name}`); closeSheet();
    const b = L.geoJSON(gj).getBounds(); if (b.isValid()) { S.follow = false; map.fitBounds(b, { maxZoom: 17 }); }
  } catch (e) { console.error(e); toast('Không đọc được file: ' + e.message, 4000); }
}
/* ======= Xuất dữ liệu ======= */
async function toGeoJSONFC(list, withPhotos) {
  const out = [];
  for (const f of list) {
    const m = measureOf(f), props = { name: f.name, loai: (KIND[f.kind] || {}).n, mau_bieu: (S.forms.find(x => x.id === f.formId) || {}).name || '' };
    Object.assign(props, f.values || {});
    props.ghi_chu = f.note; props.thoi_gian = fmtTime(f.created); props.nguoi_do = f.by || '';
    if (f.geom.type === 'Point') { const r = CRS.fromWGS(S.set.crs, f.geom.coordinates[0], f.geom.coordinates[1]); if (r.x) { props.X_VN2000 = +r.a; props.Y_VN2000 = +r.b; props.he_toa_do = CRS.BY[S.set.crs].name; } }
    if (m.len != null) props.chieu_dai_m = +m.len.toFixed(2);
    if (m.area != null) { props.dien_tich_m2 = +m.area.toFixed(2); props.dien_tich_ha = +(m.area / 10000).toFixed(4); }
    const own = { kind: f.kind, formId: f.formId, values: f.values, note: f.note, created: f.created, photos: [] };
    props.so_anh = (f.photos || []).length;
    if (withPhotos) for (const pid of f.photos || []) { const p = await DB.get('photos', pid); if (p) own.photos.push(await blobToDataURL(p.blob)); }
    props._lndt = own;
    out.push({ type: 'Feature', geometry: f.geom, properties: props });
  }
  return { type: 'FeatureCollection', name: 'LN_DaTeh_GPS', features: out };
}
const blobToDataURL = b => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
const xmlEsc = s => String(s == null ? '' : s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
function toKML(fc) {
  const coord = cs => cs.map(c => c[0] + ',' + c[1] + ',' + (c[2] || 0)).join(' ');
  const geo = g => g.type === 'Point' ? `<Point><coordinates>${coord([g.coordinates])}</coordinates></Point>`
    : g.type === 'LineString' ? `<LineString><coordinates>${coord(g.coordinates)}</coordinates></LineString>`
    : g.type === 'Polygon' ? `<Polygon>${g.coordinates.map((r, i) => `<${i ? 'innerBoundaryIs' : 'outerBoundaryIs'}><LinearRing><coordinates>${coord(r)}</coordinates></LinearRing></${i ? 'innerBoundaryIs' : 'outerBoundaryIs'}>`).join('')}</Polygon>`
    : g.type.startsWith('Multi') ? `<MultiGeometry>${g.coordinates.map(c => geo({ type: g.type.slice(5), coordinates: c })).join('')}</MultiGeometry>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>LN DaTeh GPS</name>
${fc.features.map(f => `<Placemark><name>${xmlEsc(f.properties.name)}</name><ExtendedData>${Object.keys(f.properties).filter(k => k !== '_lndt').map(k => `<Data name="${xmlEsc(k)}"><value>${xmlEsc(f.properties[k])}</value></Data>`).join('')}</ExtendedData>${geo(f.geometry)}</Placemark>`).join('\n')}
</Document></kml>`;
}
function toGPX(list) {
  const pt = (c, tag, t) => `<${tag} lat="${c[1]}" lon="${c[0]}">${c[2] ? `<ele>${c[2]}</ele>` : ''}${t ? `<time>${new Date(t).toISOString()}</time>` : ''}</${tag}>`;
  let w = '', tr = '';
  list.forEach(f => {
    const g = f.geom;
    if (g.type === 'Point') w += `<wpt lat="${g.coordinates[1]}" lon="${g.coordinates[0]}"><name>${xmlEsc(f.name)}</name><desc>${xmlEsc(f.note)}</desc></wpt>\n`;
    else if (g.type === 'LineString') tr += `<trk><name>${xmlEsc(f.name)}</name><trkseg>${g.coordinates.map((c, i) => pt(c, 'trkpt', f.times && f.times[i])).join('')}</trkseg></trk>\n`;
    else if (g.type === 'Polygon') tr += `<trk><name>${xmlEsc(f.name)}</name><trkseg>${g.coordinates[0].map(c => pt(c, 'trkpt')).join('')}</trkseg></trk>\n`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="LN DaTeh GPS" xmlns="http://www.topografix.com/GPX/1/1">\n${w}${tr}</gpx>`;
}
async function exportFeatures(list, fmt, withPhotos) {
  if (!list.length) return toast('Không có dữ liệu để xuất');
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const base = list.length === 1 && list[0].name ? slug(list[0].name) : 'LNDaTeh_' + stamp;
  if (fmt === 'geojson') { const fc = await toGeoJSONFC(list, withPhotos); return shareBlob(new Blob([JSON.stringify(fc)], { type: 'application/geo+json' }), base + '.geojson'); }
  if (fmt === 'kml') { const fc = await toGeoJSONFC(list, false); return shareBlob(new Blob([toKML(fc)], { type: 'application/vnd.google-earth.kml+xml' }), base + '.kml'); }
  if (fmt === 'gpx') return shareBlob(new Blob([toGPX(list)], { type: 'application/gpx+xml' }), base + '.gpx');
  if (fmt === 'xlsx') {
    await loadScript('vendor/xlsx.full.min.js');
    const fc = await toGeoJSONFC(list, false);
    const rows = fc.features.map(f => { const p = Object.assign({}, f.properties); delete p._lndt; if (f.geometry.type === 'Point') { p.vi_do = f.geometry.coordinates[1]; p.kinh_do = f.geometry.coordinates[0]; } return p; });
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'DuLieu');
    return shareBlob(new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), base + '.xlsx');
  }
}
async function shareBlob(blob, name) {
  if (NATIVE && PLG.Filesystem && PLG.Share) {
    try {
      const data = (await blobToDataURL(blob)).split(',')[1];
      const r = await PLG.Filesystem.writeFile({ path: name, data, directory: 'CACHE' });
      await PLG.Share.share({ title: name, text: 'Dữ liệu từ LN DaTeh GPS', files: [r.uri], dialogTitle: 'Chia sẻ ' + name });
    } catch (e) { if (!/cancel/i.test(e.message || '')) toast('Không chia sẻ được: ' + (e.message || e)); }
    return;
  }
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name, text: 'Dữ liệu từ LN DaTeh GPS' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); toast('Đã lưu file ' + name);
}
const exportSheet = sheetFn('Xuất & chia sẻ dữ liệu', body => {
  body.innerHTML = `<label class="f">Dữ liệu</label><select id="exW"><option value="all">Tất cả (${S.feats.size})</option>${Object.keys(KIND).map(k => `<option value="${k}">${KIND[k].n}</option>`).join('')}<option value="view">Trong khung bản đồ hiện tại</option></select>
    <label class="f">Định dạng</label><select id="exF"><option value="geojson">GeoJSON (QGIS, ArcGIS, MapInfo…)</option><option value="kml">KML (Google Earth)</option><option value="gpx">GPX (máy GPS cầm tay)</option><option value="xlsx">Excel (bảng thuộc tính + tọa độ VN2000)</option></select>
    <label class="f"><input type="checkbox" id="exP">Kèm hình ảnh (chỉ GeoJSON, file lớn)</label>
    <div class="gap"></div><button class="btn primary block" id="exGo">📤 Xuất & chia sẻ (Zalo, Email, Drive…)</button>
    <div class="note">Trên điện thoại, nút chia sẻ mở danh sách ứng dụng: Zalo, Gmail, Google Drive, Facebook Messenger… Trên máy tính, file được tải về.</div>`;
  $('#exGo').onclick = () => {
    const w = $('#exW').value, b = map.getBounds();
    const list = [...S.feats.values()].filter(f => w === 'all' || f.kind === w || (w === 'view' && S.lyr.get(f.id) && (S.lyr.get(f.id).getBounds ? b.intersects(S.lyr.get(f.id).getBounds()) : b.contains(S.lyr.get(f.id).getLatLng()))));
    exportFeatures(list, $('#exF').value, $('#exP').checked);
  };
});

/* ======= Sao lưu ======= */
const backupSheet = sheetFn('Sao lưu / phục hồi', body => {
  body.innerHTML = `<p>Sao lưu toàn bộ dữ liệu, mẫu biểu, hình ảnh và cài đặt thành 1 file để chuyển sang máy khác hoặc lưu trữ.</p>
    <button class="btn primary block" id="bkOut">💾 Tạo file sao lưu</button><div class="gap"></div>
    <button class="btn block" id="bkIn">📂 Phục hồi từ file sao lưu</button><div class="gap"></div>
    <div class="sec">Dung lượng</div><p id="bkSt" class="muted">Đang tính…</p>
    <button class="btn danger block" id="bkClr">🗑️ Xóa toàn bộ dữ liệu thu thập</button>`;
  (async () => { const e = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null; $('#bkSt').textContent = `${S.feats.size} đối tượng · ${await DB.count('photos')} ảnh · ${await DB.count('tiles')} ô bản đồ offline` + (e ? ` · đã dùng ${(e.usage / 1048576).toFixed(1)} MB / ${(e.quota / 1048576).toFixed(0)} MB` : ''); })();
  $('#bkOut').onclick = async () => {
    toast('Đang đóng gói…');
    const fc = await toGeoJSONFC([...S.feats.values()], true);
    shareBlob(new Blob([JSON.stringify({ lndateh_backup: 1, t: Date.now(), settings: S.set, forms: S.forms, custom: S.custom, data: fc })], { type: 'application/json' }), 'SaoLuu_LNDaTehGPS_' + new Date().toISOString().slice(0, 10) + '.json');
  };
  $('#bkIn').onclick = async () => { const f = await pickFile('.json'); if (f) restoreBackup(JSON.parse(await f.text())); };
  $('#bkClr').onclick = async () => {
    if (!confirm('Xóa TOÀN BỘ dữ liệu đã thu thập (không xóa mẫu biểu, bản đồ offline)? Hãy sao lưu trước!')) return;
    for (const id of [...S.feats.keys()]) await deleteFeature(id);
    toast('Đã xóa'); closeSheet();
  };
});
async function restoreBackup(o) {
  if (!o.lndateh_backup) return toast('Không phải file sao lưu');
  if (!confirm(`Phục hồi ${o.data.features.length} đối tượng? (Dữ liệu hiện có được giữ nguyên)`)) return;
  o.forms.forEach(f => { if (!S.forms.find(x => x.id === f.id)) S.forms.push(f); }); await saveForms();
  const blob = new Blob([JSON.stringify(o.data)], { type: 'application/json' });
  await importFile(new File([blob], 'saoluu.geojson'));
}

/* ======= Bản đồ nền, offline, MBTiles ======= */
const layersSheet = sheetFn('Bản đồ nền & lớp dữ liệu', body => {
  const bases = allBases();
  body.innerHTML = `<div class="sec">Bản đồ nền</div>
    ${Object.keys(bases).map(k => `<label class="f" style="font-weight:400;color:var(--fg)"><input type="radio" name="bs" value="${k}" ${k === S.set.base ? 'checked' : ''}> ${esc(bases[k].n)}</label>`).join('')}
    <div class="row" style="margin-top:8px"><input id="mbTok" placeholder="Mapbox access token (pk.…)" value="${esc(S.set.mapboxToken)}"><button class="btn" id="mbSave" style="flex:none">Lưu</button></div>
    <div class="sec">Thêm nền tùy chỉnh (XYZ)</div>
    <input id="cuN" placeholder="Tên (VD: Google vệ tinh, Bản đồ hiện trạng rừng…)"><div class="gap"></div>
    <input id="cuU" placeholder="https://…/{z}/{x}/{y}.png"><div class="gap"></div>
    <button class="btn block" id="cuAdd">➕ Thêm nền</button>
    <div class="note">Dùng nền Google cần tuân thủ điều khoản Google Maps Platform (có API key). Hãy dùng URL mà đơn vị được phép sử dụng.</div>
    ${S.custom.length ? `<ul class="list">${S.custom.map((c, i) => `<li><div class="grow"><div class="t">${esc(c.name)}</div><div class="s">${esc(c.url)}</div></div><button class="btn danger" data-cd="${i}">✕</button></li>`).join('')}</ul>` : ''}
    <div class="sec">Tải bản đồ nền về máy (offline)</div>
    <p class="muted">Tải nền đang chọn trong khung nhìn hiện tại, từ mức zoom ${map.getZoom()} đến:</p>
    <div class="row"><select id="olZ">${[14, 15, 16, 17, 18].filter(z => z >= map.getZoom()).map(z => `<option ${z === Math.min(17, Math.max(map.getZoom(), 16)) ? 'selected' : ''}>${z}</option>`).join('')}</select><button class="btn primary" id="olGo">⬇️ Tải về</button></div>
    <p id="olSt" class="muted"></p>
    <button class="btn danger block" id="olClr">Xóa bộ nhớ bản đồ offline</button>
    <div class="sec">Lớp MBTiles offline</div>
    <ul class="list" id="mbL"></ul>
    <button class="btn block" id="mbAdd">📂 Mở file MBTiles (raster/vector, bình độ…)</button>
    <div class="sec">Ảnh vệ tinh đang hiển thị</div><ul class="list" id="satL"></ul>`;
  body.querySelectorAll('[name=bs]').forEach(r => r.onchange = () => setBase(r.value));
  $('#mbSave').onclick = () => { S.set.mapboxToken = $('#mbTok').value.trim(); saveSet(); if (allBases()[S.set.base].token) setBase(S.set.base); toast('Đã lưu token'); };
  $('#cuAdd').onclick = async () => {
    const n = $('#cuN').value.trim(), u = $('#cuU').value.trim();
    if (!n || !/^https?:\/\/.+\{z\}.+/.test(u)) return toast('Nhập tên và URL có {z}/{x}/{y}');
    S.custom.push({ id: 'cu_' + uid(), name: n, url: u }); await DB.put('kv', 'customBases', S.custom); showTop();
  };
  body.querySelectorAll('[data-cd]').forEach(b => b.onclick = async () => { S.custom.splice(+b.dataset.cd, 1); await DB.put('kv', 'customBases', S.custom); if (!allBases()[S.set.base]) setBase('otm'); showTop(); });
  let abort = false;
  $('#olGo').onclick = async () => {
    if (!baseLayer) return toast('Chưa chọn bản đồ nền');
    const zmax = +$('#olZ').value, b = map.getBounds(), list = [];
    for (let z = Math.floor(map.getZoom()); z <= zmax; z++) {
      const p1 = map.project(b.getNorthWest(), z).divideBy(256).floor(), p2 = map.project(b.getSouthEast(), z).divideBy(256).floor();
      for (let x = p1.x; x <= p2.x; x++) for (let y = p1.y; y <= p2.y; y++) list.push({ x, y, z });
    }
    if (list.length > 8000) return toast(`Vùng quá lớn (${list.length} ô). Hãy phóng to hoặc giảm zoom tối đa.`, 4000);
    if (!confirm(`Tải ${list.length} ô bản đồ (~${(list.length * 0.025).toFixed(0)} MB)?`)) return;
    abort = false; let done = 0, fail = 0; const cid = S.set.base;
    $('#olGo').disabled = true;
    const worker = async () => {
      while (list.length && !abort) {
        const c = list.pop();
        try {
          const u = baseLayer.getTileUrl(c);
          const r = await fetch(u, { mode: 'cors' }); if (!r.ok) throw 0;
          await DB.put('tiles', cid + '/' + c.z + '/' + c.x + '/' + c.y, await r.blob()); done++;
        } catch (e) { fail++; }
        const st = $('#olSt'); if (st) st.textContent = `Đã tải ${done}, lỗi ${fail}, còn ${list.length}…`; else abort = true;
      }
    };
    await Promise.all([1, 2, 3, 4, 5, 6].map(worker));
    const st = $('#olSt'); if (st) st.textContent = `Hoàn tất: ${done} ô${fail ? ', lỗi ' + fail + ' ô (nguồn có thể chặn tải về)' : ''}.`;
    if ($('#olGo')) $('#olGo').disabled = false;
  };
  $('#olClr').onclick = async () => { if (confirm('Xóa toàn bộ ô bản đồ đã tải?')) { await DB.clear('tiles'); toast('Đã xóa'); } };
  $('#mbAdd').onclick = async () => { const f = await pickFile('.mbtiles'); if (f) { toast('Đang mở…'); await addMBTiles(await f.arrayBuffer(), f.name, true, 1, true); showTop(); } };
  const ml = $('#mbL');
  ml.innerHTML = [...S.mbt.values()].map(o => `<li><input type="checkbox" data-v="${esc(o.key)}" ${o.visible ? 'checked' : ''}><div class="grow"><div class="t">${esc(o.name)}</div><div class="s">${o.layer.isVector ? 'Vector' : 'Raster ' + o.mb.format} · z${o.mb.minz}-${o.mb.maxz}</div>
    <input type="range" min="0.1" max="1" step="0.1" value="${o.opacity}" data-o="${esc(o.key)}"></div><button class="btn" data-z="${esc(o.key)}">🔍</button><button class="btn danger" data-d="${esc(o.key)}">✕</button></li>`).join('') || '<li class="muted">Chưa có lớp MBTiles</li>';
  ml.querySelectorAll('[data-v]').forEach(c => c.onchange = () => { const o = S.mbt.get(c.dataset.v); o.visible = c.checked; c.checked ? o.layer.addTo(map) : o.layer.remove(); persistMB(o); });
  ml.querySelectorAll('[data-o]').forEach(c => c.oninput = () => { const o = S.mbt.get(c.dataset.o); o.opacity = +c.value; o.layer.setOpacity(o.opacity); persistMB(o); });
  ml.querySelectorAll('[data-z]').forEach(c => c.onclick = () => { const o = S.mbt.get(c.dataset.z); if (o.mb.bounds) { closeSheet(); S.follow = false; map.fitBounds(o.mb.bounds); } });
  ml.querySelectorAll('[data-d]').forEach(c => c.onclick = async () => { if (!confirm('Gỡ lớp MBTiles?')) return; const o = S.mbt.get(c.dataset.d); o.layer.remove(); o.mb.close(); S.mbt.delete(o.key); await DB.del('files', o.key); showTop(); });
  const sl = $('#satL');
  sl.innerHTML = [...S.sat.values()].map(o => `<li><div class="grow"><div class="t">${esc(o.name)}</div><input type="range" min="0.1" max="1" step="0.1" value="${o.layer.options.opacity}" data-so="${o.id}"></div><button class="btn danger" data-sd="${o.id}">✕</button></li>`).join('') || '<li class="muted">Không có</li>';
  sl.querySelectorAll('[data-so]').forEach(c => c.oninput = () => S.sat.get(c.dataset.so).layer.setOpacity(+c.value));
  sl.querySelectorAll('[data-sd]').forEach(c => c.onclick = () => { const o = S.sat.get(c.dataset.sd); o.layer.remove(); o.fp.remove(); S.sat.delete(o.id); showTop(); });
  return () => { abort = true; };
});
async function addMBTiles(buf, name, visible, opacity, store) {
  const key = 'mbt:' + name;
  if (S.mbt.has(key)) { const o = S.mbt.get(key); o.layer.remove(); o.mb.close(); }
  const mb = await MBT.open(buf, name);
  const layer = MBT.makeLayer(mb, { opacity: opacity || 1, zIndex: 50 });
  const o = { key, name, mb, layer, visible, opacity: opacity || 1 };
  S.mbt.set(key, o);
  if (visible) layer.addTo(map);
  if (store) {
    try { await DB.put('files', key, { buf, name, visible, opacity: o.opacity }); }
    catch (e) { toast('Không đủ bộ nhớ lưu MBTiles, chỉ dùng trong phiên này', 4000); }
    if (mb.bounds) { S.follow = false; map.fitBounds(mb.bounds); }
    toast(`Đã mở ${name} (${layer.isVector ? 'vector: ' + (mb.vlayers.join(', ') || '') : 'raster'}). ${layer.isVector ? 'Chạm vào đối tượng để xem thuộc tính.' : ''}`, 4000);
  }
  return o;
}
async function persistMB(o) { const r = await DB.get('files', o.key); if (r) { r.visible = o.visible; r.opacity = o.opacity; await DB.put('files', o.key, r); } }

/* ======= Ảnh vệ tinh Landsat 8 / Sentinel 2 ======= */
const PC = 'https://planetarycomputer.microsoft.com/api';
const satSheet = sheetFn('Ảnh vệ tinh', body => {
  const today = new Date(), from = new Date(Date.now() - 60 * 864e5);
  body.innerHTML = `<label class="f">Nguồn ảnh</label><select id="saC"><option value="sentinel-2-l2a">Sentinel-2 (10 m, chu kỳ ~5 ngày)</option><option value="landsat-c2-l2">Landsat 8/9 (30 m, chu kỳ 16 ngày)</option></select>
    <div class="row"><div><label class="f">Từ ngày</label><input type="date" id="saF" value="${from.toISOString().slice(0, 10)}"></div><div><label class="f">Đến ngày</label><input type="date" id="saT" value="${today.toISOString().slice(0, 10)}"></div></div>
    <label class="f">Mây tối đa: <b id="saCl">30</b>%</label><input type="range" id="saCc" min="0" max="100" value="30">
    <label class="f">Tổ hợp màu</label><select id="saR"><option value="true">Màu tự nhiên</option><option value="false">Hồng ngoại (phân biệt thực vật, vết cháy)</option></select>
    <div class="gap"></div><button class="btn primary block" id="saGo">🔎 Tìm ảnh trong khung bản đồ</button>
    <div class="note">Nguồn: kho dữ liệu mở Microsoft Planetary Computer (cần Internet). Dùng để phát hiện mất rừng, nương rẫy, điểm cháy mới.</div>
    <ul class="list" id="saL"></ul>`;
  $('#saCc').oninput = () => $('#saCl').textContent = $('#saCc').value;
  $('#saGo').onclick = async () => {
    const col = $('#saC').value, b = map.getBounds();
    $('#saL').innerHTML = '<li class="muted">Đang tìm…</li>';
    const q = { collections: [col], bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], datetime: $('#saF').value + 'T00:00:00Z/' + $('#saT').value + 'T23:59:59Z', limit: 40, sortby: [{ field: 'datetime', direction: 'desc' }], query: { 'eo:cloud_cover': { lt: +$('#saCc').value } } };
    if (col.startsWith('landsat')) q.query.platform = { in: ['landsat-8', 'landsat-9'] };
    try {
      const r = await fetch(PC + '/stac/v1/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(q) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const js = await r.json();
      const items = js.features || [];
      $('#saL').innerHTML = items.map((it, i) => `<li data-i="${i}">${it.assets.rendered_preview ? `<img src="${esc(it.assets.rendered_preview.href)}" style="width:56px;height:56px;object-fit:cover;border-radius:6px" loading="lazy">` : ''}<div class="grow"><div class="t">${new Date(it.properties.datetime).toLocaleDateString('vi-VN')} · ${esc(it.properties.platform || '')}</div><div class="s">Mây ${(+it.properties['eo:cloud_cover']).toFixed(1)}% · ${esc(it.id)}</div></div><span>➕</span></li>`).join('') || '<li class="muted">Không có ảnh phù hợp. Thử nới khoảng thời gian/độ mây.</li>';
      $('#saL').querySelectorAll('[data-i]').forEach(li => li.onclick = () => addSat(items[+li.dataset.i], col, $('#saR').value === 'true'));
    } catch (e) { $('#saL').innerHTML = `<li class="muted">Lỗi kết nối kho ảnh: ${esc(e.message)}. Kiểm tra Internet.</li>`; }
  };
});
async function addSat(it, col, natural) {
  try {
    let url;
    if (natural && it.assets.tilejson) url = it.assets.tilejson.href;
    else {
      const p = new URLSearchParams({ collection: col, item: it.id, format: 'png' });
      if (col.startsWith('sentinel')) {
        if (natural) { p.append('assets', 'visual'); p.append('asset_bidx', 'visual|1,2,3'); p.append('nodata', '0'); }
        else { ['B08', 'B04', 'B03'].forEach(a => p.append('assets', a)); p.append('rescale', '0,4000'); p.append('nodata', '0'); }
      } else {
        (natural ? ['red', 'green', 'blue'] : ['nir08', 'red', 'green']).forEach(a => p.append('assets', a));
        p.append('color_formula', 'gamma RGB 2.7, saturation 1.5, sigmoidal RGB 15 0.55'); p.append('nodata', '0');
      }
      url = PC + '/data/v1/item/tilejson.json?' + p.toString();
    }
    const tj = await (await fetch(url)).json();
    const id = it.id + (natural ? '' : '_nir');
    if (S.sat.has(id)) return toast('Ảnh đã hiển thị');
    const layer = L.tileLayer(tj.tiles[0], { maxZoom: 22, maxNativeZoom: Math.max(tj.maxzoom || 14, 14), minZoom: 8, opacity: 1, zIndex: 40, bounds: tj.bounds ? [[tj.bounds[1], tj.bounds[0]], [tj.bounds[3], tj.bounds[2]]] : undefined }).addTo(map);
    const fp = L.geoJSON(it.geometry, { style: { color: '#ffeb3b', weight: 1, fill: false }, interactive: false }).addTo(map);
    S.sat.set(id, { id, name: (col.startsWith('sentinel') ? 'Sentinel-2 ' : 'Landsat ') + new Date(it.properties.datetime).toLocaleDateString('vi-VN') + (natural ? '' : ' (hồng ngoại)'), layer, fp });
    toast('Đã thêm ảnh vệ tinh. Chỉnh độ trong suốt ở mục Bản đồ nền.'); closeSheet();
  } catch (e) { toast('Không tải được ảnh: ' + e.message); }
}

/* ======= La bàn ======= */
const compassSheet = sheetFn('La bàn số', body => {
  body.innerHTML = `<div class="compass"><div class="needle"></div><div class="rose">
      <span style="transform:translate(-50%,-125px);color:var(--red)">B</span><span style="transform:translate(105px,-50%)">Đ</span>
      <span style="transform:translate(-50%,100px)">N</span><span style="transform:translate(-120px,-50%)">T</span></div></div>
    <div class="compass-val" id="compassVal">--</div>
    <p class="muted" style="text-align:center">Đặt điện thoại nằm ngang. Lắc máy theo hình số 8 để hiệu chuẩn nếu sai lệch.<br>Hướng là phương vị từ (Bắc từ).</p>
    <button class="btn block" id="cpStart">Bật la bàn</button><div class="gap"></div>
    <button class="btn block" id="cpMark">📍 Đánh dấu điểm theo phương vị & khoảng cách</button>`;
  $('#cpStart').onclick = async () => { if (await startCompass()) toast('La bàn đã bật'); };
  startCompass();
  $('#cpMark').onclick = () => {
    const d = parseFloat(prompt('Khoảng cách từ vị trí hiện tại (m):', '50')); if (!(d > 0) || !S.pos) return toast('Cần GPS và khoảng cách hợp lệ');
    const b = parseFloat(prompt('Phương vị (độ):', S.heading != null ? Math.round(S.heading) : '0')); if (isNaN(b)) return;
    const ll = dest(S.pos.ll, b, d);
    const f = newFeature('point', { type: 'Point', coordinates: [+ll.lng.toFixed(7), +ll.lat.toFixed(7)] }, { note: `Giao hội từ GPS: ${d} m, phương vị ${b}°` });
    saveFeature(f).then(() => openFeature(f.id, true));
  };
});

/* ======= Cài đặt ======= */
const settingsSheet = sheetFn('Cài đặt', body => {
  body.innerHTML = `<label class="f">Hệ tọa độ hiển thị & tính diện tích</label>${crsSelect('seC', S.set.crs)}
    <label class="f">Người thu thập (ghi vào dữ liệu và ảnh)</label><input id="seU" value="${esc(S.set.surveyor)}" placeholder="Họ tên, tổ/chốt BVR">
    <div class="sec">Tracklog</div>
    <div class="row"><div><label class="f">Ghi điểm khi di chuyển ≥ (m)</label><input id="seD" type="number" value="${S.set.trackMinDist}"></div><div><label class="f">Bỏ điểm sai số > (m)</label><input id="seA" type="number" value="${S.set.trackMaxAcc}"></div></div>
    <label class="f">Khoảng cách tự động thêm đỉnh khi vẽ (m)</label><input id="seV" type="number" value="${S.set.autoVertexDist}">
    <label class="f">Số lần đo lấy trung bình khi tạo điểm</label><input id="seN" type="number" value="${S.set.avgCount}">
    <div class="sec">Hiển thị & ảnh</div>
    <label class="f"><input type="checkbox" id="seL" ${S.set.labels ? 'checked' : ''}>Hiện nhãn tên đối tượng</label>
    <label class="f"><input type="checkbox" id="seS" ${S.set.stampPhoto ? 'checked' : ''}>Đóng dấu thời gian, tọa độ VN2000 lên ảnh</label>
    <label class="f">Kích thước ảnh tối đa (px)</label><select id="seP">${[1024, 1600, 2048, 3000].map(v => `<option ${v === S.set.photoMax ? 'selected' : ''}>${v}</option>`).join('')}</select>
    <div class="gap"></div><button class="btn primary block" id="seOk">Lưu cài đặt</button>`;
  $('#seOk').onclick = async () => {
    Object.assign(S.set, { crs: $('#seC').value, surveyor: $('#seU').value.trim(), trackMinDist: +$('#seD').value || 5, trackMaxAcc: +$('#seA').value || 30, autoVertexDist: +$('#seV').value || 10, avgCount: Math.max(2, +$('#seN').value || 10), labels: $('#seL').checked, stampPhoto: $('#seS').checked, photoMax: +$('#seP').value });
    await saveSet(); updateCrsLabel(); updateStatus(); S.feats.forEach(render); toast('Đã lưu cài đặt'); closeSheet();
  };
});

/* ======= Hướng dẫn ======= */
const helpSheet = sheetFn('Hướng dẫn nhanh', body => {
  body.innerHTML = `
  <div class="sec">Cài đặt lên điện thoại</div>
  <p>Android (Chrome): Menu ⋮ → <b>Thêm vào màn hình chính / Cài đặt ứng dụng</b>. iPhone (Safari): nút Chia sẻ → <b>Thêm vào MH chính</b>. Sau lần mở đầu, ứng dụng chạy được khi không có mạng.</p>
  <div class="sec">Thu thập</div>
  <p>📍 <b>Điểm</b>: tại GPS, lấy trung bình, tâm bản đồ, chạm, nhập tọa độ.<br>〰️ <b>Đường</b> / ⬠ <b>Vùng</b>: chạm bản đồ, nút "Đỉnh tại GPS", hoặc "🚶 Tự động" để đi bộ quanh lô — máy tự thêm đỉnh.<br>🛰️ <b>Tracklog</b>: bấm để bắt đầu/dừng; có thể vẽ điểm/đường/vùng cùng lúc.<br>📐 <b>Đo</b>: đo nhanh chiều dài, chu vi, diện tích (m², ha).</p>
  ${NATIVE ? '<div class="note">Bản APK: tracklog ghi nền cả khi tắt màn hình (có thông báo trên thanh trạng thái). Hãy cấp quyền vị trí "Luôn cho phép" và tắt tối ưu pin cho ứng dụng.</div>' : '<div class="note warn">Bản web: ứng dụng giữ màn hình sáng khi ghi tracklog. Nếu tắt màn hình, một số máy tạm dừng GPS của trình duyệt (dữ liệu không mất). Dùng bản APK để ghi nền hoàn toàn.</div>'}
  <div class="sec">Mẹo</div>
  <p>• Nhấn giữ bản đồ: xem tọa độ VN2000 tại điểm, tạo điểm, dẫn đường.<br>• Chạm dòng hệ tọa độ trên thanh trạng thái để đổi hệ VN2000 theo tỉnh.<br>• Chạm đối tượng trên lớp MBTiles vector để xem thuộc tính.<br>• Mẫu biểu chia sẻ qua QR: Menu → Mẫu biểu → QR.</p>`;
});

/* ================= Khởi động ================= */
// Cho phép mở file bằng kéo-thả trên máy tính
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) importFile(f); });
// Mở file được chia sẻ tới ứng dụng (File Handling API)
if ('launchQueue' in window) launchQueue.setConsumer(async p => { for (const h of p.files || []) importFile(await h.getFile()); });

loadAll().then(() => { startGPS(); if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); })
  .catch(e => { console.error(e); toast('Lỗi khởi động: ' + e.message, 5000); startGPS(); });
if ('serviceWorker' in navigator && location.protocol !== 'file:' && !NATIVE) navigator.serviceWorker.register('sw.js').catch(() => { });
$('#btnLocate').classList.add('active');
window.LNDT = { S, map, CRS }; // gỡ lỗi
})();
