import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { resolveChrome } from './chrome.mjs';
import { serveDemo } from './serve-demo.mjs';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const outputDirectory = join(root, '.screenshots');
mkdirSync(outputDirectory, { recursive: true });

const chrome = await resolveChrome();
const { url, close } = await serveDemo();
const browser = await chromium.launch({ executablePath: chrome, headless: true });

async function canvasPoint(page, x, y) {
  const box = await page.locator('svg.surface').boundingBox();
  return { x: box.x + (x / 960) * box.width, y: box.y + (y / 600) * box.height };
}

async function drag(page, from, to) {
  const start = await canvasPoint(page, from.x, from.y);
  const end = await canvasPoint(page, to.x, to.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, { steps: 4 });
  await page.mouse.move(end.x, end.y, { steps: 4 });
  await page.mouse.up();
}

async function scene(page, name) {
  await page.goto(url);
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await drag(page, { x: 80, y: 120 }, { x: 260, y: 220 });
  await page.getByRole('button', { name: 'Ellipse', exact: true }).click();
  await drag(page, { x: 520, y: 100 }, { x: 700, y: 200 });
  await page.getByRole('button', { name: 'Connector', exact: true }).click();
  await drag(page, { x: 170, y: 170 }, { x: 610, y: 150 });
  await page.screenshot({ path: join(outputDirectory, `${name}-1-drawn.png`), fullPage: true });
  await page.keyboard.press('Control+z');
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await drag(page, { x: 400, y: 380 }, { x: 560, y: 470 });
  await page.screenshot({ path: join(outputDirectory, `${name}-2-branch.png`), fullPage: true });
}

try {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await scene(desktop, 'desktop');
  await desktop.getByRole('button', { name: /Color theme/ }).click();
  await desktop.getByRole('button', { name: /Color theme/ }).click();
  await desktop.screenshot({ path: join(outputDirectory, 'desktop-3-dark.png'), fullPage: true });
  await desktop.getByRole('button', { name: /Color theme/ }).click();
  await desktop.getByRole('button', { name: /^Delete/ }).focus();
  await desktop.keyboard.press('Tab');
  await desktop.keyboard.press('ArrowRight');
  await desktop.screenshot({ path: join(outputDirectory, 'desktop-4-focus.png'), fullPage: true });
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await scene(mobile, 'mobile');
} finally {
  await browser.close();
  await close();
}
