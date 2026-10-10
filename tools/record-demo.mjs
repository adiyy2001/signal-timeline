import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { resolveChrome } from './chrome.mjs';
import { serveDemo } from './serve-demo.mjs';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const videoDirectory = join(root, 'tmp', 'demo-video');
const outputDirectory = join(root, 'docs', 'media');
const gifPath = join(outputDirectory, 'demo.gif');
const maxBytes = 8 * 1024 * 1024;
const viewport = { width: 1280, height: 720 };
const chrome = await resolveChrome();

const cursorScript = `
  window.addEventListener('DOMContentLoaded', () => {
    const cursor = document.createElement('div');
    cursor.style.cssText = 'position:fixed;z-index:99999;width:18px;height:18px;margin:-4px 0 0 -4px;border-radius:50%;background:rgba(220,38,38,0.85);border:2px solid #fff;pointer-events:none;left:-40px;top:-40px;box-shadow:0 1px 4px rgba(0,0,0,0.4)';
    document.body.appendChild(cursor);
    window.addEventListener('mousemove', (event) => {
      cursor.style.left = event.clientX + 'px';
      cursor.style.top = event.clientY + 'px';
    }, true);
  });
`;

function pause(page, milliseconds) {
  return page.waitForTimeout(milliseconds);
}

async function canvasPoint(page, x, y) {
  const box = await page.locator('svg.surface').boundingBox();
  return { x: box.x + (x / 960) * box.width, y: box.y + (y / 600) * box.height };
}

async function drag(page, from, to) {
  const start = await canvasPoint(page, from.x, from.y);
  const end = await canvasPoint(page, to.x, to.y);
  await page.mouse.move(start.x, start.y, { steps: 12 });
  await pause(page, 150);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 18 });
  await pause(page, 150);
  await page.mouse.up();
  await pause(page, 500);
}

async function chooseTool(page, name) {
  await page.getByRole('button', { name, exact: true }).click();
  await pause(page, 250);
}

async function jumpToTreeItem(page, labelStart) {
  await page.locator(`st-branch-tree [role="treeitem"][aria-label^="${labelStart}"]`).click();
  await pause(page, 1100);
}

async function scrub(page, key, times) {
  for (let step = 0; step < times; step++) {
    await page.keyboard.press(key);
    await pause(page, 420);
  }
}

async function performStory(page, url) {
  await page.goto(url);
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await pause(page, 900);
  await chooseTool(page, 'Rectangle');
  await drag(page, { x: 80, y: 120 }, { x: 260, y: 220 });
  await chooseTool(page, 'Ellipse');
  await drag(page, { x: 520, y: 100 }, { x: 700, y: 200 });
  await chooseTool(page, 'Connector');
  await drag(page, { x: 170, y: 170 }, { x: 610, y: 150 });
  await pause(page, 900);
  await page.getByRole('button', { name: /^Undo/ }).first().click();
  await pause(page, 900);
  await chooseTool(page, 'Rectangle');
  await drag(page, { x: 400, y: 380 }, { x: 560, y: 470 });
  await pause(page, 1200);
  await jumpToTreeItem(page, 'Add connector');
  await pause(page, 600);
  await jumpToTreeItem(page, 'Add Rectangle 2');
  await pause(page, 600);
  await page.locator('st-timeline-scrubber input[type="range"]').focus();
  await scrub(page, 'ArrowLeft', 3);
  await pause(page, 500);
  await scrub(page, 'ArrowRight', 3);
  await pause(page, 1200);
}

function convertToGif(videoPath, startSeconds) {
  const filter =
    'fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle';
  const result = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-loglevel',
      'error',
      '-ss',
      String(startSeconds),
      '-i',
      videoPath,
      '-vf',
      filter,
      '-loop',
      '0',
      gifPath,
    ],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    console.error(result.stderr);
    process.exit(1);
  }
}

rmSync(videoDirectory, { recursive: true, force: true });
mkdirSync(videoDirectory, { recursive: true });
mkdirSync(outputDirectory, { recursive: true });

const { url, close } = await serveDemo();
const browser = await chromium.launch({ executablePath: chrome, headless: true });
try {
  const context = await browser.newContext({
    viewport,
    recordVideo: { dir: videoDirectory, size: viewport },
  });
  await context.addInitScript(cursorScript);
  const page = await context.newPage();
  await performStory(page, url);
  await context.close();
} finally {
  await browser.close();
  await close();
}

const recorded = readdirSync(videoDirectory).find((name) => name.endsWith('.webm'));
const videoPath = join(videoDirectory, 'demo.webm');
renameSync(join(videoDirectory, recorded), videoPath);
convertToGif(videoPath, 0.4);
const bytes = statSync(gifPath).size;
console.log(`${gifPath} ${(bytes / 1024 / 1024).toFixed(2)} MB`);
if (bytes > maxBytes) {
  console.error('the GIF is larger than 8 MB');
  process.exit(1);
}
