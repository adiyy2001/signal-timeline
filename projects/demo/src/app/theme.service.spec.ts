import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';

const storageKey = 'signal-timeline-demo-theme';

function open(): ThemeService {
  TestBed.resetTestingModule();
  const service = TestBed.inject(ThemeService);
  TestBed.tick();
  return service;
}

describe('ThemeService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('starts on auto and leaves the attribute off', () => {
    const service = open();
    expect(service.choice()).toBe('auto');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('cycles auto, light, dark and back, and sets the attribute', () => {
    const service = open();
    service.next();
    TestBed.tick();
    expect(service.choice()).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    service.next();
    TestBed.tick();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    service.next();
    TestBed.tick();
    expect(service.choice()).toBe('auto');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('remembers the choice and ignores junk in storage', () => {
    open().next();
    TestBed.tick();
    expect(localStorage.getItem(storageKey)).toBe('light');
    expect(open().choice()).toBe('light');
    localStorage.setItem(storageKey, 'purple');
    expect(open().choice()).toBe('auto');
  });

  it('keeps working when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const service = open();
    service.next();
    TestBed.tick();
    expect(service.choice()).toBe('light');
  });
});
