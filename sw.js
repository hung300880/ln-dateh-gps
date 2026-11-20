/* Service worker: chạy offline */
const V = 'lndateh-v3';
const SHELL = ['./', 'index.html', 'mbtiles-tool.html', 'css/app.css', 'js/app.js', 'js/version.js', 'js/crs.js', 'js/db.js', 'js/mbtiles.js',
  'vendor/leaflet.js', 'vendor/leaflet.css', 'vendor/proj4.js', 'vendor/togeojson.umd.js', 'vendor/sql-wasm.js', 'vendor/sql-wasm.wasm',
  'vendor/vt.js', 'vendor/qrcode.js', 'vendor/jsQR.js', 'vendor/xlsx.full.min.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'vendor/images/marker-icon.png', 'vendor/images/marker-icon-2x.png', 'vendor/images/marker-shadow.png', 'vendor/images/layers.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // bản đồ nền xử lý trong ứng dụng
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request).then(res => {
    if (res.ok) { const cl = res.clone(); caches.open(V).then(c => c.put(e.request, cl)); }
    return res;
  })).catch(() => caches.match('index.html')));
});
