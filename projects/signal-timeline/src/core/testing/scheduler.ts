export interface ManualScheduler {
  schedule(task: () => void): void;
  flush(): void;
  readonly queued: number;
}

export function createManualScheduler(): ManualScheduler {
  const tasks: (() => void)[] = [];
  return {
    schedule(task: () => void): void {
      tasks.push(task);
    },
    flush(): void {
      for (const task of tasks.splice(0)) {
        task();
      }
    },
    get queued(): number {
      return tasks.length;
    },
  };
}
