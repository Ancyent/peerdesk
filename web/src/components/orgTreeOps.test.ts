import { describe, it, expect } from 'vitest';
import { childTypeOf, renameInList, removeFromList, renameInRecord, removeFromRecord, coveredBy } from './orgTreeOps';
import type { GrantOut } from '../api/client';

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

describe('coveredBy', () => {
  const grants: GrantOut[] = [
    { id: 'g1', company_id: 'co-A', location_id: null, group_id: null, machine_id: null, created_at: '' },
  ];

  it('marks the granted node itself as directly checked', () => {
    expect(coveredBy(grants, { type: 'company', id: 'co-A' }))
      .toEqual({ checked: true, via: null });
  });

  it('marks a descendant as checked and names the grant above it', () => {
    // Without `via`, the UI renders this identically to a direct grant, and
    // unchecking it appears to work while changing nothing.
    expect(coveredBy(grants, { type: 'location', id: 'loc-A1', companyId: 'co-A' }))
      .toEqual({ checked: true, via: 'co-A' });
  });

  it('leaves an unrelated node unchecked', () => {
    expect(coveredBy(grants, { type: 'company', id: 'co-B' }))
      .toEqual({ checked: false, via: null });
  });

  it('names the nearest ancestor when several ancestors are granted at once', () => {
    const multi: GrantOut[] = [
      { id: 'g1', company_id: 'co-A', location_id: null, group_id: null, machine_id: null, created_at: '' },
      { id: 'g2', company_id: null, location_id: 'loc-A1', group_id: null, machine_id: null, created_at: '' },
    ];
    // grp-1 sits under loc-A1, which sits under co-A. Both ancestors are
    // granted -- `via` must name the closer one (the location), not the
    // company, or an admin unchecking "via co-A" would be misled about which
    // grant actually needs revoking.
    expect(coveredBy(multi, { type: 'group', id: 'grp-1', companyId: 'co-A', locationId: 'loc-A1' }))
      .toEqual({ checked: true, via: 'loc-A1' });
  });

  it('a grant on one location does not leak to a sibling location under the same company', () => {
    const grantOnLocation: GrantOut[] = [
      { id: 'g1', company_id: null, location_id: 'loc-B1', group_id: null, machine_id: null, created_at: '' },
    ];
    expect(coveredBy(grantOnLocation, { type: 'machine', id: 'm-1', companyId: 'co-B', locationId: 'loc-B1', groupId: 'grp-B1' }))
      .toEqual({ checked: true, via: 'loc-B1' });
    // A different machine in a sibling location under the same company must
    // stay uncovered -- `via` naming the wrong ancestor here would report
    // access that was never granted.
    expect(coveredBy(grantOnLocation, { type: 'machine', id: 'm-2', companyId: 'co-B', locationId: 'loc-B2', groupId: null }))
      .toEqual({ checked: false, via: null });
  });

  it('names the group ahead of the location and company when all three are granted', () => {
    const stacked: GrantOut[] = [
      { id: 'g1', company_id: 'co-C', location_id: null, group_id: null, machine_id: null, created_at: '' },
      { id: 'g2', company_id: null, location_id: 'loc-C1', group_id: null, machine_id: null, created_at: '' },
      { id: 'g3', company_id: null, location_id: null, group_id: 'grp-C1', machine_id: null, created_at: '' },
    ];
    expect(coveredBy(stacked, { type: 'machine', id: 'm-1', companyId: 'co-C', locationId: 'loc-C1', groupId: 'grp-C1' }))
      .toEqual({ checked: true, via: 'grp-C1' });
  });

  it('a direct grant on the node itself wins even when an ancestor is also granted', () => {
    const both: GrantOut[] = [
      { id: 'g1', company_id: 'co-D', location_id: null, group_id: null, machine_id: null, created_at: '' },
      { id: 'g2', company_id: null, location_id: 'loc-D1', group_id: null, machine_id: null, created_at: '' },
    ];
    expect(coveredBy(both, { type: 'location', id: 'loc-D1', companyId: 'co-D' }))
      .toEqual({ checked: true, via: null });
  });

  it('a machine grant does not cover its own group, location, or company', () => {
    const machineOnly: GrantOut[] = [
      { id: 'g1', company_id: null, location_id: null, group_id: null, machine_id: 'm-1', created_at: '' },
    ];
    expect(coveredBy(machineOnly, { type: 'group', id: 'grp-E1', companyId: 'co-E', locationId: 'loc-E1' }))
      .toEqual({ checked: false, via: null });
    expect(coveredBy(machineOnly, { type: 'location', id: 'loc-E1', companyId: 'co-E' }))
      .toEqual({ checked: false, via: null });
    expect(coveredBy(machineOnly, { type: 'company', id: 'co-E' }))
      .toEqual({ checked: false, via: null });
  });
});
