import { equal } from './runner.mjs';

export const groupChecks = [
  {
    area: 'group',
    name: 'one undo reverts an action that touched two stores',
    run: async (context) => {
      const {
        signalStore,
        withState,
        withMethods,
        patchState,
        TimelineGroup,
        provideTimelineGroup,
        withTimeline,
        application,
      } = context;
      const First = signalStore(
        { providedIn: 'root' },
        withState({ n: 0 }),
        withTimeline({ group: true, storeKey: 'first' }),
        withMethods((store) => ({ inc: () => patchState(store, (s) => ({ n: s.n + 1 })) })),
      );
      const Second = signalStore(
        { providedIn: 'root' },
        withState({ m: 0 }),
        withTimeline({ group: true, storeKey: 'second' }),
        withMethods((store) => ({ inc: () => patchState(store, (s) => ({ m: s.m + 1 })) })),
      );
      const { get } = await application([provideTimelineGroup()]);
      const first = get(First);
      const second = get(Second);
      const group = get(TimelineGroup);
      group.transaction('both stores', () => {
        first.inc();
        second.inc();
      });
      equal(group.entries().length, 2, 'one entry for the action');
      equal(
        [...group.entries()[1].changedKeys].sort(),
        ['first', 'second'],
        'the entry names both stores',
      );
      group.undo();
      equal([first.n(), second.m()], [0, 0], 'one undo reverts both stores');
      group.redo();
      equal([first.n(), second.m()], [1, 1], 'one redo restores both');
      first.undo();
      equal([first.n(), second.m()], [0, 0], 'a member store undoes through the shared history');
    },
  },
];
