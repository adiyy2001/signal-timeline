import { diffRows, formatPath, formatValue } from './format-operation';

describe('formatValue', () => {
  it('prints JSON for plain values', () => {
    expect(formatValue({ a: [1, 'x'] })).toEqual({
      present: true,
      text: '{"a":[1,"x"]}',
      full: '{"a":[1,"x"]}',
      truncated: false,
    });
    expect(formatValue('text').text).toBe('"text"');
    expect(formatValue(null).text).toBe('null');
  });

  it('prints undefined and values JSON cannot represent', () => {
    expect(formatValue(undefined).text).toBe('undefined');
    expect(formatValue(() => 1).text).toContain('=>');
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(formatValue(circular).text).toBe('[not serializable]');
  });

  it('cuts long values and keeps the whole text', () => {
    const value = formatValue('x'.repeat(200), 20);
    expect(value.truncated).toBe(true);
    expect(value.text).toHaveLength(23);
    expect(value.text.endsWith('...')).toBe(true);
    expect(value.full).toBe(JSON.stringify('x'.repeat(200)));
  });
});

describe('formatPath', () => {
  it('names the empty path', () => {
    expect(formatPath('')).toBe('(whole state)');
    expect(formatPath('/shapes/3/x')).toBe('/shapes/3/x');
  });
});

describe('diffRows', () => {
  it('pairs each forward operation with the inverse that undoes it', () => {
    const rows = diffRows({
      forward: [
        { op: 'replace', path: '/count', value: 2 },
        { op: 'add', path: '/tags/0', value: 'a' },
        { op: 'remove', path: '/title' },
      ],
      inverse: [
        { op: 'add', path: '/title', value: 'start' },
        { op: 'remove', path: '/tags/0' },
        { op: 'replace', path: '/count', value: 1 },
      ],
    });
    expect(rows.map((row) => [row.operation, row.path])).toEqual([
      ['replace', '/count'],
      ['add', '/tags/0'],
      ['remove', '/title'],
    ]);
    expect(rows[0].before.text).toBe('1');
    expect(rows[0].after.text).toBe('2');
    expect(rows[1].before.present).toBe(false);
    expect(rows[1].after.text).toBe('"a"');
    expect(rows[2].before.text).toBe('"start"');
    expect(rows[2].after.present).toBe(false);
  });

  it('gives no before values when the patches do not line up', () => {
    const rows = diffRows({
      forward: [{ op: 'replace', path: '/a', value: 1 }],
      inverse: [],
    });
    expect(rows[0].before.present).toBe(false);
    expect(rows[0].after.text).toBe('1');
  });

  it('returns no rows for empty patches', () => {
    expect(diffRows({ forward: [], inverse: [] })).toEqual([]);
  });
});
