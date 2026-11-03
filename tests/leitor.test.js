// Teste de ponta a ponta (Playwright). Antes: npm run build && npm run sample && npm run serve (em outro terminal).
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1368, height: 912 }, deviceScaleFactor: 1, hasTouch: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('console', m => { if (['error','warning'].includes(m.type())) errs.push(m.type()+': '+m.text()); });
  p.on('pageerror', e => errs.push('PAGEERR: ' + e.message));
  await p.goto('http://localhost:8765/');
  await p.screenshot({ path: 'tests/shots/00-empty.png' });
  await p.setInputFiles('#fileIn', 'tests/amostra.pdf');
  await p.waitForSelector('.comic img.on', { timeout: 20000 });
  await p.screenshot({ path: 'tests/shots/01-lib.png' });
  await p.click('#all .comic');
  await p.waitForSelector('#book .page img.on', { timeout: 20000 });
  await p.waitForTimeout(800);
  await p.screenshot({ path: 'tests/shots/02-cover.png' });
  console.log('orient', await p.evaluate(() => __quadro.R.pf.getOrientation()), 'entries', await p.evaluate(() => JSON.stringify(__quadro.R.entries)));
  // tap right edge
  await p.touchscreen.tap(1300, 450);
  await p.waitForTimeout(250);
  await p.screenshot({ path: 'tests/shots/03-midflip.png' });
  await p.waitForTimeout(900);
  await p.screenshot({ path: 'tests/shots/04-spread1.png' });
  console.log('cur', await p.evaluate(() => __quadro.R.cur), await p.textContent('#pnum'));
  for (let i=0;i<2;i++){ await p.keyboard.press('ArrowRight'); await p.waitForTimeout(1000); }
  await p.waitForTimeout(800);
  await p.screenshot({ path: 'tests/shots/05-widespread.png' });
  console.log('cur', await p.evaluate(() => __quadro.R.cur), await p.textContent('#pnum'));
  // center tap -> chrome
  await p.touchscreen.tap(684, 450);
  await p.waitForTimeout(600);
  await p.screenshot({ path: 'tests/shots/06-chrome.png' });
  // double tap -> zoom
  await p.touchscreen.tap(500, 300); await p.waitForTimeout(80); await p.touchscreen.tap(500, 300);
  await p.waitForTimeout(1500);
  await p.screenshot({ path: 'tests/shots/07-zoom.png' });
  console.log('zoom', await p.evaluate(() => ({open: __quadro.Z.open, s: __quadro.Z.s})));
  await p.click('#zclose'); await p.waitForTimeout(500);
  // portrait
  await p.setViewportSize({ width: 912, height: 1368 });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: 'tests/shots/08-portrait.png' });
  console.log('orient', await p.evaluate(() => __quadro.R.pf.getOrientation()), await p.textContent('#pnum'));
  await p.click('#btnBack').catch(()=>{});
  await p.evaluate(() => document.querySelector('#btnBack').click());
  await p.waitForTimeout(800);
  await p.screenshot({ path: 'tests/shots/09-lib-after.png' });
  console.log(errs.join('\n') || 'no errors');
  await b.close();
})();
