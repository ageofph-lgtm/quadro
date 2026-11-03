// Worker de detecção de balões/textos (comic-text-detector, YOLOv5, int8)
import * as ort from 'onnxruntime-web/wasm';

const S = 1024;
let session = null;
let loading = null;

async function load(base) {
  if (session) return session;
  if (!loading) {
    loading = (async () => {
      ort.env.wasm.wasmPaths = { wasm: new URL('lib/ort/ort-wasm-simd-threaded.wasm', base).href };
      ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
      const res = await fetch(new URL('models/ctd-int8.onnx', base).href);
      if (!res.ok) throw new Error('modelo não encontrado (' + res.status + ')');
      const buf = new Uint8Array(await res.arrayBuffer());
      session = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      return session;
    })();
  }
  return loading;
}

function nms(boxes, th) {
  boxes.sort((a, b) => b.s - a.s);
  const keep = [];
  for (const b of boxes) {
    if (keep.every((k) => iou(k, b) < th)) keep.push(b);
  }
  return keep;
}
function iou(a, b) {
  const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const inter = ix * iy;
  return inter / ((a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - inter);
}

// Expande o bloco de texto até a borda do balão (preenchimento de pixels claros).
function expandToBubble(lum, w, h, b) {
  const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
  const ex = Math.max(bw, bh) * 2.2 + 12, ey = Math.max(bh * 1.6, Math.min(bw, bh * 3)) + 12;
  const lim = { x0: Math.max(0, Math.floor(b.x0 - ex)), y0: Math.max(0, Math.floor(b.y0 - ey)), x1: Math.min(w - 1, Math.ceil(b.x1 + ex)), y1: Math.min(h - 1, Math.ceil(b.y1 + ey)) };
  const LW = lim.x1 - lim.x0 + 1, LH = lim.y1 - lim.y0 + 1;
  const seen = new Uint8Array(LW * LH);
  const stack = [];
  const light = (x, y) => lum[y * w + x] > 190;
  // sementes: pixels claros dentro do bloco
  for (let y = Math.floor(b.y0); y <= Math.min(h - 1, Math.ceil(b.y1)); y += 2)
    for (let x = Math.floor(b.x0); x <= Math.min(w - 1, Math.ceil(b.x1)); x += 2)
      if (x >= 0 && y >= 0 && light(x, y)) { const k = (y - lim.y0) * LW + (x - lim.x0); if (!seen[k]) { seen[k] = 1; stack.push(x, y); } }
  if (!stack.length) return null;
  let mx0 = w, my0 = h, mx1 = 0, my1 = 0, leaked = false, count = 0;
  while (stack.length) {
    const y = stack.pop(), x = stack.pop();
    count++;
    if (x < mx0) mx0 = x; if (x > mx1) mx1 = x; if (y < my0) my0 = y; if (y > my1) my1 = y;
    if (x <= lim.x0 || x >= lim.x1 || y <= lim.y0 || y >= lim.y1) { leaked = true; break; }
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      const k = (ny - lim.y0) * LW + (nx - lim.x0);
      if (!seen[k] && light(nx, ny)) { seen[k] = 1; stack.push(nx, ny); }
    }
  }
  if (leaked || count < 30) return null;
  return { x0: Math.min(mx0, b.x0) - 3, y0: Math.min(my0, b.y0) - 3, x1: Math.max(mx1, b.x1) + 3, y1: Math.max(my1, b.y1) + 3 };
}

// Ordem de leitura ocidental: linhas de cima para baixo, esquerda para direita em cada linha.
function readingOrder(boxes, rtl) {
  const sorted = [...boxes].sort((a, b) => a.y0 - b.y0);
  const rows = [];
  for (const b of sorted) {
    const h = b.y1 - b.y0;
    const row = rows.find((r) => {
      const ov = Math.min(r.y1, b.y1) - Math.max(r.y0, b.y0);
      return ov > Math.min(h, r.y1 - r.y0) * 0.45;
    });
    if (row) { row.items.push(b); row.y0 = Math.min(row.y0, b.y0); row.y1 = Math.max(row.y1, b.y1); }
    else rows.push({ y0: b.y0, y1: b.y1, items: [b] });
  }
  rows.sort((a, b) => a.y0 - b.y0);
  return rows.flatMap((r) => r.items.sort((a, b) => (rtl ? b.x0 - a.x0 : a.x0 - b.x0)));
}

async function detect({ base, data, width: w, height: h, conf = 0.4, rtl = false }) {
  const sess = await load(base);
  // letterbox 1024x1024 (imagem já vem com lado maior = 1024)
  const t = new Float32Array(3 * S * S).fill(114 / 255);
  const lum = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, o = y * S + x;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      t[o] = r / 255; t[S * S + o] = g / 255; t[2 * S * S + o] = b / 255;
      lum[y * w + x] = (r * 77 + g * 150 + b * 29) >> 8;
    }
  }
  const t0 = performance.now();
  const out = await sess.run({ images: new ort.Tensor('float32', t, [1, 3, S, S]) });
  const ms = performance.now() - t0;
  const blk = out.blk.data; // [N,7]: cx,cy,w,h,obj,cls0,cls1
  const n = blk.length / 7;
  let cand = [];
  for (let i = 0; i < n; i++) {
    const o = i * 7;
    const s = blk[o + 4] * Math.max(blk[o + 5], blk[o + 6]);
    if (s < conf) continue;
    const cx = blk[o], cy = blk[o + 1], bw = blk[o + 2], bh = blk[o + 3];
    cand.push({ x0: cx - bw / 2, y0: cy - bh / 2, x1: cx + bw / 2, y1: cy + bh / 2, s });
  }
  cand = nms(cand, 0.35).filter((b) => b.x0 < w && b.y0 < h);
  // texto → balão inteiro; funde blocos que caem no mesmo balão
  let boxes = cand.map((b) => {
    const e = expandToBubble(lum, w, h, b);
    const pad = Math.max(8, (b.y1 - b.y0) * 0.18);
    return e ? { ...e, s: b.s, bubble: true } : { x0: b.x0 - pad, y0: b.y0 - pad, x1: b.x1 + pad, y1: b.y1 + pad, s: b.s, bubble: false };
  });
  const merged = [];
  for (const b of boxes.sort((a, c) => c.s - a.s)) {
    const m = merged.find((k) => iou(k, b) > 0.5 || (contains(k, b)));
    if (m) { m.x0 = Math.min(m.x0, b.x0); m.y0 = Math.min(m.y0, b.y0); m.x1 = Math.max(m.x1, b.x1); m.y1 = Math.max(m.y1, b.y1); }
    else merged.push({ ...b });
  }
  const ordered = readingOrder(merged, rtl).map((b) => [
    clamp(b.x0 / w), clamp(b.y0 / h), clamp(b.x1 / w), clamp(b.y1 / h), +b.s.toFixed(2), b.bubble ? 1 : 0,
  ]);
  return { boxes: ordered, ms };
}
const clamp = (v) => Math.max(0, Math.min(1, +v.toFixed(4)));
const contains = (a, b) => b.x0 >= a.x0 - 2 && b.y0 >= a.y0 - 2 && b.x1 <= a.x1 + 2 && b.y1 <= a.y1 + 2;

self.onmessage = async (e) => {
  const { id, type } = e.data;
  try {
    if (type === 'load') { await load(e.data.base); self.postMessage({ id, ok: true }); return; }
    const r = await detect(e.data);
    self.postMessage({ id, ok: true, ...r });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message || err) });
  }
};
