import * as fc from 'fast-check';
import {
  escapeSegment,
  formatPointer,
  joinPointer,
  parsePointer,
  unescapeSegment,
} from './json-pointer';
import { PatchError } from './patch';
import { assertProperty } from './testing/property';

describe('json pointer', () => {
  it('escapes tilde and slash in the right order', () => {
    expect(escapeSegment('a/b~c')).toBe('a~1b~0c');
    expect(escapeSegment('~1')).toBe('~01');
  });

  it('unescapes tilde and slash in the right order', () => {
    expect(unescapeSegment('a~1b~0c')).toBe('a/b~c');
    expect(unescapeSegment('~01')).toBe('~1');
  });

  it('rejects a tilde that is not followed by 0 or 1', () => {
    expect(() => unescapeSegment('a~2')).toThrow(PatchError);
    expect(() => unescapeSegment('a~')).toThrow(PatchError);
  });

  it('parses the empty pointer as the document root', () => {
    expect(parsePointer('')).toEqual([]);
  });

  it('parses segments, including empty ones', () => {
    expect(parsePointer('/a/b')).toEqual(['a', 'b']);
    expect(parsePointer('/')).toEqual(['']);
    expect(parsePointer('//a')).toEqual(['', 'a']);
    expect(parsePointer('/a~1b/c~0d')).toEqual(['a/b', 'c~d']);
  });

  it('rejects a pointer that does not start with a slash', () => {
    expect(() => parsePointer('a/b')).toThrow(PatchError);
  });

  it('joins a pointer with a string or an index', () => {
    expect(joinPointer('', 'a/b')).toBe('/a~1b');
    expect(joinPointer('/list', 3)).toBe('/list/3');
  });

  it('formats segments into a pointer', () => {
    expect(formatPointer([])).toBe('');
    expect(formatPointer(['a', 'b/c'])).toBe('/a/b~1c');
  });

  it('round trips any segments through format and parse', () => {
    assertProperty(
      fc.property(fc.array(fc.string({ maxLength: 6 }), { maxLength: 5 }), (segments) => {
        expect(parsePointer(formatPointer(segments))).toEqual(segments);
      }),
    );
  });

  it('round trips any segment through escape and unescape', () => {
    assertProperty(
      fc.property(fc.string({ unit: fc.constantFrom('a', '~', '/', '0', '1') }), (segment) => {
        expect(unescapeSegment(escapeSegment(segment))).toBe(segment);
      }),
    );
  });
});
