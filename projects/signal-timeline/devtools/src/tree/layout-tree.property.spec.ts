import * as fc from 'fast-check';
import { assertProperty } from '../../../src/core/testing/property';
import { layoutTree } from './layout-tree';
import { entriesFromParents } from '../testing/entries';

const parentsArbitrary = fc
  .integer({ min: 0, max: 60 })
  .chain((size) =>
    fc.tuple(...Array.from({ length: size }, (_, index) => fc.integer({ min: 1, max: index + 1 }))),
  );

const scenario = parentsArbitrary.chain((parents) =>
  fc.record({
    parents: fc.constant(parents),
    tip: fc.integer({ min: 1, max: parents.length + 1 }),
  }),
);

function pathTo(parents: readonly number[], tip: number): number[] {
  const path = [tip];
  let cursor = tip;
  while (cursor > 1) {
    cursor = parents[cursor - 2];
    path.push(cursor);
  }
  return path.reverse();
}

function layoutOf(parents: readonly number[], tip: number) {
  const path = pathTo(parents, tip);
  return { path, layout: layoutTree(entriesFromParents(parents), path) };
}

describe('layoutTree properties', { timeout: 120_000 }, () => {
  it('places every entry exactly once, parents before children', () => {
    assertProperty(
      fc.property(scenario, ({ parents, tip }) => {
        const { layout } = layoutOf(parents, tip);
        const ids = layout.nodes.map((node) => node.id);
        expect(new Set(ids).size).toBe(parents.length + 1);
        const position = new Map(ids.map((id, index) => [id, index]));
        for (const node of layout.nodes) {
          if (node.parentId !== undefined) {
            expect(position.get(node.parentId)).toBeLessThan(position.get(node.id) ?? -1);
          }
        }
      }),
    );
  });

  it('never puts two nodes on the same grid cell', () => {
    assertProperty(
      fc.property(scenario, ({ parents, tip }) => {
        const { layout } = layoutOf(parents, tip);
        const cells = layout.nodes.map((node) => `${node.column}:${node.row}`);
        expect(new Set(cells).size).toBe(cells.length);
      }),
    );
  });

  it('puts a child exactly one row below its parent', () => {
    assertProperty(
      fc.property(scenario, ({ parents, tip }) => {
        const { layout } = layoutOf(parents, tip);
        const byId = new Map(layout.nodes.map((node) => [node.id, node]));
        for (const node of layout.nodes) {
          if (node.parentId !== undefined) {
            expect(node.row).toBe((byId.get(node.parentId)?.row ?? -2) + 1);
          }
        }
      }),
    );
  });

  it('draws the active branch on one straight line', () => {
    assertProperty(
      fc.property(scenario, ({ parents, tip }) => {
        const { layout, path } = layoutOf(parents, tip);
        const byId = new Map(layout.nodes.map((node) => [node.id, node]));
        expect(path.map((id) => byId.get(id)?.column)).toEqual(path.map(() => 0));
      }),
    );
  });

  it('keeps every node inside the grid and never left of its parent', () => {
    assertProperty(
      fc.property(scenario, ({ parents, tip }) => {
        const { layout } = layoutOf(parents, tip);
        const byId = new Map(layout.nodes.map((node) => [node.id, node]));
        for (const node of layout.nodes) {
          const parent = node.parentId === undefined ? undefined : byId.get(node.parentId);
          if (parent !== undefined) {
            expect(node.column).toBeGreaterThanOrEqual(parent.column);
          }
        }
        expect(Math.max(...layout.nodes.map((node) => node.column))).toBeLessThan(layout.columns);
      }),
    );
  });

  it('numbers siblings from one to the set size', () => {
    assertProperty(
      fc.property(scenario, ({ parents, tip }) => {
        const { layout } = layoutOf(parents, tip);
        const siblings = new Map<number | undefined, number[]>();
        for (const node of layout.nodes) {
          siblings.set(node.parentId, [...(siblings.get(node.parentId) ?? []), node.positionInSet]);
        }
        for (const [, positions] of siblings) {
          expect([...positions].sort((a, b) => a - b)).toEqual(
            positions.map((_, index) => index + 1),
          );
        }
        expect(layout.nodes.every((node) => node.setSize >= node.positionInSet)).toBe(true);
      }),
    );
  });

  it('gives the same layout for the same input', () => {
    assertProperty(
      fc.property(scenario, ({ parents, tip }) => {
        expect(layoutOf(parents, tip).layout).toEqual(layoutOf(parents, tip).layout);
      }),
    );
  });
});
