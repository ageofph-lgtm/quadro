// Cache do app para funcionar offline.
// Código (html/js) = rede primeiro, para atualizações chegarem logo; modelo/wasm = cache primeiro.
const V = 'quadro-v3';
const SHELL = ['./', 'index.html', 'app.js', 'manifest.webmanifest', 'lib/pdf.worker.min.js', 'detector.js', 'lib/ort/ort-wasm-simd-threaded.wasm', 'models/ctd-int8.onnx', 'icons/icon-192.png', 'icons/icon-512.png'];
const HEAVY = /\.(wasm|onnx|png)$/;
self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
const save = (req, res) => { if (res.ok) { const copy = res.clone(); caches.open(V).then((c) => c.put(req, copy)); } return res; };
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (HEAVY.test(url.pathname)) {
    e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).then((r) => save(e.request, r))));
  } else {
    e.respondWith(fetch(e.request).then((r) => save(e.request, r)).catch(() => caches.match(e.request, { ignoreSearch: true })));
  }
});
