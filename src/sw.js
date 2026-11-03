// Cache do app para funcionar offline
const V = 'quadro-v2';
const SHELL = ['./', 'index.html', 'app.js', 'manifest.webmanifest', 'lib/pdf.worker.min.js', 'detector.js', 'lib/ort/ort-wasm-simd-threaded.wasm', 'models/ctd-int8.onnx', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(V).then((c) => c.put(e.request, copy)); }
    return res;
  })));
});
