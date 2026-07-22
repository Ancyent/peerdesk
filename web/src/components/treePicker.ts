import type { CompanyOut, LocationOut, GroupOut } from '../api/client';

/** A single pickable node in the flattened placement tree. `path` is the chain
 *  of names from the root company down to and including this node, so the closed
 *  field can render "Client A / Cluj / Producție". The placement triple
 *  (`company_id`/`location_id`/`group_id`) is precomputed as a consistent path
 *  down the tree, which is exactly what the server's assert_placement_consistent
 *  requires — the picker can never assemble an inconsistent triple. */
export interface PickerNode {
  key: string;                 // "company:<id>" | "location:<id>" | "group:<id>"
  type: 'company' | 'location' | 'group';
  id: string;
  name: string;
  path: string[];              // ancestor names + own name, root first
  depth: number;               // 0 company, 1 location, 2 group
  company_id: string;
  location_id: string | null;
  group_id: string | null;
  parentKey: string | null;    // the key of the immediate ancestor, for search
}

export interface Placement {
  company_id?: string;
  location_id?: string;
  group_id?: string;
}

const keyOf = (type: PickerNode['type'], id: string) => `${type}:${id}`;

/** Flattens the three loaded levels into one ordered, depth-first list. Order
 *  is: each company, then its locations, then each location's groups — the same
 *  order the tree renders, so the flat list and the visual tree agree. */
export function buildPickerNodes(
  companies: CompanyOut[],
  locationsByCompany: Record<string, LocationOut[]>,
  groupsByLocation: Record<string, GroupOut[]>,
): PickerNode[] {
  const nodes: PickerNode[] = [];
  for (const co of companies) {
    const coKey = keyOf('company', co.id);
    nodes.push({
      key: coKey, type: 'company', id: co.id, name: co.name,
      path: [co.name], depth: 0,
      company_id: co.id, location_id: null, group_id: null, parentKey: null,
    });
    for (const loc of locationsByCompany[co.id] ?? []) {
      const locKey = keyOf('location', loc.id);
      nodes.push({
        key: locKey, type: 'location', id: loc.id, name: loc.name,
        path: [co.name, loc.name], depth: 1,
        company_id: co.id, location_id: loc.id, group_id: null, parentKey: coKey,
      });
      for (const grp of groupsByLocation[loc.id] ?? []) {
        nodes.push({
          key: keyOf('group', grp.id), type: 'group', id: grp.id, name: grp.name,
          path: [co.name, loc.name, grp.name], depth: 2,
          company_id: co.id, location_id: loc.id, group_id: grp.id, parentKey: locKey,
        });
      }
    }
  }
  return nodes;
}

/** The set of node keys to show for a search query. An empty/whitespace query
 *  returns every key. Otherwise it returns nodes whose own name matches
 *  (case-insensitive substring) plus all of their ancestors, so a matching group
 *  still shows its location and company and the path stays legible — the same
 *  ancestor-visibility rule the member tree uses. Nothing else is included, so
 *  the picker can never surface a node the loaded (already access-filtered) tree
 *  did not contain. */
export function filterNodes(nodes: PickerNode[], query: string): Set<string> {
  const q = query.trim().toLowerCase();
  if (!q) return new Set(nodes.map(n => n.key));

  const byKey = new Map(nodes.map(n => [n.key, n]));
  const show = new Set<string>();
  for (const n of nodes) {
    if (!n.name.toLowerCase().includes(q)) continue;
    show.add(n.key);
    let parent = n.parentKey;
    while (parent && !show.has(parent)) {
      show.add(parent);
      parent = byKey.get(parent)?.parentKey ?? null;
    }
  }
  return show;
}

/** The placement triple to send for a chosen node. A company node sends only
 *  company_id; a location node sends company+location; a group node sends all
 *  three. Ancestors come straight from the node, so the result is always a
 *  consistent path. */
export function placementFor(node: PickerNode): Placement {
  const p: Placement = { company_id: node.company_id };
  if (node.location_id) p.location_id = node.location_id;
  if (node.group_id) p.group_id = node.group_id;
  return p;
}
