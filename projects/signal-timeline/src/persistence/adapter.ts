/**
 * Where a timeline keeps its history between page loads. The timeline serializes itself to a
 * string, so an adapter only moves text. Every method may be asynchronous.
 */
export interface TimelinePersistenceAdapter {
  /** Returns the stored text, or `null` when nothing is stored. */
  load(): string | null | Promise<string | null>;
  /** Stores the text, replacing what was there. May throw when the storage is full. */
  save(value: string): void | Promise<void>;
  /** Deletes the stored text. */
  remove(): void | Promise<void>;
}

/**
 * How a stored history is brought back.
 *
 * - `history-and-state`: the stored current state is written to the store and the history is
 *   kept. Use it when the timeline is the only thing that restores the state.
 * - `history-if-state-matches`: the stored history is kept only when its current state equals the
 *   state the store has now. Use it when the app restores its state some other way.
 */
export type TimelineRehydrateMode = 'history-and-state' | 'history-if-state-matches';

/**
 * Options for saving and restoring a timeline.
 */
export interface TimelinePersistenceOptions {
  readonly adapter: TimelinePersistenceAdapter;
  /** Defaults to `history-and-state`. */
  readonly rehydrate?: TimelineRehydrateMode;
  /** Milliseconds to wait after the last change before saving. Defaults to 250. */
  readonly debounceMs?: number;
  /**
   * Called with every storage, format and migration error. The timeline keeps working in memory
   * after an error. Without it the error is written to the console as a warning.
   */
  readonly onError?: (error: unknown) => void;
  /**
   * Turns a payload saved in an older format into the current one. It is called only when the
   * stored format number differs from the current one, and its result is validated again.
   */
  readonly migrate?: (payload: unknown, fromFormat: number) => unknown;
}
