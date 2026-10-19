import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('E:/new2/rhoai-feature stores/package.json');
const { chromium } = require('@playwright/test');
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'shots');
const aurora = 'file:///C:/Users/PaigeZ/Desktop/Learning/Maven%20training%20class%20project%20material/agentic-ai-capstone-develop-companion-v0.3/index.html';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(aurora, { waitUntil: 'domcontentloaded' });
await page.locator('#inbox-source').selectOption('demo');
await page.waitForTimeout(600);
const row = page.locator('.case-card', { hasText: 'Defective batch' }).first();
await row.scrollIntoViewIfNeeded();
await row.click();
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(out, 'aurora-boundary.png') });
console.log('saved aurora-boundary.png');
await browser.close();
