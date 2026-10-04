import { InjectionToken } from '@angular/core';

export type IdGenerator = (prefix: string) => string;

export const ID_GENERATOR = new InjectionToken<IdGenerator>('ID_GENERATOR', {
  providedIn: 'root',
  factory: () => (prefix) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`,
});
