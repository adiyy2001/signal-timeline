import 'zone.js';
import { provideZoneChangeDetection } from '@angular/core';
import { defineReplaySuite } from './testing/replay-suite';

defineReplaySuite('zone based', [provideZoneChangeDetection()]);

describe('zone based test environment', () => {
  it('runs with zone.js loaded', () => {
    expect(typeof Zone).toBe('function');
  });
});
