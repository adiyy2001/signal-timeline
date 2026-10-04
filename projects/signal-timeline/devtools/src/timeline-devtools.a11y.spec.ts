import axe from 'axe-core';
import { branchingStore, mountDevtools, settle, untouchedStore } from './testing/devtools-fixture';

const rules = {
  'color-contrast': { enabled: false },
  region: { enabled: false },
  'page-has-heading-one': { enabled: false },
};

async function violationsOf(element: HTMLElement): Promise<string[]> {
  const result = await axe.run(element, { rules });
  return result.violations.map((violation) => `${violation.id}: ${violation.help}`);
}

describe('TimelineDevtoolsComponent accessibility', () => {
  it('has no axe violations with branches', async () => {
    const fixture = mountDevtools(branchingStore());
    expect(await violationsOf(fixture.nativeElement as HTMLElement)).toEqual([]);
  });

  it('has no axe violations with an untouched history', async () => {
    const fixture = mountDevtools(untouchedStore());
    expect(await violationsOf(fixture.nativeElement as HTMLElement)).toEqual([]);
  });

  it('has no axe violations while a branch is collapsed and the dark theme is forced', async () => {
    const store = branchingStore();
    const fixture = mountDevtools(store);
    fixture.componentRef.setInput('theme', 'dark');
    store.jumpTo(2);
    await settle(fixture);
    const host = fixture.nativeElement as HTMLElement;
    host
      .querySelector('[data-node-id="2"]')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    await settle(fixture);
    expect(await violationsOf(host)).toEqual([]);
  });

  it('actually runs the rules it claims to check', async () => {
    const fixture = mountDevtools(branchingStore());
    const result = await axe.run(fixture.nativeElement as HTMLElement, { rules });
    const checked = result.passes.map((pass) => pass.id);
    expect(checked).toEqual(expect.arrayContaining(['aria-valid-attr', 'aria-roles']));
  });
});
