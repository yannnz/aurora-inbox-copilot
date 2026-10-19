import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('E:/new2/rhoai-feature stores/package.json');
const { chromium } = require('@playwright/test');

const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(root, 'shots');
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(25000);

async function shot(name) {
  await page.screenshot({ path: path.join(out, name), animations: 'disabled' });
  console.log('saved', name);
}

try {
  await page.goto('http://127.0.0.1:8787/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.goMaster('schedules'));
  await page.waitForTimeout(600);
  await shot('powernano-schedules.png');

  await page.evaluate(() => window.goMaster('review'));
  await page.waitForTimeout(900);
  await shot('powernano-review.png');

  const detail = page.locator('#paneReview').getByRole('button', { name: '查看详情' }).first();
  if (await detail.count()) {
    await detail.click();
    await page.waitForTimeout(900);
    await shot('powernano-report.png');
  }

  await page.evaluate(() => window.goMaster('knowledge'));
  await page.waitForTimeout(900);
  await shot('powernano-knowledge.png');
} catch (err) {
  console.error('powernano', err.message);
}

try {
  await page.goto('http://localhost:9000/develop-train/feature-store/overview', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await shot('rhoai-overview.png');

  await page.goto('http://localhost:9000/develop-train/feature-store/features', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await shot('rhoai-features.png');

  await page.goto('http://localhost:9000/develop-train/feature-store/features/feature-001', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await shot('rhoai-detail.png');

  const monitoring = page.getByRole('tab', { name: /Monitoring/i }).first();
  if (await monitoring.count()) {
    await monitoring.click();
    await page.waitForTimeout(1200);
    await shot('rhoai-monitoring.png');
  }
} catch (err) {
  console.error('rhoai', err.message);
}

try {
  const aurora = 'file:///C:/Users/PaigeZ/Desktop/Learning/Maven%20training%20class%20project%20material/agentic-ai-capstone-develop-companion-v0.3/index.html';
  await page.goto(aurora, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await page.locator('#inbox-source').selectOption('demo');
  await page.waitForTimeout(700);
  await shot('aurora-inbox.png');

  const urgent = page.locator('.row', { hasText: 'approve vendor payment' }).first();
  if (await urgent.count()) {
    await urgent.click();
    await page.waitForTimeout(600);
    await shot('aurora-payment.png');
  } else {
    console.error('aurora payment row not found');
  }

  await page.locator('#tab-evals').click();
  await page.waitForTimeout(500);
  await shot('aurora-evals.png');
} catch (err) {
  console.error('aurora', err.message);
}

await browser.close();
