// Screenshots of the capability report, for checking its layout (dev aid).
//   node tests/reporting/screenshot.mjs [test-report/index.html] [outPrefix]
import path from 'node:path';
import { chromium } from '@playwright/test';

const html = path.resolve(process.argv[2] || 'test-report/index.html');
const out = path.resolve(process.argv[3] || 'test-report/screenshot');
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 1400 } });
await p.goto('file://' + html);
await p.screenshot({ path: `${out}-top.png` });
await p.evaluate(() => document.querySelector('#coverage').scrollIntoView());
await p.screenshot({ path: `${out}-coverage.png` });
await p.evaluate(() => {
  const s = document.querySelector('section.cap details');
  if (s) {
    s.open = true;
    s.closest('section').scrollIntoView();
  }
});
await p.screenshot({ path: `${out}-capability.png` });
await b.close();
