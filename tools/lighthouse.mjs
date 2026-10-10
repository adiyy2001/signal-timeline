import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import lighthouse from 'lighthouse';
import desktopConfig from 'lighthouse/core/config/desktop-config.js';
import { headlessArguments, resolveChrome } from './chrome.mjs';
import { serveDemo } from './serve-demo.mjs';

const minimumAccessibility = 95;
const presetTimeoutMs = Number(process.env.LIGHTHOUSE_TIMEOUT_MS ?? 120_000);
const categories = ['accessibility', 'performance', 'best-practices', 'seo'];
const presets = [
  { name: 'mobile', config: undefined },
  { name: 'desktop', config: desktopConfig },
];

function percent(score) {
  return Math.round((score ?? 0) * 100);
}

async function readDebuggingPort(profile) {
  const file = join(profile, 'DevToolsActivePort');
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (existsSync(file)) {
      const port = Number(readFileSync(file, 'utf8').split('\n')[0]);
      if (Number.isInteger(port) && port > 0) {
        return port;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Chrome did not open its debugging port');
}

function withTimeout(promise, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} took longer than ${presetTimeoutMs} ms`)),
      presetTimeoutMs,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function describeFailingAudits(lhr) {
  return Object.values(lhr.audits)
    .filter((audit) => audit.score !== null && audit.score < 1)
    .map((audit) => `  ${audit.id}: ${audit.title}`)
    .join('\n');
}

async function auditPreset(preset, url, port) {
  const run = await withTimeout(
    lighthouse(
      url,
      { port, output: 'json', logLevel: 'error', onlyCategories: categories },
      preset.config,
    ),
    `Lighthouse ${preset.name}`,
  );
  const lhr = run.lhr;
  if (lhr.runtimeError !== undefined) {
    throw new Error(
      `Lighthouse ${preset.name}: ${lhr.runtimeError.code} ${lhr.runtimeError.message}`,
    );
  }
  const scores = categories.map(
    (category) => `${category} ${percent(lhr.categories[category]?.score)}`,
  );
  console.log(`${preset.name}: ${scores.join(', ')} (Lighthouse ${lhr.lighthouseVersion})`);
  const accessibility = percent(lhr.categories['accessibility']?.score);
  if (accessibility < minimumAccessibility) {
    console.log(`accessibility ${accessibility} is below ${minimumAccessibility}`);
    console.log(describeFailingAudits(lhr));
    return false;
  }
  return true;
}

const chromePath = await resolveChrome();
const profile = mkdtempSync(join(tmpdir(), 'signal-timeline-lighthouse-'));
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    ...headlessArguments,
    '--remote-debugging-port=0',
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);
const { url, close } = await serveDemo();

let cleanedUp = false;
async function cleanUp() {
  if (cleanedUp) {
    return;
  }
  cleanedUp = true;
  if (chrome.exitCode === null) {
    const exited = new Promise((resolve) => chrome.once('exit', resolve));
    chrome.kill('SIGKILL');
    await exited;
  }
  await close();
  rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    cleanUp().finally(() => process.exit(130));
  });
}

let failed = false;
try {
  const port = await readDebuggingPort(profile);
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  console.log(`Lighthouse on ${url} with ${version.Browser}`);
  for (const preset of presets) {
    const passed = await auditPreset(preset, url, port);
    failed = failed || !passed;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  failed = true;
} finally {
  await cleanUp();
}
process.exit(failed ? 1 : 0);
