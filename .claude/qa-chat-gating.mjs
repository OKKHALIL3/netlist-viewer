// Deployed-site gating check: the chat FAB must NOT render on the public
// site (VITE_VIEWERS=schematic) and MUST render on /preview/ (all).
// Run: node .claude/qa-chat-gating.mjs
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CDL = '/Users/omarkhalil/Downloads/Abstract_Layout_Viewer_Handoff/sample_cdl/CLKGEN_icnet.cdl';

let failures = 0;
const expect = (cond, m) => console.log(cond ? `  ✅ ${m}` : (failures++, `  ❌ ${m}`));

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-first-run'], defaultViewport: { width: 1440, height: 900 },
});

async function fabAfterLoad(url) {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle2' });
  const input = await page.waitForSelector('input[type="file"][accept*="cdl"]', { timeout: 15000 });
  await input.uploadFile(CDL);
  // Guided landing: the full build offers a DSPF stage (skip it); the
  // schematic-only public build leaves the landing on its own after parse.
  const t0 = Date.now();
  for (;;) {
    if (await page.$('.topbar')) break;
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent?.includes('Skip — open schematic viewer'));
      if (b) b.click();
    });
    if (Date.now() - t0 > 120000) throw new Error(`viewer never mounted at ${url}`);
    await new Promise(r => setTimeout(r, 400));
  }
  await new Promise(r => setTimeout(r, 500));
  const fab = await page.$('.chat-fab');
  await page.close();
  return fab !== null;
}

expect(!(await fabAfterLoad('https://okkhalil3.github.io/netlist-viewer/')), 'public site: chat FAB absent');
expect(await fabAfterLoad('https://okkhalil3.github.io/netlist-viewer/preview/'), 'preview site: chat FAB present');

await browser.close();
console.log(failures === 0 ? '\nGATING VERIFIED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
