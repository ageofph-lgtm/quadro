// Teste de ponta a ponta no celular (Playwright), simulando navegador sem as APIs JS mais novas.
// Antes: npm run build && npm run sample && npm run serve (em outro terminal).
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => { for (const [o, k] of [[Map.prototype, 'getOrInsert'], [Map.prototype, 'getOrInsertComputed'], [Math, 'sumPrecise'], [Promise, 'try'], [Uint8Array.prototype, 'toHex'], [Uint8Array.prototype, 'toBase64'], [Uint8Array, 'fromBase64'], [Promise, 'withResolvers']]) { try { delete o[k]; } catch {} } });
  // remove as mesmas APIs também DENTRO dos workers (pdf.js e IA), como num celular de verdade
  const KILL = 'for (const [o,k] of [[Map.prototype,"getOrInsert"],[Map.prototype,"getOrInsertComputed"],[WeakMap.prototype,"getOrInsert"],[WeakMap.prototype,"getOrInsertComputed"],[Math,"sumPrecise"],[Promise,"try"],[Uint8Array.prototype,"toHex"],[Uint8Array.prototype,"toBase64"],[Uint8Array,"fromBase64"],[Uint8Array,"fromHex"],[Promise,"withResolvers"]]) { try { delete o[k]; } catch {} }\n';
  await ctx.route(/(lib\/polyfills\.js|detector\.js)/, async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, body: KILL + (await res.text()), headers: { ...res.headers(), 'content-type': 'text/javascript' } });
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERR: ' + e.message));
  p.on('console', m => { if (['error','warning'].includes(m.type())) errs.push(m.text()); });
  const fit = () => p.evaluate(() => { const r = document.querySelector(`#book .page[data-i="${__quadro.R.cur}"]`).getBoundingClientRect(); return `orient=${__quadro.R.pf.getOrientation()} page=[${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}x${Math.round(r.height)}] tela=${innerWidth}x${innerHeight} cabe=${r.left>=0 && r.right<=innerWidth+1 && r.top>=0 && r.bottom<=innerHeight+1}`; });
  await p.goto('http://localhost:8765/');
  await p.screenshot({ path: 'tests/shots/ph-0-lib-empty.png' });
  await p.setInputFiles('#fileIn', 'tests/amostra.pdf');
  await p.waitForSelector('.comic img.on');
  await p.screenshot({ path: 'tests/shots/ph-1-lib.png' });
  await p.click('#all .comic');
  await p.waitForSelector('#book .page img.on'); await p.waitForTimeout(800);
  console.log('retrato:', await fit());
  await p.touchscreen.tap(375, 430); await p.waitForTimeout(1300);
  console.log('após toque:', await p.textContent('#pnum'), await fit());
  await p.screenshot({ path: 'tests/shots/ph-2-portrait.png' });
  await p.waitForFunction(() => __quadro.B.pages.size >= 3, null, { timeout: 90000 });
  const pt = await p.evaluate(() => { const it = __quadro.bubbleSeq()[0]; const r = document.querySelector(`#book .page[data-i="${it.i}"]`).getBoundingClientRect(); const bx = __quadro.entryBoxes(it.i)[it.k]; return { x: r.left + (bx[0]+bx[2])/2*r.width, y: r.top + (bx[1]+bx[3])/2*r.height }; });
  await p.touchscreen.tap(pt.x, pt.y); await p.waitForTimeout(1500);
  console.log('zoom balão:', await p.evaluate(() => [__quadro.Z.open, __quadro.Z.mode, __quadro.Z.pos + '/' + __quadro.Z.seq.length].join(' ')));
  await p.screenshot({ path: 'tests/shots/ph-3-bubble.png' });
  await p.touchscreen.tap(370, 420); await p.waitForTimeout(800);
  console.log('próximo balão:', await p.evaluate(() => __quadro.Z.pos));
  await p.touchscreen.tap(196, 420); await p.waitForTimeout(800);
  console.log('fechou:', await p.evaluate(() => !__quadro.Z.open));
  await p.setViewportSize({ width: 852, height: 393 }); await p.waitForTimeout(1500);
  console.log('paisagem:', await fit());
  await p.screenshot({ path: 'tests/shots/ph-4-landscape.png' });
  await p.setViewportSize({ width: 393, height: 852 }); await p.waitForTimeout(1500);
  console.log('volta retrato:', await fit());
  console.log(errs.join('\n') || 'sem erros');
  await b.close();
})();
