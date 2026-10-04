import { TestBed } from '@angular/core/testing';
import { TimelineGroup, provideTimelineGroup } from 'signal-timeline';
import { createLayoutStore, createShapesStore } from '../../src/group/testing/stores';
import { itemFor, mountDevtools, press, settle, treeItems } from './testing/devtools-fixture';

describe('TimelineDevtoolsComponent with a timeline group', () => {
  function setup() {
    TestBed.configureTestingModule({ providers: [provideTimelineGroup()] });
    const shapes = TestBed.inject(createShapesStore());
    const layout = TestBed.inject(createLayoutStore());
    const group = TestBed.inject(TimelineGroup);
    group.transaction('Add and zoom', () => {
      shapes.add('rect');
      layout.setZoom(2);
    });
    shapes.add('ellipse');
    return { shapes, layout, group };
  }

  it('shows the entries of the group and the stores each entry touched', async () => {
    const { group } = setup();
    const fixture = mountDevtools(group);
    const host = fixture.nativeElement as HTMLElement;
    expect(treeItems(host)).toHaveLength(3);
    expect(itemFor(host, 2).getAttribute('aria-label')).toContain('Changed: shapes, layout.');
    expect(itemFor(host, 3).getAttribute('aria-label')).toContain('Changed: shapes.');
    itemFor(host, 2).focus();
    await settle(fixture);
    const rows = Array.from(host.querySelectorAll('tbody tr')).map((row) =>
      row.querySelector('.path')?.textContent?.trim(),
    );
    expect(rows).toEqual(['/shapes/items/0', '/layout/zoom']);
  });

  it('time travels every store of the group at once', async () => {
    const { group, shapes, layout } = setup();
    const fixture = mountDevtools(group);
    const host = fixture.nativeElement as HTMLElement;
    press(itemFor(host, 1), 'Enter');
    await settle(fixture);
    expect(shapes.items()).toEqual([]);
    expect(layout.zoom()).toBe(1);
    press(itemFor(host, 2), 'Enter');
    expect(shapes.items()).toEqual(['rect']);
    expect(layout.zoom()).toBe(2);
  });
});
