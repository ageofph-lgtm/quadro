// Teste de ponta a ponta (Playwright). Antes: npm run build && npm run sample && npm run serve (em outro terminal).
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1368, height: 912 }, hasTouch: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERR: ' + e.message));
  p.on('console', m => { if (['error','warning'].includes(m.type())) errs.push(m.type()+': '+m.text()); });
  await p.goto('http://localhost:8765/');
  await p.setInputFiles('#fileIn', 'tests/amostra.pdf');
  await p.waitForSelector('.comic img.on');
  await p.click('#all .comic');
  await p.waitForSelector('#book .page img.on');
  await p.waitForFunction(() => __quadro.B.pages.size >= __quadro.R.doc.numPages, null, { timeout: 120000 });
  const st = () => p.evaluate(() => { const q=__quadro; return `cur=${q.R.cur} open=${q.Z.open} mode=${q.Z.mode} pos=${q.Z.pos}/${q.Z.seq.length} idx=${q.Z.idx} guided=${q.B.guided}`; });
  // começar guiado pelo botão
  await p.touchscreen.tap(684, 450); await p.waitForTimeout(500);
  await p.click('#btnGuide'); await p.waitForTimeout(800);
  console.log('start', await st());
  await p.screenshot({ path: 'tests/shots/30-g0.png' });
  for (let i = 1; i <= 22; i++) {
    await p.keyboard.press('ArrowRight'); await p.waitForTimeout(900);
    const s = await st(); console.log(i, s);
    if ([2, 5, 9, 14].includes(i)) await p.screenshot({ path: `tests/shots/31-g${i}.png` });
  }
  await p.touchscreen.tap(684, 300); await p.waitForTimeout(700);
  console.log('after center tap', await st());
  console.log(errs.join('\n') || 'no errors');
  await b.close();
})();
