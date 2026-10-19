import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('E:/new2/rhoai-feature stores/package.json');
const { chromium } = require('@playwright/test');
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'shots', 'rhoai-lineage.png');

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(20000);
await page.goto('http://localhost:9000/develop-train/feature-store/overview?featureStore=Fraud%20detection', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
await page.getByRole('tab', { name: 'Lineage' }).click();
await page.waitForTimeout(1800);
await page.screenshot({ path: out, animations: 'disabled' });
console.log('saved', out);
await browser.close();
