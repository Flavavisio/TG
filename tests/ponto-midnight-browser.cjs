const fs = require('node:fs'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const src = fs.readFileSync('app-principal.js', 'utf8');
const fn = name => src.match(new RegExp('        (?:async )?function ' + name + '\\([^]*?\\n        \\}'))[0];
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_BINARY, args: ['--no-sandbox'] });
  try {
    for (const width of [390, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="underlying">Obra</div>');
      await page.addStyleTag({ content: fs.readFileSync('styles.css', 'utf8') });
      await page.addStyleTag({ content: fs.readFileSync('tg-form-focus.css', 'utf8') });
      await page.addScriptTag({ content: `const getDataHoje = () => '2026-10-24'; const escapeHtmlSimples = x => x;\n${fn('_intervalosSaidaObra')}\n${fn('_pedirSaidaObraAnterior')}` });
      await page.evaluate(() => { window.answer = 'pending'; _pedirSaidaObraAnterior({ data: '2026-10-23', entrada: '08:00' }).then(x => window.answer = x); });
      const dialog = page.getByRole('dialog');
      await dialog.waitFor({ state: 'visible' });
      const rect = await dialog.boundingBox();
      assert(rect.x >= 0 && rect.x + rect.width <= width + 1);
      await page.locator('#saidaAnteriorMomento').fill('2026-10-23T17:00');
      await page.getByRole('button', { name: 'Confirmar saída', exact: true }).click();
      await page.waitForFunction(() => window.answer !== 'pending');
      assert.deepEqual(await page.evaluate(() => window.answer), { data: '2026-10-23', hora: '17:00' });
      assert.equal(await page.getByRole('dialog').count(), 0);
      await page.evaluate(() => { window.answer = 'pending'; _pedirSaidaObraAnterior({ data: '2026-10-23', entrada: '08:00' }).then(x => window.answer = x); });
      await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
      assert.equal(await page.evaluate(() => window.answer), null);
      await page.close();
    }
    console.log('Mobile and desktop recovery dialogs: confirm, cancel, no horizontal overflow passed.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
