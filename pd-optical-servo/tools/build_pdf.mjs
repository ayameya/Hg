import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'docs', 'datasheet.html');
const out = path.join(root, 'PDOS-01_データシート.pdf');

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(pathToFileURL(src).href, { waitUntil: 'networkidle' });
await page.pdf({
  path: out,
  format: 'A4',
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: '<div style="width:100%;font-size:7px;color:#777;padding:0 15mm;text-align:right;font-family:IPAPGothic">PDOS-01 データシート 版 0.1</div>',
  footerTemplate: '<div style="width:100%;font-size:8px;color:#555;text-align:center;font-family:IPAPGothic"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
  margin: { top: '16mm', bottom: '18mm', left: '15mm', right: '15mm' },
});
await browser.close();
console.log(out);
