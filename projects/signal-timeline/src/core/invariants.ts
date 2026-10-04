import { applyPatch } from './apply';
import { isCheckpointDepth } from './checkpoints';
import { deepEqual } from './equal';
import type { TimelineEngine } from './engine';
import type { NodeId, NodeView } from './history-tree';

export class InvariantViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvariantViolation';
  }
}

function fail(message: string): never {
  throw new InvariantViolation(message);
}

function expect(condition: boolean, message: string): void {
  if (!condition) {
    fail(message);
  }
}

function checkStructure<S extends object>(
  engine: TimelineEngine<S>,
  nodes: ReadonlyMap<NodeId, NodeView<S>>,
): void {
  const roots = [...nodes.values()].filter((node) => node.parentId === undefined);
  expect(roots.length === 1, `expected exactly one root, found ${roots.length}`);
  expect(roots[0].id === engine.rootId, 'the root node is not the engine root');
  expect(nodes.size === engine.size + 1, 'the size does not match the node count');
  expect(nodes.has(engine.currentId), 'the current pointer does not exist');
  const parentCount = new Map<NodeId, number>();
  for (const node of nodes.values()) {
    expect(node.id < engine.nextId, `node ${node.id} is not below the next id`);
    expect(
      new Set(node.children).size === node.children.length,
      `node ${node.id} lists a child twice`,
    );
    for (const childId of node.children) {
      const child = nodes.get(childId);
      expect(child !== undefined, `node ${node.id} lists the missing child ${childId}`);
      expect(
        child?.parentId === node.id,
        `child ${childId} does not point back to node ${node.id}`,
      );
      parentCount.set(childId, (parentCount.get(childId) ?? 0) + 1);
    }
    const last = node.lastVisitedChild;
    expect(
      last === undefined ? node.children.length === 0 : node.children.includes(last),
      `node ${node.id} has an invalid last visited child`,
    );
  }
  for (const node of nodes.values()) {
    if (node.parentId !== undefined) {
      const parent = nodes.get(node.parentId);
      expect(parent !== undefined, `node ${node.id} has the missing parent ${node.parentId}`);
      expect(
        parentCount.get(node.id) === 1,
        `node ${node.id} is listed by ${parentCount.get(node.id) ?? 0} parents`,
      );
      expect(node.depth === (parent?.depth ?? -2) + 1, `node ${node.id} has a wrong depth`);
    }
  }
}

function checkCheckpointPlacement<S extends object>(
  nodes: ReadonlyMap<NodeId, NodeView<S>>,
  rootId: NodeId,
  interval: number,
): void {
  for (const node of nodes.values()) {
    const expected = node.id === rootId || isCheckpointDepth(node.depth, interval);
    expect(
      (node.checkpoint !== undefined) === expected,
      `node ${node.id} at depth ${node.depth} has the wrong checkpoint placement`,
    );
  }
}

function checkReplay<S extends object>(
  engine: TimelineEngine<S>,
  nodes: ReadonlyMap<NodeId, NodeView<S>>,
): void {
  const root = nodes.get(engine.rootId);
  if (root?.checkpoint === undefined) {
    fail('the root has no checkpoint');
  }
  const states = new Map<NodeId, S>([[root.id, root.checkpoint]]);
  const queue: NodeId[] = [root.id];
  for (let index = 0; index < queue.length; index += 1) {
    const parent = nodes.get(queue[index]);
    const parentState = states.get(queue[index]);
    if (parent === undefined || parentState === undefined) {
      fail('the replay reached an unknown node');
    }
    for (const childId of parent.children) {
      const child = nodes.get(childId);
      expect(child !== undefined, `missing child ${childId}`);
      if (child === undefined) {
        continue;
      }
      const state = replayChild(child, parentState);
      if (child.checkpoint !== undefined) {
        expect(
          deepEqual(child.checkpoint, state),
          `the checkpoint of node ${childId} differs from the replayed state`,
        );
      }
      states.set(childId, state);
      queue.push(childId);
    }
  }
  expect(queue.length === nodes.size, 'some nodes are not reachable from the root');
  const currentState = states.get(engine.currentId);
  expect(
    deepEqual(engine.state, currentState),
    'the engine state differs from the state of the current node',
  );
}

function replayChild<S extends object>(child: NodeView<S>, parentState: S): S {
  if (child.pending !== undefined) {
    expect(
      deepEqual(child.pending.before, parentState),
      `node ${child.id} was recorded from another state`,
    );
    return child.pending.after;
  }
  if (child.forward === undefined || child.inverse === undefined) {
    return fail(`node ${child.id} has no patches and no pending change`);
  }
  const state = applyPatch(parentState, child.forward);
  expect(
    deepEqual(applyPatch(state, child.inverse), parentState),
    `the inverse patch of node ${child.id} does not restore its parent`,
  );
  return state;
}

export function assertTreeInvariants<S extends object>(
  engine: TimelineEngine<S>,
  checkpointEvery: number,
): void {
  const nodes = new Map(engine.nodes().map((node) => [node.id, node]));
  checkStructure(engine, nodes);
  checkCheckpointPlacement(nodes, engine.rootId, checkpointEvery);
  checkReplay(engine, nodes);
}
