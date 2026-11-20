// Prints test-report/index.html to test-report/pdf/mmgis-test-report.pdf.
// Every <details> is opened and tables are unclipped so the PDF is a complete record
// for test review. Uses Playwright's Chromium (already a dev dependency).
//
//   node tests/reporting/report-pdf.mjs [--dir test-report]
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const i = process.argv.indexOf('--dir');
const dir = path.resolve(i > 0 ? process.argv[i + 1] : 'test-report');
const html = path.join(dir, 'index.html');
if (!fs.existsSync(html)) {
  console.error(`[report-pdf] ${html} not found — run the tests (or tests/reporting/render.mjs) first`);
  process.exit(1);
}
const summary = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8'));
const m = summary.meta;
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.emulateMedia({ colorScheme: 'light', media: 'print' });
  await page.goto('file://' + html, { waitUntil: 'load' });
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'light');
    document.querySelectorAll('details').forEach((d) => (d.open = true));
    // Links to other local files would be dead in a PDF: keep the text only.
    document.querySelectorAll('a[href]').forEach((a) => {
      const h = a.getAttribute('href');
      if (!h.startsWith('#') && !/^https?:/.test(h)) a.replaceWith(...a.childNodes);
    });
    const style = document.createElement('style');
    style.textContent = `
      body{font-size:11px} table{font-size:9.5px} td,th{padding:3px 5px} td{overflow-wrap:anywhere}
      .scroll{overflow:visible} summary{display:none} .cap{border:none;padding:0;margin:8px 0}
      h2{break-before:auto} #capabilities{break-before:page} tr,.banner{break-inside:avoid}`;
    document.head.appendChild(style);
  });
  const out = path.join(dir, 'pdf');
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, 'mmgis-test-report.pdf');
  await page.pdf({
    path: file,
    format: 'Letter',
    landscape: true,
    printBackground: true,
    scale: 0.8,
    margin: { top: '0.45in', bottom: '0.55in', left: '0.4in', right: '0.4in' },
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: `<div style="font-size:8px;width:100%;padding:0 0.4in;color:#666;display:flex;justify-content:space-between">
      <span>MMGIS Test Report · ${esc(m.tier)} tier · ${esc((m.generated || '').slice(0, 10))}${m.commit ? ' · ' + esc(m.commit.slice(0, 10)) : ''}${m.branch ? ' · ' + esc(m.branch) : ''}</span>
      <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
    outline: true,
    tagged: true,
  });
  console.log(`[report-pdf] ${path.relative(process.cwd(), file)} (${(fs.statSync(file).size / 1e6).toFixed(1)} MB)`);
} finally {
  await browser.close();
}
