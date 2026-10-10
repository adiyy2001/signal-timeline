import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveChrome } from '../chrome.mjs';
import { serveDemo } from '../serve-demo.mjs';
import { assert, check, equal, sleep } from './runner.mjs';

const root = join(import.meta.dirname, '..', '..');
const demoDirectory = join(root, 'dist', 'demo', 'browser');
const treeItemSelector = 'st-branch-tree [role="treeitem"]';

function createSession(page) {
  async function point(x, y) {
    const box = await page.locator('svg.surface').boundingBox();
    return { x: box.x + (x / 960) * box.width, y: box.y + (y / 600) * box.height };
  }

  async function drag(from, to) {
    const start = await point(from[0], from[1]);
    const end = await point(to[0], to[1]);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, { steps: 4 });
    await page.mouse.move(end.x, end.y, { steps: 4 });
    await page.mouse.up();
  }

  async function draw(tool, from, to) {
    await page.getByRole('button', { name: tool, exact: true }).click();
    await drag(from, to);
  }

  async function settle(expected, read, message) {
    const deadline = Date.now() + 4000;
    let value = await read();
    while (value !== expected && Date.now() < deadline) {
      await sleep(50);
      value = await read();
    }
    equal(value, expected, message);
  }

  return {
    page,
    drag,
    draw,
    settle,
    shapes: () => page.locator('[data-shape-id]').count(),
    connectors: () => page.locator('[data-connector-id]').count(),
    treeItems: () => page.locator(treeItemSelector).count(),
  };
}

async function drawsEachKind({ draw, settle, shapes, connectors, treeItems }) {
  await draw('Rectangle', [80, 120], [260, 220]);
  await draw('Ellipse', [520, 100], [700, 200]);
  await draw('Connector', [170, 170], [610, 150]);
  await settle(2, shapes, 'shapes');
  await settle(1, connectors, 'connectors');
  await settle(4, treeItems, 'tree items');
}

async function movesRecolorsAndDeletes({ page, drag, settle, shapes, connectors, treeItems }) {
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await drag([170, 170], [220, 250]);
  await settle(5, treeItems, 'tree items after a move');
  await page.getByRole('button', { name: 'rose' }).click();
  await settle(6, treeItems, 'tree items after a recolor');
  await page.locator('[data-shape-id]').first().focus();
  await page.keyboard.press('Delete');
  await settle(1, shapes, 'shapes after delete');
  await settle(0, connectors, 'the connector goes with its shape');
  await settle(7, treeItems, 'delete is one entry');
}

async function undoesAndRedoesWithKeys({ page, settle, shapes, connectors }) {
  await page.keyboard.press('Control+z');
  await settle(2, shapes, 'shapes after undo');
  await settle(1, connectors, 'connector after undo');
  await page.keyboard.press('Control+Shift+z');
  await settle(1, shapes, 'shapes after redo');
}

async function branchesAfterUndo({ page, draw, settle, treeItems }) {
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await draw('Rectangle', [400, 380], [560, 470]);
  await settle(
    2,
    () => page.locator(`${treeItemSelector}[aria-setsize="2"]`).count(),
    'sibling nodes at the branch point',
  );
  await settle(8, treeItems, 'both branches stay in the tree');
}

async function jumpsBetweenBranches({ page, settle, shapes }) {
  await page.locator(`${treeItemSelector}[aria-label^="Recolor"]`).first().click();
  await settle(2, shapes, 'shapes on the old branch');
  await page.locator(treeItemSelector).last().click();
  await settle(3, shapes, 'shapes on the new branch');
}

async function scrubsWithKeys({ page, settle, shapes }) {
  const scrubber = page.locator('st-timeline-scrubber input[type="range"]');
  await scrubber.focus();
  await page.keyboard.press('Home');
  await settle(0, shapes, 'shapes at the start');
  await page.keyboard.press('End');
  await settle(3, shapes, 'shapes at the end');
  await page.keyboard.press('ArrowLeft');
  await settle(2, shapes, 'one step back removes the last shape');
}

async function followsTheAriaTreePattern({ page }) {
  equal(await page.locator('st-branch-tree svg[role="tree"]').count(), 1, 'one tree');
  const item = page.locator(treeItemSelector).first();
  for (const attribute of ['aria-level', 'aria-setsize', 'aria-posinset', 'aria-selected']) {
    assert((await item.getAttribute(attribute)) !== null, `treeitem lacks ${attribute}`);
  }
  assert(
    (await page.locator(`${treeItemSelector}[aria-expanded]`).count()) > 0,
    'branching nodes expose aria-expanded',
  );
  const focusable = await page.locator(`${treeItemSelector}[tabindex="0"]`).count();
  equal(focusable, 1, 'exactly one tab stop in the tree');
}

async function showsTheDiffOfTheSelectedEntry({ page }) {
  await page.locator(treeItemSelector).nth(1).click();
  assert((await page.locator('st-entry-diff table tbody tr').count()) > 0, 'no operation rows');
}

async function autosavesEditsButNotReplays({ page }) {
  const counter = page.locator('[data-test="autosave-count"]');
  const before = await counter.textContent();
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+Shift+z');
  await page.locator(treeItemSelector).first().click();
  await sleep(300);
  equal(await counter.textContent(), before, 'the counter after replays');
}

async function survivesAReload({ page, settle, shapes, treeItems }) {
  await page.locator(treeItemSelector).last().click();
  await sleep(500);
  const items = await treeItems();
  const drawn = await shapes();
  await page.reload();
  await page.locator('svg.surface').waitFor();
  await settle(drawn, shapes, 'shapes after reload');
  await settle(items, treeItems, 'tree items after reload');
}

const browserChecks = [
  ['draws a rectangle, an ellipse and a connector, one entry each', drawsEachKind],
  ['moves, recolors and deletes shapes', movesRecolorsAndDeletes],
  ['undo and redo with the keyboard', undoesAndRedoesWithKeys],
  ['a change after an undo creates a branch', branchesAfterUndo],
  ['jumps between branches from the tree', jumpsBetweenBranches],
  ['scrubs the timeline with the arrow keys, Home and End', scrubsWithKeys],
  ['the tree follows the ARIA tree pattern', followsTheAriaTreePattern],
  ['the diff view shows the operations of the selected entry', showsTheDiffOfTheSelectedEntry],
  ['autosave runs for edits but not for undo, redo or jumps', autosavesEditsButNotReplays],
  ['the drawing and the whole history survive a reload', survivesAReload],
];

async function openFreshDemo(page, url) {
  await page.goto(url);
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await page.locator('svg.surface').waitFor();
}

function collectProblems(page) {
  const problems = [];
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => message.type() === 'error' && problems.push(message.text()));
  return problems;
}

export async function runBrowserChecks() {
  if (!existsSync(demoDirectory)) {
    await check('demo', 'the production build exists', async () => {
      throw new Error('run pnpm build:demo first');
    });
    return;
  }
  const { chromium } = await import('playwright-core');
  const { url, close } = await serveDemo({ directory: demoDirectory });
  const browser = await chromium.launch({
    executablePath: await resolveChrome(),
    headless: true,
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const problems = collectProblems(page);
    const session = createSession(page);
    await openFreshDemo(page, url);
    for (const [name, run] of browserChecks) {
      await check('demo', name, () => run(session));
    }
    await check('demo', 'no console errors or uncaught exceptions during the run', async () => {
      equal(problems, [], 'browser problems');
    });
  } finally {
    await browser.close();
    await close();
  }
}
