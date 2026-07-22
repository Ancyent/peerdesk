import { describe, it, expect } from 'vitest';
import { buildPickerNodes, filterNodes, placementFor, type PickerNode } from './treePicker';
import type { CompanyOut, LocationOut, GroupOut } from '../api/client';

const co = (id: string, name: string): CompanyOut => ({ id, name, created_at: '' });
const loc = (id: string, name: string, company_id: string): LocationOut => ({ id, name, company_id, created_at: '' });
const grp = (id: string, name: string, location_id: string): GroupOut => ({ id, name, location_id, created_at: '' });

// Company A [ Cluj [ Production, Accounting ] ], Company B [ ]
const companies = [co('a', 'Client A'), co('b', 'Client B')];
const locsByCo = { a: [loc('a1', 'Cluj', 'a')] };
const grpsByLoc = { a1: [grp('a1x', 'Production', 'a1'), grp('a1y', 'Accounting', 'a1')] };

const build = () => buildPickerNodes(companies, locsByCo, grpsByLoc);
const byKey = (nodes: PickerNode[], key: string) => nodes.find(n => n.key === key)!;

describe('buildPickerNodes', () => {
  it('flattens depth-first: company, its locations, each location groups', () => {
    expect(build().map(n => n.key)).toEqual([
      'company:a', 'location:a1', 'group:a1x', 'group:a1y', 'company:b',
    ]);
  });

  it('assembles the full path root-first at every level', () => {
    const nodes = build();
    expect(byKey(nodes, 'company:a').path).toEqual(['Client A']);
    expect(byKey(nodes, 'location:a1').path).toEqual(['Client A', 'Cluj']);
    expect(byKey(nodes, 'group:a1x').path).toEqual(['Client A', 'Cluj', 'Production']);
  });

  it('sets parentKey so ancestors are walkable for search', () => {
    const nodes = build();
    expect(byKey(nodes, 'company:a').parentKey).toBeNull();
    expect(byKey(nodes, 'location:a1').parentKey).toBe('company:a');
    expect(byKey(nodes, 'group:a1x').parentKey).toBe('location:a1');
  });
});

describe('placementFor', () => {
  it('a company node sends only company_id', () => {
    expect(placementFor(byKey(build(), 'company:a'))).toEqual({ company_id: 'a' });
  });
  it('a location node sends company + location', () => {
    expect(placementFor(byKey(build(), 'location:a1'))).toEqual({ company_id: 'a', location_id: 'a1' });
  });
  it('a group node sends the full consistent triple', () => {
    expect(placementFor(byKey(build(), 'group:a1x')))
      .toEqual({ company_id: 'a', location_id: 'a1', group_id: 'a1x' });
  });
});

describe('filterNodes', () => {
  it('an empty query shows every node', () => {
    const nodes = build();
    expect(filterNodes(nodes, '').size).toBe(nodes.length);
    expect(filterNodes(nodes, '   ').size).toBe(nodes.length);
  });

  it('a group match shows the group and its ancestors, and nothing else', () => {
    // "Production" is under Client A / Cluj. Its siblings (Accounting) and the
    // unrelated Client B must be absent, or the search leaks the rest of the tree.
    expect(filterNodes(build(), 'produc')).toEqual(
      new Set(['group:a1x', 'location:a1', 'company:a']),
    );
  });

  it('is case-insensitive', () => {
    expect(filterNodes(build(), 'CLIENT B')).toEqual(new Set(['company:b']));
  });

  it('a company match does not pull in its descendants', () => {
    // Matching a company shows only the company; a machine is placed at whatever
    // node you pick, so descendants should not appear just because their parent
    // matched by name.
    expect(filterNodes(build(), 'Client A')).toEqual(new Set(['company:a']));
  });
});
