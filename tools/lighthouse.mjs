import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import lighthouse from 'lighthouse';
import desktopConfig from 'lighthouse/core/config/desktop-config.js';
import { serveDemo } from './serve-demo.mjs';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const chromePath = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
const debuggingPort = Number(process.env.LIGHTHOUSE_PORT ?? 9333);
const minimumAccessibility = 95;
const categories = ['accessibility', 'performance', 'best-practices', 'seo'];
const presets = [
  { name: 'mobile', config: undefined },
  { name: 'desktop', config: desktopConfig },
];

function removeStrayProfileFolders() {
  for (const entry of readdirSync(root)) {
    if (entry.startsWith('C:')) {
      rmSync(join(root, entry), { recursive: true, force: true });
    }
  }
}

async function waitForChrome() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debuggingPort}/json/version`);
      if (response.ok) {
        return;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error('Chrome did not open its debugging port');
}

function percent(score) {
  return Math.round((score ?? 0) * 100);
}

const profile = mkdtempSync(join(tmpdir(), 'signal-timeline-lighthouse-'));
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    `--remote-debugging-port=${debuggingPort}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);
const { url, close } = await serveDemo();

let failed = false;
try {
  await waitForChrome();
  const version = await (await fetch(`http://127.0.0.1:${debuggingPort}/json/version`)).json();
  console.log(`Lighthouse on ${url} with ${version.Browser}`);
  for (const preset of presets) {
    const run = await lighthouse(
      url,
      { port: debuggingPort, output: 'json', logLevel: 'error', onlyCategories: categories },
      preset.config,
    );
    const lhr = run.lhr;
    const scores = categories.map(
      (category) => `${category} ${percent(lhr.categories[category]?.score)}`,
    );
    console.log(`${preset.name}: ${scores.join(', ')} (Lighthouse ${lhr.lighthouseVersion})`);
    const accessibility = percent(lhr.categories['accessibility']?.score);
    if (accessibility < minimumAccessibility) {
      failed = true;
      const failing = Object.values(lhr.audits)
        .filter((audit) => audit.score !== null && audit.score < 1)
        .map((audit) => `  ${audit.id}: ${audit.title}`);
      console.log(`accessibility ${accessibility} is below ${minimumAccessibility}`);
      console.log(failing.join('\n'));
    }
  }
} finally {
  chrome.kill('SIGKILL');
  await close();
  rmSync(profile, { recursive: true, force: true });
  removeStrayProfileFolders();
}
process.exit(failed ? 1 : 0);
