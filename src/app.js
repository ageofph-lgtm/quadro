// Quadro — leitor de HQ em PDF (v1)
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'; // build com polyfills: funciona em Safari/Chrome de celular
import { PageFlip } from 'page-flip/dist/js/page-flip.module.js';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('lib/pdf.worker.min.js', document.baseURI).href;
const PDF_OPTS = {
  wasmUrl: new URL('lib/wasm/', document.baseURI).href,
  standardFontDataUrl: new URL('lib/standard_fonts/', document.baseURI).href,
  isEvalSupported: false,
};

const $ = (s) => document.querySelector(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// iPhone/iPad recusam canvas acima de ~16,7 megapixels; fica uma margem de segurança
const MAX_CANVAS_PX = /iP(hone|ad|od)|Macintosh.*Mobile/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform)) ? 12e6 : 24e6;
function fitArea(w, h) { const k = Math.min(1, Math.sqrt(MAX_CANVAS_PX / (w * h))); return k; }
const inIframe = (() => { try { return window.self !== window.top; } catch { return true; } })();

/* ======================= Armazenamento (IndexedDB) ======================= */
const DB = {
  db: null,
  async open() {
    if (this.db) return this.db;
    this.db = await new Promise((res, rej) => {
      const rq = indexedDB.open('quadro', 2);
      rq.onupgradeneeded = () => {
        const d = rq.result;
        const has = (n) => d.objectStoreNames.contains(n);
        if (!has('comics')) d.createObjectStore('comics', { keyPath: 'id' });
        if (!has('files')) d.createObjectStore('files');
        if (!has('meta')) d.createObjectStore('meta');
        if (!has('bubbles')) d.createObjectStore('bubbles');
      };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
    return this.db;
  },
  async tx(store, mode, fn) {
    const d = await this.open();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode);
      const r = fn(t.objectStore(store));
      t.oncomplete = () => res(r && 'result' in r ? r.result : undefined);
      t.onerror = () => rej(t.error);
    });
  },
  all: (s) => DB.tx(s, 'readonly', (o) => o.getAll()),
  get: (s, k) => DB.tx(s, 'readonly', (o) => o.get(k)),
  put: (s, v, k) => DB.tx(s, 'readwrite', (o) => (k === undefined ? o.put(v) : o.put(v, k))),
  del: (s, k) => DB.tx(s, 'readwrite', (o) => o.delete(k)),
};
const mem = new Map(); // fallback se IndexedDB falhar
const store = {
  async all() { try { return await DB.all('comics'); } catch { return [...mem.values()]; } },
  async put(c) { mem.set(c.id, c); try { await DB.put('comics', c); } catch {} },
  async get(id) { try { return (await DB.get('comics', id)) || mem.get(id); } catch { return mem.get(id); } },
  async del(id) { mem.delete(id); try { await DB.del('comics', id); await DB.del('files', id); } catch {} },
  async putFile(id, blob) { memFiles.set(id, blob); try { await DB.put('files', blob, id); } catch {} },
  async getFile(id) { if (memFiles.has(id)) return memFiles.get(id); try { return await DB.get('files', id); } catch { return null; } },
};
const memFiles = new Map();

/* ======================= UI util ======================= */
let toastT;
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), ms);
}
const cleanName = (n) => n.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').trim();

/* ======================= Biblioteca ======================= */
let comics = [];
let dirHandle = null;
const coverURLs = new Map();

async function addFiles(files, { open = false } = {}) {
  const pdfs = [...files].filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
  if (!pdfs.length) return toast('Nenhum PDF encontrado');
  let first = null;
  for (const f of pdfs) {
    const id = `f:${f.name}|${f.size}`;
    let c = await store.get(id);
    if (!c) {
      c = { id, name: cleanName(f.name), folder: '', source: 'file', size: f.size, page: 0, pages: 0, added: Date.now(), lastRead: 0 };
      await store.putFile(id, f);
      await store.put(c);
    }
    first = first || c;
  }
  toast(pdfs.length === 1 ? 'HQ adicionada' : `${pdfs.length} HQs adicionadas`);
  await refreshLibrary();
  queueCovers();
  if (open && first) openComic(first.id);
}

async function scanDir(handle, path = []) {
  const out = [];
  for await (const [name, h] of handle.entries()) {
    if (h.kind === 'directory') out.push(...(await scanDir(h, [...path, name])));
    else if (/\.pdf$/i.test(name)) out.push({ name, path: [...path, name], handle: h });
  }
  return out;
}

async function syncFolder() {
  if (!dirHandle) return;
  toast('Lendo a pasta…', 1500);
  const found = await scanDir(dirHandle);
  const existing = new Map((await store.all()).filter((c) => c.source === 'dir').map((c) => [c.id, c]));
  const seen = new Set();
  for (const f of found) {
    const id = 'd:' + f.path.join('/');
    seen.add(id);
    if (!existing.has(id)) {
      await store.put({ id, name: cleanName(f.name), folder: f.path.slice(0, -1).join(' / '), source: 'dir', path: f.path, page: 0, pages: 0, added: Date.now(), lastRead: 0 });
    }
  }
  for (const id of existing.keys()) if (!seen.has(id)) await store.del(id);
  await refreshLibrary();
  queueCovers();
}

async function pickFolder() {
  try {
    dirHandle = await window.showDirectoryPicker({ id: 'quadro-hqs', mode: 'read' });
    try { await DB.put('meta', dirHandle, 'dir'); } catch {}
    $('#banner').classList.add('hidden');
    await syncFolder();
  } catch (e) {
    if (e.name !== 'AbortError') toast('Não deu para abrir a pasta aqui. Use “Adicionar PDFs”.');
  }
}

async function restoreFolder() {
  if (!('showDirectoryPicker' in window) || inIframe) return;
  let h; try { h = await DB.get('meta', 'dir'); } catch { return; }
  if (!h) return;
  dirHandle = h;
  const perm = await h.queryPermission({ mode: 'read' });
  if (perm === 'granted') return syncFolder();
  const b = $('#banner');
  b.innerHTML = `<span>Reconectar a pasta <b>${h.name}</b> para ver as HQs dela.</span><button class="btn pri" id="reconn">Reconectar</button>`;
  b.classList.remove('hidden');
  $('#reconn').onclick = async () => {
    if ((await h.requestPermission({ mode: 'read' })) === 'granted') { b.classList.add('hidden'); syncFolder(); }
  };
}

async function getComicBlob(c) {
  if (c.source === 'file') return store.getFile(c.id);
  if (!dirHandle) throw new Error('pasta desconectada');
  if ((await dirHandle.queryPermission({ mode: 'read' })) !== 'granted') {
    if ((await dirHandle.requestPermission({ mode: 'read' })) !== 'granted') throw new Error('sem permissão');
  }
  let h = dirHandle;
  for (const p of c.path.slice(0, -1)) h = await h.getDirectoryHandle(p);
  return (await h.getFileHandle(c.path.at(-1))).getFile();
}

function coverURL(c) {
  if (!c.cover) return null;
  if (!coverURLs.has(c.id)) coverURLs.set(c.id, URL.createObjectURL(c.cover));
  return coverURLs.get(c.id);
}

function card(c) {
  const el = document.createElement('div');
  el.className = 'comic'; el.dataset.id = c.id; el.role = 'button';
  const pn = c.pageNum || 1;
  const pct = c.pages ? Math.min(100, Math.round((pn / c.pages) * 100)) : 0;
  const url = coverURL(c);
  el.innerHTML = `
    <div class="cv">
      <div class="ph">${(c.name[0] || '?').toUpperCase()}</div>
      <img ${url ? `src="${url}" class="on"` : ''} alt="">
      ${c.lastRead ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}
      <button class="x" title="Remover">✕</button>
    </div>
    <div class="t"></div>
    <div class="s"></div>`;
  el.querySelector('.t').textContent = c.name;
  el.querySelector('.s').textContent = c.lastRead && c.pages ? `pág. ${pn} de ${c.pages}` : (c.folder || (c.pages ? `${c.pages} págs.` : ''));
  el.onclick = (e) => {
    if (e.target.closest('.x')) { e.stopPropagation(); return removeComic(c); }
    openComic(c.id);
  };
  return el;
}

async function removeComic(c) {
  if (c.source === 'dir') return toast('Essa HQ vem da pasta — apague ou mova o arquivo lá.');
  await store.del(c.id);
  toast('Removida da estante');
  refreshLibrary();
}

async function refreshLibrary() {
  comics = (await store.all()).sort((a, b) => a.name.localeCompare(b.name, 'pt', { numeric: true }));
  const reading = comics.filter((c) => c.lastRead && c.pages && (c.pageNum || 1) < c.pages).sort((a, b) => b.lastRead - a.lastRead).slice(0, 12);
  $('#cont').replaceChildren(...reading.map(card));
  $('#all').replaceChildren(...comics.map(card));
  $('#contWrap').classList.toggle('hidden', !reading.length);
  $('#allWrap').classList.toggle('hidden', !comics.length);
  $('#empty').classList.toggle('hidden', !!comics.length);
}

let coverBusy = false;
async function queueCovers() {
  if (coverBusy) return; coverBusy = true;
  try {
    for (const c of comics.filter((x) => !x.cover)) {
      if (!$('#reader').classList.contains('hidden')) await sleep(1500); // não atrapalhar a leitura
      try {
        const blob = await getComicBlob(c);
        const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), ...PDF_OPTS });
        const doc = await task.promise;
        const page = await doc.getPage(1);
        const vp0 = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: 420 / vp0.width });
        const cv = document.createElement('canvas');
        cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
        await page.render({ canvas: cv, viewport: vp }).promise;
        c.cover = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.82));
        c.pages = c.pages || doc.numPages;
        await task.destroy();
        await store.put(c);
        const img = document.querySelectorAll(`.comic[data-id="${CSS.escape(c.id)}"] img`);
        img.forEach((i) => { i.src = coverURL(c); i.classList.add('on'); });
      } catch (e) { console.warn('capa', c.name, e); }
    }
  } finally { coverBusy = false; }
}

/* ======================= Leitor ======================= */
const R = {
  comic: null, doc: null, entries: [], pf: null, cur: 0,
  urls: new Map(), rendering: new Set(), queueTimer: null, renderH: 0,
  forceSingle: false, wake: null,
};
try { R.forceSingle = localStorage.getItem('quadro.single') === '1'; } catch {}

async function openComic(id) {
  const c = await store.get(id);
  if (!c) return;
  R.comic = c;
  $('#library').classList.add('hidden');
  $('#reader').classList.remove('hidden');
  $('#rTitle').textContent = c.name;
  $('#loading').classList.remove('hidden');
  $('#btnSpread').classList.toggle('on', !R.forceSingle);
  try {
    const blob = await getComicBlob(c);
    R.task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), ...PDF_OPTS });
    R.doc = await R.task.promise;
    await buildEntries();
    buildBook();
    c.pages = R.doc.numPages;
    c.lastRead = Date.now();
    store.put(c);
    requestWake();
    showChrome(true, 2200);
    startDetection();
  } catch (e) {
    console.error(e);
    toast('Não consegui abrir: ' + (e.message || e));
    closeReader();
  } finally {
    $('#loading').classList.add('hidden');
  }
}

// Cada "entry" é uma página do livro. Páginas largas (páginas duplas) viram duas metades,
// alinhadas para caírem lado a lado no modo paisagem.
async function buildEntries() {
  const n = R.doc.numPages;
  const sizes = [];
  for (let i = 1; i <= n; i++) {
    const vp = (await R.doc.getPage(i)).getViewport({ scale: 1 });
    sizes.push({ w: vp.width, h: vp.height });
  }
  const ratios = sizes.map((s) => s.w / s.h).filter((r) => r < 1).sort((a, b) => a - b);
  R.ratio = ratios.length ? ratios[Math.floor(ratios.length / 2)] : 0.65;
  const E = [];
  sizes.forEach((s, i) => {
    const p = i + 1;
    if (s.w / s.h > R.ratio * 1.6 && i > 0) {
      if (E.length % 2 === 0) E.push({ blank: true }); // a metade esquerda precisa ficar num índice ímpar
      E.push({ p, half: 'L' }, { p, half: 'R' });
    } else E.push({ p });
  });
  R.entries = E;
}

function wantLandscape() {
  const st = $('#stage');
  return !R.forceSingle && st.clientWidth / st.clientHeight > R.ratio * 1.45;
}
// A biblioteca usa 1 página quando largura < 2×minWidth. Ajustamos minWidth pela largura real do palco.
function orientationMinWidth() {
  return wantLandscape() ? 1 : Math.ceil($('#stage').clientWidth / 2) + 2;
}
function applyOrientationSetting() {
  if (!R.pf) return;
  R.pf.getSettings().minWidth = orientationMinWidth();
  const bk = $('#book'); if (bk) { bk.style.minWidth = '0px'; bk.style.minHeight = '0px'; }
}

function buildBook() {
  destroyBook();
  const book = document.createElement('div');
  book.id = 'book';
  $('#stage').replaceChildren(book);
  const els = R.entries.map((e, i) => {
    const d = document.createElement('div');
    d.className = 'page' + (e.blank ? ' blank' : '');
    d.dataset.i = i;
    if (i === 0) d.dataset.density = 'hard';
    if (!e.blank) d.innerHTML = '<img alt=""><div class="spin"></div><div class="bl"></div>';
    return d;
  });
  book.append(...els);

  const baseW = 1000, baseH = Math.round(1000 / R.ratio);
  const start = Math.min(R.comic.page || 0, R.entries.length - 1);
  const pf = new PageFlip(book, {
    width: baseW, height: baseH, size: 'stretch',
    minWidth: orientationMinWidth(), maxWidth: 4000, minHeight: 1, maxHeight: 6000,
    showCover: true, usePortrait: true, drawShadow: true, maxShadowOpacity: 0.55,
    flippingTime: 650, mobileScrollSupport: false, swipeDistance: 40,
    showPageCorners: true, startPage: start, autoSize: true,
  });
  // Toques simples são tratados pelo app (zonas de toque); a biblioteca cuida só de arrastar e swipe.
  const origStop = pf.userStop.bind(pf);
  pf.userStop = function (pos, isSwipe = false) {
    if (this.isUserTouch && !isSwipe && !this.isUserMove) { this.isUserTouch = false; return; }
    return origStop(pos, isSwipe);
  };
  pf.loadFromHTML(els);
  book.style.minWidth = '0px'; book.style.minHeight = '0px'; // a biblioteca aplica minWidth como estilo
  pf.update();
  pf.on('flip', (e) => onPage(e.data));
  pf.on('changeOrientation', () => scheduleRender());
  R.pf = pf;
  R.cur = start;
  for (let i = 0; i < R.entries.length; i++) drawBubbleLayer(i);
  const sc = $('#scrub');
  sc.max = R.entries.length - 1;
  onPage(start);
}

function destroyBook() {
  if (R.pf) { try { R.pf.destroy(); } catch {} R.pf = null; }
  for (const u of R.urls.values()) URL.revokeObjectURL(u);
  R.urls.clear();
  R.rendering.clear();
}

function visibleIndices() {
  const i = R.cur;
  if (R.pf && R.pf.getOrientation() === 'landscape') {
    if (i === 0) return [0];
    const left = i % 2 === 1 ? i : i - 1;
    return [left, left + 1].filter((x) => x < R.entries.length);
  }
  return [i];
}

function onPage(i) {
  R.cur = i;
  const e = R.entries[i] || {};
  const n = R.doc.numPages;
  const vis = visibleIndices().map((x) => R.entries[x]).filter((x) => x && !x.blank);
  const ps = [...new Set(vis.map((x) => x.p))];
  $('#pnum').textContent = (ps.length ? (ps.length > 1 ? `${ps[0]}–${ps.at(-1)}` : ps[0]) : e.p || '') + ` / ${n}`;
  const sc = $('#scrub');
  sc.value = i;
  sc.style.setProperty('--p', (i / Math.max(1, R.entries.length - 1)) * 100 + '%');
  if (R.comic) {
    R.comic.page = i; R.comic.pageNum = ps.at(-1) || e.p || 1; R.comic.lastRead = Date.now();
    clearTimeout(R.saveT); R.saveT = setTimeout(() => store.put(R.comic), 400);
  }
  scheduleRender();
  pulseBubbles();
  if (B.guided) setTimeout(continueGuided, 80);
  else kickDetection();
}

function scheduleRender() {
  clearTimeout(R.queueTimer);
  R.queueTimer = setTimeout(pumpRender, 30);
}

function targetHeight() {
  const rect = R.pf ? R.pf.getBoundsRect() : null;
  const h = rect ? rect.height : innerHeight;
  return Math.min(3200, Math.round(h * Math.min(devicePixelRatio || 1, 2.5)));
}

async function renderEntry(i, H) {
  const e = R.entries[i];
  const page = await R.doc.getPage(e.p);
  const vp0 = page.getViewport({ scale: 1 });
  let scale = H / vp0.height;
  scale *= fitArea((e.half ? vp0.width / 2 : vp0.width) * scale, vp0.height * scale);
  const vp = page.getViewport({ scale });
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(e.half ? vp.width / 2 : vp.width);
  cv.height = Math.ceil(vp.height);
  const ctx = cv.getContext('2d', { alpha: false });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  const transform = e.half === 'R' ? [1, 0, 0, 1, -vp.width / 2, 0] : null;
  await page.render({ canvas: cv, viewport: vp, transform }).promise;
  const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.9));
  cv.width = cv.height = 0;
  return URL.createObjectURL(blob);
}

let pumping = false;
async function pumpRender() {
  if (pumping || !R.doc) return;
  pumping = true;
  try {
    const H = targetHeight();
    if (Math.abs(H - R.renderH) > 200 && R.renderH) {
      // tamanho mudou bastante (rotação/tela cheia): re-renderiza em volta
      for (const u of R.urls.values()) URL.revokeObjectURL(u);
      R.urls.clear();
    }
    R.renderH = H;
    const vis = visibleIndices();
    const base = vis[0];
    const order = [...vis];
    for (let d = 1; d <= 6; d++) { order.push(vis.at(-1) + d); if (d <= 3) order.push(base - d); }
    const keep = new Set();
    for (let k = base - 8; k <= vis.at(-1) + 10; k++) keep.add(k);
    for (const [k, u] of R.urls) if (!keep.has(k)) { URL.revokeObjectURL(u); R.urls.delete(k); setImg(k, null); }
    const doc = R.doc;
    for (const i of order) {
      if (R.doc !== doc) break;
      if (i < 0 || i >= R.entries.length || R.entries[i].blank || R.urls.has(i)) continue;
      const url = await renderEntry(i, H);
      if (R.doc !== doc) { URL.revokeObjectURL(url); break; }
      R.urls.set(i, url);
      setImg(i, url);
    }
  } catch (e) { console.warn('render', e); }
  finally { pumping = false; }
}

function setImg(i, url) {
  document.querySelectorAll(`#book .page[data-i="${i}"] img`).forEach((img) => {
    if (url) { img.onload = () => img.classList.add('on'); img.src = url; }
    else { img.classList.remove('on'); img.removeAttribute('src'); }
  });
}

function closeReader() {
  closeZoom(true);
  if (R.comic) store.put(R.comic);
  destroyBook();
  if (R.task) { R.task.destroy(); R.task = null; }
  R.doc = null;
  R.comic = null;
  B.pages.clear(); B.guided = null; B.waiting = null; updateDetChip();
  for (const u of Z.hires.values()) URL.revokeObjectURL(u);
  Z.hires.clear();
  releaseWake();
  $('#reader').classList.add('hidden');
  $('#library').classList.remove('hidden');
  refreshLibrary();
}

const guidedBusy = () => B.guided && performance.now() - (B.guidedAt || 0) < 1600;
function next(force) { if (R.pf && (force || !guidedBusy())) R.pf.flipNext('bottom'); }
function prev(force) { if (R.pf && (force || !guidedBusy())) R.pf.flipPrev('bottom'); }

/* ---- HUD ---- */
let chromeT;
function showChrome(on, autoHideMs) {
  $('#reader').classList.toggle('chrome-off', !on);
  clearTimeout(chromeT);
  if (on && autoHideMs) chromeT = setTimeout(() => $('#reader').classList.add('chrome-off'), autoHideMs);
}

/* ---- Toques ---- */
const tap = { down: null, last: 0, lastX: 0, lastY: 0, single: null, pointers: new Map() };
const stage = $('#stage');
stage.addEventListener('pointerdown', (e) => {
  tap.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (tap.pointers.size === 2) {
    // pinça → abre o zoom no ponto médio
    const [a, b] = [...tap.pointers.values()];
    tap.down = null;
    openZoom((a.x + b.x) / 2, (a.y + b.y) / 2, { fromPinch: true, pinch: [...tap.pointers.entries()] });
    return;
  }
  tap.down = { x: e.clientX, y: e.clientY, t: performance.now() };
});
const endPointer = (e) => {
  tap.pointers.delete(e.pointerId);
  const d = tap.down; tap.down = null;
  if (!d || e.type === 'pointercancel') return;
  if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 12 || performance.now() - d.t > 400) return;
  handleTap(e.clientX, e.clientY);
};
stage.addEventListener('pointerup', endPointer);
stage.addEventListener('pointercancel', endPointer);

function handleTap(x, y) {
  if (R.pf && ['flipping', 'user_fold'].includes(R.pf.getState())) return;
  const w = innerWidth;
  const now = performance.now();
  const isDouble = now - tap.last < 320 && Math.hypot(x - tap.lastX, y - tap.lastY) < 40;
  if (isDouble) {
    clearTimeout(tap.single); tap.last = 0;
    openZoom(x, y);
    return;
  }
  tap.last = now; tap.lastX = x; tap.lastY = y;
  if (B.on && x > w * 0.06 && x < w * 0.94) {
    const hit = bubbleAt(x, y);
    if (hit) { clearTimeout(tap.single); tap.last = 0; return openBubble(hit.i, hit.k); }
  }
  if (x < w * 0.22) { showChrome(false); return prev(); }
  if (x > w * 0.78) { showChrome(false); return next(); }
  clearTimeout(tap.single);
  tap.single = setTimeout(() => showChrome($('#reader').classList.contains('chrome-off'), 0), 320);
}

let wheelLock = 0;
stage.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.ctrlKey) return openZoom(e.clientX, e.clientY);
  const now = performance.now();
  if (now < wheelLock || Math.abs(e.deltaY) < 8) return;
  wheelLock = now + 450;
  e.deltaY > 0 ? next() : prev();
}, { passive: false });

addEventListener('keydown', (e) => {
  if ($('#reader').classList.contains('hidden')) return;
  if (!$('#zoom').classList.contains('hidden')) {
    if (e.key === 'Escape') closeZoom();
    else if (Z.mode === 'bubble' && ['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); bubbleStep(1); }
    else if (Z.mode === 'bubble' && ['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); bubbleStep(-1); }
    return;
  }
  if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); next(); }
  else if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); prev(); }
  else if (e.key === 'Escape') { if (document.fullscreenElement) document.exitFullscreen(); else closeReader(); }
  else if (e.key === 'f') toggleFull();
});

// rotação / redimensionamento: decide 1 ou 2 páginas antes da biblioteca recalcular
addEventListener('resize', () => { applyOrientationSetting(); scheduleRender(); }, true);

$('#scrub').addEventListener('input', (e) => {
  const i = +e.target.value;
  e.target.style.setProperty('--p', (i / Math.max(1, R.entries.length - 1)) * 100 + '%');
  showChrome(true);
});
$('#scrub').addEventListener('change', (e) => {
  if (!R.pf) return;
  R.pf.turnToPage(+e.target.value);
  onPage(R.pf.getCurrentPageIndex());
  showChrome(true, 1800);
});
$('#btnBack').onclick = closeReader;
$('#btnFull').onclick = toggleFull;
$('#btnSpread').onclick = () => {
  R.forceSingle = !R.forceSingle;
  try { localStorage.setItem('quadro.single', R.forceSingle ? '1' : '0'); } catch {}
  $('#btnSpread').classList.toggle('on', !R.forceSingle);
  toast(R.forceSingle ? 'Uma página por vez' : 'Página dupla automática (paisagem)');
  const keep = R.cur;
  R.comic.page = keep;
  buildBook();
};

async function toggleFull() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
  } catch { toast('Tela cheia indisponível aqui'); }
}

async function requestWake() {
  try { R.wake = await navigator.wakeLock?.request('screen'); } catch {}
}
function releaseWake() { try { R.wake?.release(); } catch {} R.wake = null; }
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && R.comic) requestWake();
});

/* ======================= Balões (IA) ======================= */
const B = {
  on: true, pages: new Map(), running: false, queueDirty: false, guided: null, total: 0, done: 0, failed: false,
};
try { B.on = localStorage.getItem('quadro.bubbles') !== '0'; } catch {}

const Det = {
  worker: null, seq: 0, pending: new Map(),
  get() {
    if (!this.worker) {
      this.worker = new Worker(new URL('detector.js', document.baseURI), { type: 'module' });
      this.worker.onmessage = (e) => {
        const p = this.pending.get(e.data.id);
        if (!p) return;
        this.pending.delete(e.data.id);
        e.data.ok ? p.res(e.data) : p.rej(new Error(e.data.error));
      };
      this.worker.onerror = (e) => {
        for (const p of this.pending.values()) p.rej(new Error(e.message || 'falha no worker'));
        this.pending.clear();
        this.worker = null;
      };
    }
    return this.worker;
  },
  call(msg, transfer = []) {
    return new Promise((res, rej) => {
      const id = ++this.seq;
      this.pending.set(id, { res, rej });
      this.get().postMessage({ ...msg, id, base: document.baseURI }, transfer);
    });
  },
};

const bKey = (p) => `${R.comic.id}|${p}`;

async function loadCachedBoxes() {
  const n = R.doc.numPages;
  await Promise.all(Array.from({ length: n }, async (_, k) => {
    try { const v = await DB.get('bubbles', bKey(k + 1)); if (v) B.pages.set(k + 1, v.boxes); } catch {}
  }));
}

async function detectPage(p) {
  const page = await R.doc.getPage(p);
  const vp0 = page.getViewport({ scale: 1 });
  const sc = 1024 / Math.max(vp0.width, vp0.height);
  const vp = page.getViewport({ scale: sc });
  const cv = document.createElement('canvas');
  cv.width = Math.min(1024, Math.round(vp.width)); cv.height = Math.min(1024, Math.round(vp.height));
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  await page.render({ canvas: cv, viewport: vp }).promise;
  const img = ctx.getImageData(0, 0, cv.width, cv.height);
  cv.width = cv.height = 0;
  const r = await Det.call({ type: 'detect', data: img.data, width: img.width, height: img.height }, [img.data.buffer]);
  return r.boxes;
}

function detectionOrder() {
  const n = R.doc.numPages;
  const vis = visibleIndices().map((i) => R.entries[i]).filter((e) => e && !e.blank).map((e) => e.p);
  const cur = vis[0] || 1;
  const order = [...new Set(vis)];
  for (let p = cur + 1; p <= n; p++) order.push(p);
  for (let p = cur - 1; p >= 1; p--) order.push(p);
  return [...new Set(order)].filter((p) => !B.pages.has(p));
}

async function startDetection() {
  B.pages.clear(); B.failed = false;
  await loadCachedBoxes();
  for (let i = 0; i < R.entries.length; i++) drawBubbleLayer(i);
  pulseBubbles();
  kickDetection();
}

function kickDetection() {
  if (!B.on || !R.doc) return;
  if (B.running) { B.queueDirty = true; return; }
  runDetection();
}

async function runDetection() {
  B.running = true;
  const doc = R.doc, comic = R.comic;
  try {
    let order = detectionOrder();
    B.total = R.doc.numPages; B.done = B.total - order.length;
    updateDetChip();
    while (order.length && R.doc === doc && B.on) {
      if (B.queueDirty) { B.queueDirty = false; order = detectionOrder(); if (!order.length) break; }
      // não disputa CPU com a virada de página
      while (R.pf && ['flipping', 'user_fold'].includes(R.pf.getState())) await sleep(200);
      const p = order.shift();
      const boxes = await detectPage(p);
      if (R.doc !== doc) break;
      B.pages.set(p, boxes);
      try { await DB.put('bubbles', { boxes, at: Date.now() }, `${comic.id}|${p}`); } catch {}
      B.done++;
      updateDetChip();
      R.entries.forEach((e, i) => { if (e.p === p) drawBubbleLayer(i); });
      if (visibleIndices().some((i) => R.entries[i]?.p === p)) pulseBubbles();
      if (B.waiting) B.waiting();
    }
  } catch (e) {
    console.warn('detecção', e);
    B.failed = true;
    toast('Zoom em balão indisponível: ' + e.message, 4000);
  } finally {
    B.running = false;
    updateDetChip();
    if (B.queueDirty && R.doc === doc) { B.queueDirty = false; kickDetection(); }
  }
}

function updateDetChip() {
  const c = $('#detChip');
  const show = B.on && R.doc && B.running && B.done < B.total;
  c.classList.toggle('hidden', !show);
  if (show) c.textContent = `IA lendo balões ${B.done}/${B.total}`;
  $('#btnBubbles').classList.toggle('on', B.on);
  $('#btnGuide').classList.toggle('hidden', !B.on);
}

// caixas de uma entry (página ou metade), em coordenadas 0..1 dessa entry
function entryBoxes(i) {
  const e = R.entries[i];
  if (!e || e.blank) return [];
  const boxes = B.pages.get(e.p);
  if (!boxes) return null;
  if (!e.half) return boxes;
  const L = e.half === 'L';
  return boxes
    .filter(([x0, , x1]) => ((x0 + x1) / 2 < 0.5) === L)
    .map(([x0, y0, x1, y1, s, b]) => {
      const f = (x) => Math.max(0, Math.min(1, L ? x * 2 : (x - 0.5) * 2));
      return [f(x0), y0, f(x1), y1, s, b];
    });
}

function drawBubbleLayer(i) {
  const boxes = entryBoxes(i) || [];
  document.querySelectorAll(`#book .page[data-i="${i}"] .bl`).forEach((layer) => {
    layer.innerHTML = boxes.map(([x0, y0, x1, y1]) =>
      `<i style="left:${x0 * 100}%;top:${y0 * 100}%;width:${(x1 - x0) * 100}%;height:${(y1 - y0) * 100}%"></i>`).join('');
  });
}

let pulseT;
function pulseBubbles() {
  if (!B.on) return;
  clearTimeout(pulseT);
  pulseT = setTimeout(() => {
    for (const i of visibleIndices()) {
      document.querySelectorAll(`#book .page[data-i="${i}"] .bl`).forEach((l) => {
        l.classList.remove('pulse'); void l.offsetWidth; l.classList.add('pulse');
      });
    }
  }, 120);
}

function pageEl(i) { return document.querySelector(`#book .page[data-i="${i}"]`); }

function bubbleAt(x, y) {
  for (const i of visibleIndices()) {
    const el = pageEl(i), boxes = entryBoxes(i);
    if (!el || !boxes?.length) continue;
    const r = el.getBoundingClientRect();
    const nx = (x - r.left) / r.width, ny = (y - r.top) / r.height;
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) continue;
    const m = 0.012;
    const k = boxes.findIndex(([x0, y0, x1, y1]) => nx >= x0 - m && nx <= x1 + m && ny >= y0 - m && ny <= y1 + m);
    if (k >= 0) return { i, k };
  }
  return null;
}

function bubbleSeq() {
  return visibleIndices().sort((a, b) => a - b).flatMap((i) => (entryBoxes(i) || []).map((_, k) => ({ i, k })));
}

/* ======================= Zoom (livre e por balão) ======================= */
const Z = { open: false, mode: 'free', s: 1, x: 0, y: 0, w: 0, h: 0, rect: null, pointers: new Map(), gesture: null, idx: -1, lastTap: 0, seq: [], pos: 0, hires: new Map(), spotOff: false };
const zEl = $('#zoom'), zImg = $('#zimg'), zPage = $('#zpage'), zCrisp = $('#zcrisp'), zSpot = $('#zspot');

function pageUnder(x, y) {
  for (const el of document.elementsFromPoint(x, y)) {
    const p = el.closest?.('#book .page');
    if (p && !p.classList.contains('blank')) return p;
  }
  const vis = visibleIndices().filter((i) => !R.entries[i]?.blank);
  return pageEl(vis[0]);
}

function zApply(anim) {
  zPage.classList.toggle('anim', !!anim);
  zPage.style.transform = `translate(${Z.x}px,${Z.y}px) scale(${Z.s})`;
  placeSpot(anim);
}
function zClamp() {
  const vw = innerWidth, vh = innerHeight;
  const W = Z.w * Z.s, H = Z.h * Z.s;
  Z.x = W <= vw ? (vw - W) / 2 : Math.min(0, Math.max(vw - W, Z.x));
  Z.y = H <= vh ? (vh - H) / 2 : Math.min(0, Math.max(vh - H, Z.y));
}
function zZoomAt(cx, cy, newS) {
  newS = Math.max(0.6, Math.min(newS, 8));
  Z.x = cx - ((cx - Z.x) / Z.s) * newS;
  Z.y = cy - ((cy - Z.y) / Z.s) * newS;
  Z.s = newS;
}

function placeSpot(anim) {
  const it = Z.mode === 'bubble' && !Z.spotOff ? Z.seq[Z.pos] : null;
  const b = it && (entryBoxes(it.i) || [])[it.k];
  if (!b) { zSpot.classList.remove('on'); return; }
  const pad = 10;
  zSpot.classList.toggle('anim', !!anim);
  zSpot.style.transform = `translate(${Z.x + b[0] * Z.w * Z.s - pad}px,${Z.y + b[1] * Z.h * Z.s - pad}px)`;
  zSpot.style.width = (b[2] - b[0]) * Z.w * Z.s + pad * 2 + 'px';
  zSpot.style.height = (b[3] - b[1]) * Z.h * Z.s + pad * 2 + 'px';
  zSpot.classList.add('on');
  $('#zcount').textContent = `${Z.pos + 1} / ${Z.seq.length}`;
}

async function hiresFor(idx) {
  if (Z.hires.has(idx)) return Z.hires.get(idx);
  const H = Math.min(5200, Math.round(innerHeight * Math.min(devicePixelRatio || 1, 2.5) * 2.6));
  const url = await renderEntry(idx, H);
  Z.hires.set(idx, url);
  while (Z.hires.size > 3) { const [k, u] = Z.hires.entries().next().value; URL.revokeObjectURL(u); Z.hires.delete(k); }
  return url;
}

// coloca a imagem da página idx exatamente sobre a página no livro
function zLoadPage(idx) {
  const el = pageEl(idx);
  const r = el.getBoundingClientRect();
  Z.idx = idx; Z.rect = r; Z.w = r.width; Z.h = r.height;
  zPage.style.width = r.width + 'px'; zPage.style.height = r.height + 'px';
  zCrisp.classList.remove('on');
  zImg.src = Z.hires.get(idx) || el.querySelector('img')?.src || '';
  hiresFor(idx).then((url) => { if (Z.open && Z.idx === idx && zImg.src !== url) zImg.src = url; }).catch(() => {});
  return r;
}

function zShowOverlay() {
  zEl.classList.remove('hidden');
  zEl.classList.toggle('bubble', Z.mode === 'bubble');
  showChrome(false);
  requestAnimationFrame(() => zEl.classList.add('show'));
}

async function openZoom(x, y, opts = {}) {
  if (Z.open || !R.pf) return;
  const el = pageUnder(x, y);
  if (!el) return;
  Z.open = true; Z.mode = 'free'; Z.spotOff = true;
  const r = zLoadPage(+el.dataset.i);
  Z.s = 1; Z.x = r.left; Z.y = r.top;
  zApply(false);
  zShowOverlay();
  if (opts.pinch) {
    for (const [id, p] of opts.pinch) Z.pointers.set(id, p);
    startGesture();
  }
  requestAnimationFrame(() => {
    if (!opts.fromPinch) { zZoomAt(x, y, 2.4); zClamp(); zApply(true); }
  });
}

function openBubble(i, k) {
  if (Z.open || !R.pf) return;
  Z.seq = bubbleSeq();
  Z.pos = Math.max(0, Z.seq.findIndex((q) => q.i === i && q.k === k));
  if (!Z.seq.length) return;
  Z.open = true; Z.mode = 'bubble'; Z.spotOff = false;
  const r = zLoadPage(Z.seq[Z.pos].i);
  Z.s = 1; Z.x = r.left; Z.y = r.top;
  zApply(false);
  zShowOverlay();
  requestAnimationFrame(() => requestAnimationFrame(() => focusBubble(true)));
}

function focusBubble(anim) {
  const it = Z.seq[Z.pos];
  const b = (entryBoxes(it.i) || [])[it.k];
  if (!b) return;
  const vw = innerWidth, vh = innerHeight;
  const bw = (b[2] - b[0]) * Z.w, bh = (b[3] - b[1]) * Z.h;
  let s = Math.min((vw * 0.74) / bw, (vh * 0.56) / bh, 4.2);
  s = Math.max(s, 1);
  Z.s = s;
  Z.x = vw / 2 - (b[0] * Z.w + bw / 2) * s;
  Z.y = vh / 2 - (b[1] * Z.h + bh / 2) * s;
  Z.spotOff = false;
  zApply(anim);
  crispBubble(it, b, bw * s * Math.min(devicePixelRatio || 1, 3));
}

// renderiza só o recorte do balão na resolução exata da tela → texto nítido em qualquer zoom
let crispSeq = 0;
async function crispBubble(it, b, pxW) {
  const my = ++crispSeq;
  zCrisp.classList.remove('on');
  try {
    const e = R.entries[it.i];
    const page = await R.doc.getPage(e.p);
    const vp0 = page.getViewport({ scale: 1 });
    const entryW = e.half ? vp0.width / 2 : vp0.width;
    const offX = e.half === 'R' ? vp0.width / 2 : 0;
    let w = Math.min(2600, Math.max(64, Math.round(pxW)));
    let scale = w / ((b[2] - b[0]) * entryW);
    let h = Math.round((b[3] - b[1]) * vp0.height * scale);
    const k = fitArea(w, h);
    if (k < 1) { w = Math.round(w * k); h = Math.round(h * k); scale *= k; }
    const vp = page.getViewport({ scale });
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    await page.render({ canvas: cv, viewport: vp, transform: [1, 0, 0, 1, -(offX + b[0] * entryW) * scale, -(b[1] * vp0.height) * scale] }).promise;
    const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.92));
    cv.width = cv.height = 0;
    if (my !== crispSeq || !Z.open || Z.seq[Z.pos] !== it) return;
    if (zCrisp.src.startsWith('blob:')) URL.revokeObjectURL(zCrisp.src);
    zCrisp.style.left = b[0] * 100 + '%'; zCrisp.style.top = b[1] * 100 + '%';
    zCrisp.style.width = (b[2] - b[0]) * 100 + '%'; zCrisp.style.height = (b[3] - b[1]) * 100 + '%';
    zCrisp.onload = () => { if (my === crispSeq) zCrisp.classList.add('on'); };
    zCrisp.src = URL.createObjectURL(blob);
  } catch (err) { console.warn('recorte', err); }
}

function bubbleStep(dir) {
  if (Z.mode !== 'bubble') return;
  const np = Z.pos + dir;
  if (np < 0 || np >= Z.seq.length) {
    // acabou a página (ou o início): vira e continua no próximo par de páginas
    B.guided = dir > 0 ? 'first' : 'last';
    B.guidedAt = performance.now();
    const atEnd = dir > 0 ? R.cur >= R.entries.length - 1 || visibleIndices().includes(R.entries.length - 1) : R.cur === 0;
    if (atEnd) { B.guided = null; toast(dir > 0 ? 'Fim da HQ' : 'Início da HQ'); return; }
    closeZoom('fast', () => (dir > 0 ? next(true) : prev(true)));
    return;
  }
  const prevIdx = Z.seq[Z.pos].i;
  Z.pos = np;
  const it = Z.seq[np];
  if (it.i !== prevIdx) {
    // troca de página dentro do par: fade rápido
    zPage.classList.add('fade');
    setTimeout(() => {
      zLoadPage(it.i);
      focusBubble(false);
      requestAnimationFrame(() => zPage.classList.remove('fade'));
    }, 140);
  } else focusBubble(true);
}

function continueGuided() {
  const want = B.guided;
  if (!want || !R.pf) return;
  if (R.pf.getState() !== 'read') return setTimeout(continueGuided, 120);
  const ready = visibleIndices().every((i) => R.entries[i]?.blank || entryBoxes(i));
  if (!ready) {
    // espera a IA terminar estas páginas (com prioridade)
    B.queueDirty = true; kickDetection();
    B.waiting = () => { B.waiting = null; continueGuided(); };
    clearTimeout(B.waitT);
    B.waitT = setTimeout(() => { if (B.waiting) { B.waiting = null; B.guided = null; toast('A IA ainda está lendo esta página'); } }, 8000);
    return;
  }
  B.guided = null;
  const seq = bubbleSeq();
  if (!seq.length) { toast('Sem balões aqui — toque na borda para seguir', 2200); return; }
  const it = want === 'last' ? seq.at(-1) : seq[0];
  openBubble(it.i, it.k);
}

function closeZoom(instant, after) {
  if (!Z.open) { after?.(); return; }
  Z.open = false;
  Z.pointers.clear(); Z.gesture = null;
  const done = () => {
    zEl.classList.add('hidden'); zEl.classList.remove('show', 'bubble');
    zImg.removeAttribute('src');
    zCrisp.classList.remove('on');
    zSpot.classList.remove('on');
    after?.();
  };
  if (instant === true) return done();
  if (instant === 'fast') { zEl.classList.remove('show'); zPage.classList.add('fade'); setTimeout(() => { zPage.classList.remove('fade'); done(); }, 150); return; }
  Z.spotOff = true;
  const r = Z.rect;
  Z.s = 1; Z.x = r.left; Z.y = r.top;
  zApply(true);
  zEl.classList.remove('show');
  setTimeout(done, 300);
}

function startGesture() {
  const pts = [...Z.pointers.values()];
  if (pts.length >= 2) {
    const [a, b] = pts;
    Z.gesture = { type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, s0: Z.s, x0: Z.x, y0: Z.y, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  } else if (pts.length === 1) {
    Z.gesture = { type: 'pan', px: pts[0].x, py: pts[0].y, x0: Z.x, y0: Z.y, moved: false, t: performance.now() };
  } else Z.gesture = null;
}

zEl.addEventListener('pointerdown', (e) => {
  if (e.target.closest('#zclose, #zbar')) return;
  zEl.setPointerCapture?.(e.pointerId);
  Z.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  startGesture();
});
addEventListener('pointermove', (e) => {
  if (!Z.open || !Z.pointers.has(e.pointerId)) return;
  Z.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const g = Z.gesture; if (!g) return;
  if (g.type === 'pinch') {
    const [a, b] = [...Z.pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    const s = Math.max(0.6, Math.min(g.s0 * (d / g.d0), 8));
    Z.x = cx - ((g.cx - g.x0) / g.s0) * s;
    Z.y = cy - ((g.cy - g.y0) / g.s0) * s;
    Z.s = s; Z.spotOff = true; zCrisp.classList.remove('on');
    zApply(false);
  } else {
    const dx = e.clientX - g.px, dy = e.clientY - g.py;
    if (Math.hypot(dx, dy) > 6) g.moved = true;
    if (Z.mode === 'bubble' && !Z.spotOff && Math.abs(dx) > Math.abs(dy)) return; // swipe horizontal = troca de balão
    if (g.moved) Z.spotOff = true;
    Z.x = g.x0 + dx; Z.y = g.y0 + dy;
    if (Z.mode === 'free') zClamp();
    zApply(false);
  }
});
const zUp = (e) => {
  if (!Z.pointers.has(e.pointerId)) return;
  const g = Z.gesture;
  Z.pointers.delete(e.pointerId);
  if (g?.type === 'pan') {
    const dx = e.clientX - g.px, dy = e.clientY - g.py, dt = performance.now() - g.t;
    if (Z.mode === 'bubble') {
      if (!g.moved && dt < 400) {
        const w = innerWidth;
        if (e.clientX > w * 0.62) bubbleStep(1);
        else if (e.clientX < w * 0.38) bubbleStep(-1);
        else closeZoom();
        startGesture(); return;
      }
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3 && !Z.spotOff) {
        bubbleStep(dx < 0 ? 1 : -1); startGesture(); return;
      }
    } else if (!g.moved && dt < 350) {
      const now = performance.now();
      if (now - Z.lastTap < 320) { Z.lastTap = 0; return closeZoom(); }
      Z.lastTap = now;
    }
  }
  if (Z.pointers.size === 0 && Z.open) {
    if (Z.s < 0.95) return closeZoom();
    if (Z.mode === 'free') { zClamp(); zApply(true); }
  }
  startGesture();
};
addEventListener('pointerup', zUp);
addEventListener('pointercancel', zUp);
zEl.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (Z.mode === 'bubble' && !e.ctrlKey) {
    const now = performance.now();
    if (now < wheelLock) return;
    wheelLock = now + 350;
    return bubbleStep(e.deltaY > 0 ? 1 : -1);
  }
  Z.spotOff = true;
  zZoomAt(e.clientX, e.clientY, Z.s * Math.exp(-e.deltaY * 0.0022));
  if (Z.s < 0.9) return closeZoom();
  if (Z.mode === 'free') zClamp();
  zApply(false);
}, { passive: false });
$('#zclose').onclick = () => closeZoom();
for (const [id, d] of [['#zprev', -1], ['#znext', 1]]) {
  const b = $(id);
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  b.onclick = (e) => { e.stopPropagation(); bubbleStep(d); };
}

$('#btnBubbles').onclick = () => {
  B.on = !B.on;
  try { localStorage.setItem('quadro.bubbles', B.on ? '1' : '0'); } catch {}
  document.body.classList.toggle('bubbles-off', !B.on);
  toast(B.on ? 'Zoom em balão ligado — toque num balão' : 'Zoom em balão desligado');
  updateDetChip();
  if (B.on) { kickDetection(); pulseBubbles(); }
};
$('#btnGuide').onclick = () => {
  if (!B.on) return;
  B.guided = 'first';
  continueGuided();
};
document.body.classList.toggle('bubbles-off', !B.on);

/* ======================= Inicialização ======================= */
$('#btnAdd').onclick = () => $('#fileIn').click();
$('#fileIn').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
const canFolder = 'showDirectoryPicker' in window && !inIframe;
$('#btnFolder').classList.toggle('hidden', !canFolder);
$('#emptyFolderHint').classList.toggle('hidden', !canFolder && !inIframe);
$('#btnFolder').onclick = pickFolder;

addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('drag'); });
addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('drag'); });
addEventListener('drop', (e) => {
  e.preventDefault(); document.body.classList.remove('drag');
  if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files, { open: e.dataTransfer.files.length === 1 });
});

// Abrir PDFs pelo Windows ("Abrir com > Quadro") quando instalado como app
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async (params) => {
    if (!params.files?.length) return;
    const files = await Promise.all(params.files.map((h) => h.getFile()));
    addFiles(files, { open: files.length === 1 });
  });
}

if ('serviceWorker' in navigator && !inIframe && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

refreshLibrary().then(() => { queueCovers(); restoreFolder(); });

// para testes automáticos
window.__quadro = { R, Z, B, store, openComic, addFiles, entryBoxes, bubbleSeq };
