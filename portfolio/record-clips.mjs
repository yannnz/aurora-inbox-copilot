import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('E:/new2/rhoai-feature stores/package.json');
const { chromium } = require('@playwright/test');
const root = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(root, 'shots');
const dataDir = 'C:/Users/PaigeZ/powernano-agentic-system/research_specialist/data';
const qid = 'q-portfoliodemo';
const queueFile = path.join(dataDir, 'queue', qid + '.json');
const kbFile = path.join(dataDir, 'kb', 'yy-patent', qid + '.json');

function writeDemo() {
  const item = {
    queue_id: qid,
    run_id: 'portfolio-demo',
    agent_id: 'yy-patent',
    status: 'pending',
    created_at: Date.now() / 1000,
    card: {
      type: '作品集演示',
      agent_id: 'yy-patent',
      domain: '专利',
      skill: 'patent',
      deliverable_kind: 'patent',
      summary: '仅用于录制「批准入库」的演示条目。',
      report_markdown: '这是一条演示报告，用来展示批准之后才会进入知识库。\n\n来源：https://www.wipo.int/portal/en/index.html\n',
      source: { title: 'WIPO', url: 'https://www.wipo.int/portal/en/index.html' },
    },
  };
  fs.writeFileSync(queueFile, JSON.stringify(item, null, 2));
}

function scrub(file) {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, 'utf8').split(/\n/).filter((line) => line && !line.includes(qid));
  fs.writeFileSync(file, lines.length ? lines.join('\n') + '\n' : '');
}

function cleanupDemo() {
  for (const file of [queueFile, kbFile]) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  scrub(path.join(dataDir, 'memory.jsonl'));
  scrub(path.join(dataDir, 'feedback.jsonl'));
}

const browser = await chromium.launch({ channel: 'msedge', headless: true, slowMo: 40 });

async function clip(name, run) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: shots, size: { width: 1280, height: 800 } },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  try {
    await run(page);
    await page.waitForTimeout(1200);
  } finally {
    const video = page.video();
    await page.close();
    await context.close();
    if (video) await video.saveAs(path.join(shots, name));
    console.log('saved', name);
  }
}

async function openPowerNano(page) {
  await page.goto('http://127.0.0.1:8787/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => typeof window.goMaster === 'function', null, { timeout: 20000 });
  await page.waitForTimeout(600);
}

async function safeClip(name, run) {
  try {
    await clip(name, run);
  } catch (err) {
    console.error('failed', name, err.message);
  }
}

try {
  writeDemo();
  await safeClip('pn-approve.webm', async (page) => {
    await openPowerNano(page);
    await page.evaluate(() => window.goMaster('review'));
    await page.waitForTimeout(1000);
    const row = page.locator('#paneReview .report-list-row', { hasText: '作品集演示' }).first();
    await row.waitFor({ timeout: 15000 });
    await row.getByRole('button', { name: '查看详情' }).click();
    await page.waitForTimeout(700);
    await page.locator('#reportApprove').scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    const approved = page.waitForResponse(
      (res) => res.url().includes('/approve') && res.request().method() === 'POST',
      { timeout: 15000 }
    );
    await page.locator('#reportApprove').click();
    const res = await approved;
    if (!res.ok()) throw new Error('approve HTTP ' + res.status());
    await page.waitForTimeout(800);
    await page.evaluate(() => window.goMaster('knowledge'));
    const kbRow = page.locator('#paneKnowledge .report-list-row[data-qid="q-portfoliodemo"]');
    await kbRow.waitFor({ state: 'visible', timeout: 12000 });
    await kbRow.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1600);
  });
} finally {
  cleanupDemo();
}

await browser.close();
