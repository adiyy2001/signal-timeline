import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, totalmem, arch } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const buildDirectory = join(root, 'tmp', 'bench');
const resultsDirectory = join(root, 'bench', 'results');
const nodeHeapLimitMb = 3584;

function parseArguments(argv) {
  const options = { runtimes: ['node', 'chromium'], smoke: false, suites: [] };
  for (const argument of argv) {
    if (argument === '--smoke') {
      options.smoke = true;
    } else if (argument.startsWith('--suite=')) {
      options.suites = argument.slice('--suite='.length).split(',');
    } else if (argument === 'node' || argument === 'chromium') {
      options.runtimes = [argument];
    } else if (argument !== 'all') {
      throw new Error(`Unknown argument ${argument}`);
    }
  }
  return options;
}

const sharedBuild = {
  bundle: true,
  sourcemap: false,
  define: { ngDevMode: 'false' },
  tsconfig: join(root, 'tsconfig.json'),
  alias: { 'signal-timeline': join(root, 'projects', 'signal-timeline', 'src', 'public-api.ts') },
};

async function bundleFor(runtime) {
  mkdirSync(buildDirectory, { recursive: true });
  if (runtime === 'node') {
    const outfile = join(buildDirectory, 'bench-node.mjs');
    await build({
      ...sharedBuild,
      entryPoints: [join(root, 'bench', 'entry-node.ts')],
      outfile,
      platform: 'node',
      format: 'esm',
      target: 'node24',
      banner: {
        js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
      },
    });
    return outfile;
  }
  const outfile = join(buildDirectory, 'bench-browser.js');
  await build({
    ...sharedBuild,
    entryPoints: [join(root, 'bench', 'entry-browser.ts')],
    outfile,
    platform: 'browser',
    format: 'iife',
    target: 'chrome120',
  });
  return outfile;
}

function machineFacts() {
  const processors = cpus();
  return {
    cpu: processors[0]?.model ?? 'unknown',
    cores: processors.length,
    memoryGb: Math.round(totalmem() / 1024 ** 3),
    os: `${platform()} ${release()} ${arch()}`,
  };
}

function runInNode(bundle, options) {
  const outputPath = join(buildDirectory, 'node-output.json');
  const result = spawnSync(
    process.execPath,
    [
      '--expose-gc',
      `--max-old-space-size=${nodeHeapLimitMb}`,
      bundle,
      outputPath,
      options.smoke ? 'smoke' : 'full',
      ...options.suites,
    ],
    { cwd: root, stdio: 'inherit' },
  );
  if (result.status !== 0) {
    throw new Error('The Node run failed');
  }
  return {
    engine: `Node ${process.version}`,
    output: JSON.parse(readFileSync(outputPath, 'utf8')),
  };
}

async function runInChromium(bundle, options) {
  const { chromium } = await import('playwright-core');
  const browser = await chromium
    .launch({
      headless: true,
      args: ['--js-flags=--expose-gc', '--enable-precise-memory-info'],
    })
    .catch((error) => {
      console.error(`Chromium could not start (${error.message.split('\n')[0]})`);
      console.error('Run: pnpm exec playwright install chromium');
      process.exit(2);
    });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(0);
    page.on('console', (message) => console.log(message.text()));
    page.on('pageerror', (error) => console.error(error));
    await page.setContent('<!doctype html><title>bench</title>');
    await page.addScriptTag({ content: readFileSync(bundle, 'utf8') });
    const agent = await page.evaluate(() => navigator.userAgent);
    const output = await page.evaluate((runOptions) => globalThis.runBench(runOptions), {
      smoke: options.smoke,
      suites: options.suites,
    });
    return { engine: `Chromium ${browser.version()}`, output, userAgent: agent };
  } finally {
    await browser.close();
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  for (const runtime of options.runtimes) {
    const bundle = await bundleFor(runtime);
    const started = new Date().toISOString();
    const run =
      runtime === 'node' ? runInNode(bundle, options) : await runInChromium(bundle, options);
    const document = {
      runtime,
      engine: run.engine,
      generatedAt: started,
      smoke: options.smoke,
      hardware: machineFacts(),
      userAgent: run.userAgent,
      command: `node bench/run.mjs ${runtime}${options.smoke ? ' --smoke' : ''}`,
      suites: run.output.suites,
      durationsMs: run.output.durationsMs,
    };
    const directory = options.smoke ? buildDirectory : resultsDirectory;
    mkdirSync(directory, { recursive: true });
    const file = join(directory, options.smoke ? `smoke-${runtime}.json` : `${runtime}.json`);
    writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`);
    console.log(`wrote ${file}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
