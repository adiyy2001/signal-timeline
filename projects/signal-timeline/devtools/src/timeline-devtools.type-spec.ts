import { expectTypeOf } from 'expect-type';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { withTimeline, type TimelineGroup, type TimelineSource } from 'signal-timeline';
import type {
  TimelineDevtoolsComponent,
  TimelineDevtoolsTheme,
} from './timeline-devtools.component';

interface State {
  readonly count: number;
}

export const WithTimeline = signalStore(
  withState<State>({ count: 0 }),
  withTimeline(),
  withMethods((store) => ({ set: (count: number) => patchState(store, { count }) })),
);

export const WithoutTimeline = signalStore(
  withState<State>({ count: 0 }),
  withMethods((store) => ({ set: (count: number) => patchState(store, { count }) })),
);

type TimelineInput = ReturnType<TimelineDevtoolsComponent['timeline']>;

describe('TimelineDevtoolsComponent input types', () => {
  it('takes a TimelineSource', () => {
    expectTypeOf<TimelineInput>().toEqualTypeOf<TimelineSource>();
  });

  it('accepts a store with the feature and a timeline group', () => {
    expectTypeOf<InstanceType<typeof WithTimeline>>().toExtend<TimelineInput>();
    expectTypeOf<TimelineGroup>().toExtend<TimelineInput>();
  });

  it('rejects a store without the feature and objects that miss a member', () => {
    expectTypeOf<InstanceType<typeof WithoutTimeline>>().not.toExtend<TimelineInput>();
    expectTypeOf<object>().not.toExtend<TimelineInput>();
    expectTypeOf<Omit<InstanceType<typeof WithTimeline>, 'jumpTo'>>().not.toExtend<TimelineInput>();
    expectTypeOf<
      Omit<InstanceType<typeof WithTimeline>, 'entries'>
    >().not.toExtend<TimelineInput>();
  });

  it('limits the theme to auto, light and dark', () => {
    expectTypeOf<TimelineDevtoolsTheme>().toEqualTypeOf<'auto' | 'light' | 'dark'>();
    expectTypeOf<
      ReturnType<TimelineDevtoolsComponent['theme']>
    >().toEqualTypeOf<TimelineDevtoolsTheme>();
  });
});
