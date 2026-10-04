import type { Provider } from '@angular/core';
import { TimelineGroup, type TimelineGroupOptions } from './timeline-group';

/**
 * Provides one shared timeline. Put it where the member stores are provided, for example in
 * the application config, or in the `providers` of a component and its stores together.
 */
export function provideTimelineGroup(options: TimelineGroupOptions = {}): Provider {
  return { provide: TimelineGroup, useFactory: () => new TimelineGroup(options) };
}
