// Browser QA for Circuit Chat v1 (parser mode — no API key):
//   A. load CLKGEN CDL + xact DSPF, open the chat drawer
//   B. "rank blocks" → result table + basic-parser notice
//   C. "coupling above 1 ff" → find_nets table over real coupling pairs
//   D. "rank nets by coupling" → net table
//   E. click a rank-blocks table row → hybrid viewer opens on that block
//   F. help fallback for unknown phrasing
// Run: node .claude/qa-chat.mjs   (vite dev server must be up; APP_URL to override)
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const APP = process.env.APP_URL ?? 'http://localhost:5173/netlist-viewer/';
const CDL = '/Users/omarkhalil/Downloads/Abstract_Layout_Viewer_Handoff/sample_cdl/CLKGEN_icnet.cdl';
const DSPF = '/Users/omarkhalil/Downloads/Abstract_Layout_Viewer_Handoff/sample_dspf/CLKGEN_xact.dspf';
const SHOTS = process.env.SHOTS_DIR ?? '.claude/qa-shots';
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const fail = (m) => { console.log(`  ❌ ${m}`); failures++; };
const expect = (cond, m) => (cond ? ok(m) : fail(m));

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-first-run', '--window-size=1680,1050'],
  defaultViewport: { width: 1680, height: 1000 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => fail(`page error: ${e.message}`));

await page.goto(APP, { waitUntil: 'networkidle2' });
// Parser mode must be keyless — clear any stored key before the app reads it.
await page.evaluate(() => localStorage.removeItem('cdl-viewer:anthropic-api-key'));

// Click a landing button by its visible text (guided load flow, 2026-07-12).
const clickByText = (text) => page.evaluate((t) => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(t));
  if (btn) btn.click();
  return !!btn;
}, text);
const waitForText = async (text, timeout = 120000) => {
  const t0 = Date.now();
  for (;;) {
    const found = await page.evaluate((t) => document.body.textContent?.includes(t) ?? false, text);
    if (found) return true;
    if (Date.now() - t0 > timeout) { fail(`timeout waiting for text "${text}"`); return false; }
    await new Promise((r) => setTimeout(r, 300));
  }
};

console.log('— A: load design + DSPF via the guided landing, open chat —');
const fileInput = await page.waitForSelector('input[type="file"][accept*="cdl"]', { timeout: 15000 });
await fileInput.uploadFile(CDL);
await waitForText('Browse for DSPF');
ok('CDL parsed (landing offers the DSPF stage)');
const dspfInput = await page.$('input[type="file"][accept*="dspf"]');
if (dspfInput) {
  await dspfInput.uploadFile(DSPF);
  await waitForText('Open hybrid viewer');
  ok('DSPF loaded');
  expect(await clickByText('Open hybrid viewer'), 'opened hybrid viewer from landing');
} else {
  fail('no DSPF input found');
  await clickByText('Skip — open schematic viewer');
}
await page.waitForSelector('button[title^="Hybrid"], .topbar', { timeout: 60000 });
ok('viewer shell up');

await page.click('.chat-fab');
await page.waitForSelector('.chat-drawer', { timeout: 5000 });
ok('chat drawer opened');

const msgCount = () => page.$$eval('.chat-msg.assistant', (els) => els.length);
async function sendChat(text) {
  const before = await msgCount();
  await page.type('.chat-input', text);
  await page.keyboard.press('Enter');
  const t0 = Date.now();
  for (;;) {
    if ((await msgCount()) > before) break;
    if (Date.now() - t0 > 20000) { fail(`timeout waiting for reply to "${text}"`); break; }
    await new Promise((r) => setTimeout(r, 150));
  }
  return page.$$eval('.chat-msg.assistant', (els) => {
    const el = els[els.length - 1];
    return {
      text: el.querySelector('.chat-msg-text')?.textContent ?? '',
      notice: el.querySelector('.chat-notice')?.textContent ?? null,
      tableRows: el.querySelectorAll('.chat-table tbody tr').length,
      chips: el.querySelectorAll('.chat-chip').length,
      error: el.classList.contains('error'),
    };
  });
}

console.log('— B: rank blocks (parser mode) —');
const rank = await sendChat('rank blocks');
expect(rank.notice?.includes('basic parser mode'), 'no-key notice shown once');
expect(rank.tableRows > 0, `rank table has rows (${rank.tableRows})`);
expect(!rank.error, 'rank turn is not an error');

console.log('— C: coupling above 1 ff —');
const coup = await sendChat('coupling above 1 ff');
expect(coup.tableRows > 0, `coupling table has rows (${coup.tableRows})`);
expect(!coup.error, 'coupling turn is not an error');
expect(coup.notice === null, 'notice only shown on the first keyless turn');

console.log('— D: rank nets by coupling —');
const nets = await sendChat('rank nets by coupling');
expect(nets.tableRows > 0, `net table has rows (${nets.tableRows})`);

console.log('— E: click first rank-blocks row → hybrid opens —');
await page.evaluate(() => {
  const tables = document.querySelectorAll('.chat-msg.assistant .chat-table tbody');
  tables[0]?.querySelector('tr')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 800));
const hybridUp = await page.$('svg g rect[height="58"], svg g rect[height="40"]');
expect(hybridUp !== null, 'hybrid canvas visible after row click');

console.log('— F: help fallback —');
const help = await sendChat('please make me a sandwich');
expect(help.text.includes('Basic parser mode understands'), 'unknown phrasing yields help');

await page.screenshot({ path: `${SHOTS}/chat-parser-mode.png` });
console.log(`\nscreenshot: ${SHOTS}/chat-parser-mode.png`);
await browser.close();
console.log(failures === 0 ? '\nALL CHAT QA CHECKS PASSED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
