import { describe, it, expect } from 'vitest';
import { childTypeOf, renameInList, removeFromList, renameInRecord, removeFromRecord } from './orgTreeOps';

describe('childTypeOf', () => {
  it('maps parent → child type', () => {
    expect(childTypeOf('company')).toBe('location');
    expect(childTypeOf('location')).toBe('group');
    expect(childTypeOf('group')).toBeNull();
  });
});

describe('list ops', () => {
  const list = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  it('renameInList replaces only the matching id, immutably', () => {
    const out = renameInList(list, 'b', 'B2');
    expect(out).toEqual([{ id: 'a', name: 'A' }, { id: 'b', name: 'B2' }]);
    expect(list[1].name).toBe('B'); // original untouched
  });
  it('removeFromList drops the matching id', () => {
    expect(removeFromList(list, 'a')).toEqual([{ id: 'b', name: 'B' }]);
  });
});

describe('record ops', () => {
  const rec = { k1: [{ id: 'x', name: 'X' }], k2: [{ id: 'y', name: 'Y' }] };
  it('renameInRecord renames across all buckets', () => {
    expect(renameInRecord(rec, 'y', 'Y2')).toEqual({ k1: [{ id: 'x', name: 'X' }], k2: [{ id: 'y', name: 'Y2' }] });
  });
  it('removeFromRecord removes across all buckets', () => {
    expect(removeFromRecord(rec, 'x')).toEqual({ k1: [], k2: [{ id: 'y', name: 'Y' }] });
  });
});
