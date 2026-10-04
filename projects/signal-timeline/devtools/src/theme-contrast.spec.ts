import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const stylesheet = readFileSync(
  join(process.cwd(), 'projects/signal-timeline/devtools/src/timeline-devtools.component.css'),
  'utf8',
);

type Tokens = Record<string, string>;

function tokensIn(block: string): Tokens {
  return Object.fromEntries(
    [...block.matchAll(/--st-([a-z-]+):\s*(#[0-9a-f]{6});/g)].map((match) => [match[1], match[2]]),
  );
}

function blockStartingAt(marker: string): string {
  const start = stylesheet.indexOf(marker);
  const open = stylesheet.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < stylesheet.length; index += 1) {
    depth += stylesheet[index] === '{' ? 1 : stylesheet[index] === '}' ? -1 : 0;
    if (depth === 0) {
      return stylesheet.slice(open + 1, index);
    }
  }
  throw new Error(`unterminated block after ${marker}`);
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const [red, green, blue] = channels.map((value) =>
    value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

const light = tokensIn(blockStartingAt(':host {'));
const darkByMedia = tokensIn(
  blockStartingAt('@media (prefers-color-scheme: dark)').replace(/^[^{]*\{/, ''),
);
const darkForced = tokensIn(blockStartingAt(":host([data-theme='dark'])"));

const textPairs: readonly (readonly [string, string])[] = [
  ['text', 'bg'],
  ['text', 'surface'],
  ['text', 'hover'],
  ['text-muted', 'bg'],
  ['text-muted', 'surface'],
  ['accent', 'bg'],
  ['accent', 'surface'],
  ['op-add', 'bg'],
  ['op-remove', 'bg'],
  ['op-replace', 'bg'],
];

const graphicPairs: readonly (readonly [string, string])[] = [
  ['border', 'bg'],
  ['border', 'surface'],
  ['edge', 'surface'],
  ['edge-active', 'surface'],
  ['accent', 'surface'],
  ['focus', 'bg'],
  ['focus', 'surface'],
  ['focus', 'hover'],
];

describe.each([
  ['light', light],
  ['dark', darkForced],
])('the %s theme', (_name, tokens) => {
  it.each(textPairs)('keeps text %s on %s at 4.5:1 or more', (foreground, background) => {
    expect(contrast(tokens[foreground], tokens[background])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(graphicPairs)('keeps %s against %s at 3:1 or more', (foreground, background) => {
    expect(contrast(tokens[foreground], tokens[background])).toBeGreaterThanOrEqual(3);
  });
});

describe('the dark theme', () => {
  it('is the same whether the media query or the attribute selects it', () => {
    expect(darkByMedia).toEqual(darkForced);
  });

  it('defines every token the light theme defines', () => {
    expect(Object.keys(darkForced).sort()).toEqual(Object.keys(light).sort());
  });
});
