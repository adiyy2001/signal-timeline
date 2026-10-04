import { PatchError } from './patch';

export function escapeSegment(segment: string): string {
  return segment.replaceAll('~', '~0').replaceAll('/', '~1');
}

export function unescapeSegment(segment: string): string {
  if (/~(?![01])/.test(segment)) {
    throw new PatchError(`Invalid escape sequence in pointer segment "${segment}"`);
  }
  return segment.replaceAll('~1', '/').replaceAll('~0', '~');
}

export function joinPointer(pointer: string, segment: string | number): string {
  return `${pointer}/${typeof segment === 'number' ? segment : escapeSegment(segment)}`;
}

export function formatPointer(segments: readonly string[]): string {
  return segments.map((segment) => `/${escapeSegment(segment)}`).join('');
}

export function parsePointer(pointer: string): string[] {
  if (pointer === '') {
    return [];
  }
  if (!pointer.startsWith('/')) {
    throw new PatchError(`A pointer must be empty or start with "/": "${pointer}"`, {
      path: pointer,
    });
  }
  return pointer.slice(1).split('/').map(unescapeSegment);
}
