import { createLocalStorageAdapter, createSessionStorageAdapter } from './web-storage-adapter';

describe('web storage adapters', () => {
  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('reads, writes and removes in sessionStorage', () => {
    const adapter = createSessionStorageAdapter('history');
    expect(adapter.load()).toBeNull();
    adapter.save('text');
    expect(sessionStorage.getItem('history')).toBe('text');
    expect(adapter.load()).toBe('text');
    adapter.remove();
    expect(adapter.load()).toBeNull();
  });

  it('reads, writes and removes in localStorage', () => {
    const adapter = createLocalStorageAdapter('history');
    adapter.save('text');
    expect(localStorage.getItem('history')).toBe('text');
    expect(sessionStorage.getItem('history')).toBeNull();
    adapter.remove();
    expect(localStorage.getItem('history')).toBeNull();
  });

  it('keeps keys apart', () => {
    createSessionStorageAdapter('one').save('1');
    createSessionStorageAdapter('two').save('2');
    expect(createSessionStorageAdapter('one').load()).toBe('1');
  });

  it('throws when the storage is full so the timeline can report it', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(() => createSessionStorageAdapter('history').save('text')).toThrow(/full/);
  });

  it('looks the storage up on every call, so a blocked storage throws at use', () => {
    const adapter = createSessionStorageAdapter('history');
    const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
    try {
      expect(() => adapter.load()).toThrow(/blocked/);
    } finally {
      if (original !== undefined) {
        Object.defineProperty(globalThis, 'sessionStorage', original);
      }
    }
  });
});
