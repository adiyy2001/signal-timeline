/**
 * Undo, redo, transactions, a branching undo tree and history shared across stores for NgRx
 * SignalStore. History is kept as patches, so memory stays small on large states.
 *
 * Start with `withTimeline`. Use `skipReplay` and `ignoreReplays` to keep side effects from
 * running while history is replayed, `provideTimelineGroup` to share one history between stores,
 * and the storage adapters to keep history across a reload. The time travel panel is in
 * `signal-timeline/devtools`.
 *
 * @packageDocumentation
 * @module signal-timeline
 */

export type {
  AddOperation,
  JsonValue,
  Operation,
  Patch,
  RemoveOperation,
  ReplaceOperation,
} from './core/patch';
export { TimelineError } from './core/engine';
export { withTimeline } from './store/with-timeline';
export { ignoreReplays, skipReplay } from './store/replay';
export type { ReplayAware } from './store/replay';
export type {
  TimelineChange,
  TimelineCoalesceOptions,
  TimelineEntry,
  TimelineEntryPatches,
  TimelineGroupMemberOptions,
  TimelineKeyOptions,
  TimelineOptions,
  TimelineSharedOptions,
  TimelineStandaloneOptions,
} from './store/options';
export type { TimelineMethods, TimelineProps, TimelineSource } from './store/timeline-api';
export type { TimelineFeatureResult } from './store/with-timeline';
export { TimelineGroup } from './group/timeline-group';
export type { TimelineGroupOptions } from './group/timeline-group';
export { provideTimelineGroup } from './group/provide-timeline-group';
export type {
  TimelinePersistenceAdapter,
  TimelinePersistenceOptions,
  TimelineRehydrateMode,
} from './persistence/adapter';
export {
  createLocalStorageAdapter,
  createSessionStorageAdapter,
} from './persistence/web-storage-adapter';
