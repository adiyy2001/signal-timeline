import { existsSync } from 'node:fs';

const candidates = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

export const headlessArguments = [
  '--no-sandbox',
  '--disable-gpu',
  '--password-store=basic',
  '--use-mock-keychain',
  '--no-first-run',
  '--no-default-browser-check',
];

async function playwrightChromium() {
  try {
    const { chromium } = await import('playwright-core');
    const path = chromium.executablePath();
    return existsSync(path) ? path : undefined;
  } catch {
    return undefined;
  }
}

export async function resolveChrome() {
  const configured = process.env.CHROME_PATH;
  if (configured !== undefined) {
    if (existsSync(configured)) {
      return configured;
    }
    console.error(`CHROME_PATH points at ${configured}, which does not exist`);
    process.exit(2);
  }
  const installed = candidates.find((path) => existsSync(path)) ?? (await playwrightChromium());
  if (installed === undefined) {
    console.error(
      'No Chrome found. Install Google Chrome, set CHROME_PATH, or run: pnpm exec playwright install chromium',
    );
    process.exit(2);
  }
  return installed;
}
