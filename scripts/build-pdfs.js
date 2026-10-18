#!/usr/bin/env node
'use strict';
/**
 * Prints the association's documents to PDF: downloads/versailles-vivant-annual-report-2025.pdf and
 * downloads/versailles-vivant-statutes.pdf, from the HTML in scripts/pdf/. The PDFs are committed, so this only needs to
 * run after the HTML changes. It uses the browser tools of the test folder (once: cd qa && npm install).
 *
 *   npm run pdfs                 (CHROME_PATH=/path/to/chrome npm run pdfs to use a particular browser)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DOCS = [
  ['annual-report-2025.html', 'versailles-vivant-annual-report-2025.pdf'],
  ['statutes.html', 'versailles-vivant-statutes.pdf']
];

async function main() {
  let chromium;
  try { ({ chromium } = require(path.join(ROOT, 'qa', 'node_modules', 'playwright-core'))); } catch (e) {
    throw new Error('playwright-core is missing: run "cd qa && npm install" first');
  }
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    fs.mkdirSync(path.join(ROOT, 'downloads'), { recursive: true });
    for (const [src, out] of DOCS) {
      await page.goto('file://' + path.join(ROOT, 'scripts', 'pdf', src), { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      await page.pdf({
        path: path.join(ROOT, 'downloads', out), format: 'A4', printBackground: true, preferCSSPageSize: true,
        tagged: true, outline: true, displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: '<div style="width:100%;font-size:7.5px;color:#546A58;text-align:center;font-family:Arial,sans-serif;">Versailles Vivant · <span class="pageNumber"></span> / <span class="totalPages"></span></div>'
      });
      console.log('downloads/' + out + ' (' + Math.round(fs.statSync(path.join(ROOT, 'downloads', out)).size / 1024) + ' KB)');
    }
  } finally { await browser.close(); }
}

main().catch((e) => { console.error('build-pdfs: ' + e.message); process.exit(1); });
