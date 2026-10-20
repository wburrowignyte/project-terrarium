// push-plan (§5b): ERD.md model (+ lucid.json + a fresh snapshot) -> ops -> batches.

import { layoutDiagram } from '../../erd-view/lib/layout.mjs';
import { fieldToRow, relEnds, entitySize, diffModels, fromBaseline, KIND_COLORS } from './model.mjs';
import { normalizeSnapshot } from './snapshot.mjs';

export const INFLATE = 200; // layout slack per node, so tables end up >=160px apart (the erds clearance rule) with room for a frame
export const DEFAULT_BATCH = 40;

const rowsOf = (e) => e.fields.map(fieldToRow);
const entityData = (e) => ({ id: e.id, table: e.table, kind: e.kind, group: e.group, sensitivity: e.sensitivity ?? '', purpose: e.purpose ?? '' });

export const headerText = (n, date) => `${n.title} · ERD v${n.version} · pushed ${date} · managed by project-terrarium. Edit tables, fields, lines and the shape data; move anything. Citations live in ERD.md.`;

function relOp(r, op) {
  const e = relEnds(r);
  return { op, id: r.id, primary: r.to, foreign: r.from, primaryColumn: r.pk, foreignColumn: r.fk, pc: e.primary, fc: e.foreign };
}

function chunk(ops, size) {
  const out = [];
  for (let i = 0; i < ops.length; i += size) out.push(ops.slice(i, i + size));
  return out;
}

export function firstPush(n, { batchSize = DEFAULT_BATCH, date }) {
  const sized = new Map(n.entities.map((e) => [e.id, entitySize(e)]));
  const nodes = n.entities.map((e) => ({ id: e.id, kind: e.kind, group: e.group, w: sized.get(e.id).w + INFLATE, h: sized.get(e.id).h + INFLATE }));
  const edges = n.relationships.map((r) => ({ id: r.id, from: r.from, to: r.to, cardinality: r.cardinality }));
  const out = layoutDiagram(nodes, edges, n.groups, { mode: 'grouped', lazy: true, bandBudget: 3200 });
  const at = new Map(nodes.map((x) => [x.id, { x: Math.round(x.x + INFLATE / 2), y: Math.round(x.y + INFLATE / 2) }]));
  const minY = Math.min(...[...at.values()].map((p) => p.y));
  const entOps = n.entities.map((e) => ({ op: 'create-entity', ...entityData(e), rows: rowsOf(e), columnWidths: sized.get(e.id).columnWidths, ...at.get(e.id) }));
  const relOps = n.relationships.map((r) => relOp(r, 'create-rel'));
  const groups = [...new Set(n.entities.filter((e) => e.group).map((e) => e.group))].map((name) => ({ name, ids: n.entities.filter((e) => e.group === name).map((e) => e.id) }));
  const finalize = { op: 'finalize', groups, header: headerText(n, date), hx: 0, hy: minY - 360 };
  const batches = [...chunk(entOps, batchSize), ...chunk(relOps, batchSize), [finalize]];
  return { mode: 'first', batches, layout: { bands: out.bands, rows: out.rows }, positions: Object.fromEntries(at), counts: { entities: entOps.length, relationships: relOps.length } };
}

// Changes in the Lucid doc that were not pulled yet: the snapshot against what lucid.json last saw.
export function unpulled(snapshot, state) {
  const base = fromBaseline(state.baseline);
  const seen = state.seen ? fromBaseline(state.seen) : base;
  const now = normalizeSnapshot(snapshot, seen);
  return diffModels(seen, now, { lenient: true });
}

export function incrementalPush(n, state, snapshot, { batchSize = DEFAULT_BATCH, date }) {
  const now = normalizeSnapshot(snapshot, n, { adopt: true });
  const warnings = [...now.warnings];
  const ours = { entities: n.entities.map((e) => ({ ...e, key: e.id })), relationships: n.relationships };
  const changes = diffModels(now, ours);
  const entById = new Map(n.entities.map((e) => [e.id, e]));
  const lucidById = new Map(now.entities.filter((e) => e.id).map((e) => [e.id, e]));
  const summary = { 'create-entity': 0, 'adopt-entity': 0, 'delete-entity': 0, 'update-entity': 0, 'add-field': 0, 'remove-field': 0, 'update-field': 0, 'move-field': 0, 'create-rel': 0, 'delete-rel': 0, 'update-rel': 0 };
  const removed = new Set(changes.filter((c) => c.k === 'entity-' && c.id).map((c) => c.id));
  const ops = [], synced = new Set(), created = new Set(), renamed = new Set(), attrTouched = new Set();

  for (const c of changes) {
    if (c.k !== 'rel-') continue;
    if (!c.id) { warnings.push(`Lucid has a line (${c.r.from} → ${c.r.to} via ${c.r.fk}) that is not in ERD.md; left alone`); continue; }
    if (removed.has(c.r.from) || removed.has(c.r.to)) continue; // deleting the entity takes its lines
    ops.push({ op: 'delete-rel', id: c.id, lineId: c.r.lineId }); summary['delete-rel']++;
  }
  for (const c of changes) {
    if (c.k !== 'entity-') continue;
    if (!c.id) { warnings.push(`Lucid has a table "${c.e.table}" that is not in ERD.md; left alone`); continue; }
    ops.push({ op: 'delete-entity', id: c.id }); summary['delete-entity']++;
  }
  for (const e of now.entities) if (e.adopted) { // stamp the table a person drew and a pull accepted
    ops.push({ op: 'adopt-entity', ...entityData(entById.get(e.id)), lucidId: e.lucidId }); summary['adopt-entity']++; attrTouched.add(e.id);
  }
  for (const c of changes) if (c.k === 'entity~') { attrTouched.add(c.id); if (c.attr === 'table') renamed.add(c.id); }
  for (const e of now.entities) { // the header colour follows Kind: fix it when it is stale (only when the snapshot reports it)
    const mine = entById.get(e.id);
    if (mine && e.shading !== undefined && (KIND_COLORS[mine.kind] ?? null) !== e.shading) attrTouched.add(e.id);
  }
  for (const id of attrTouched) {
    if (ops.some((o) => o.op === 'adopt-entity' && o.id === id)) continue;
    ops.push({ op: 'update-entity', ...entityData(entById.get(id)), rename: renamed.has(id) }); summary['update-entity']++;
  }
  for (const c of changes) {
    if (c.k !== 'entity+' || !entById.has(c.id)) continue;
    const e = entById.get(c.id);
    ops.push({ op: 'create-entity', ...entityData(e), rows: rowsOf(e), columnWidths: entitySize(e).columnWidths, place: true });
    summary['create-entity']++; summary['add-field'] += e.fields.length; created.add(e.id);
  }
  for (const c of changes) { // a field change on an existing entity re-syncs that entity's rows by name
    if (!c.k.startsWith('field') || created.has(c.id)) continue;
    synced.add(c.id);
    summary[c.k === 'field+' ? 'add-field' : c.k === 'field-' ? 'remove-field' : 'update-field']++;
  }
  for (const e of ours.entities) { // rows reordered in ERD.md only
    const shape = lucidById.get(e.id);
    if (!shape || synced.has(e.id) || created.has(e.id)) continue;
    const want = e.fields.map((f) => f.column), have = shape.fields.map((f) => f.column).filter((c) => want.includes(c));
    if (have.some((c, i) => c !== want[i])) synced.add(e.id);
  }
  for (const id of synced) {
    const want = rowsOf(entById.get(id)), have = lucidById.get(id).fields.map((f) => f.column).filter((c) => want.some((r) => r.name === c));
    const order = want.map((r) => r.name).filter((c) => have.includes(c));
    if (have.some((c, i) => c !== order[i])) summary['move-field']++;
    ops.push({ op: 'sync-fields', id, rows: want });
  }
  for (const e of now.entities) { // adopted tables: reconcile their rows too
    if (!e.adopted || synced.has(e.id)) continue;
    const want = rowsOf(entById.get(e.id));
    if (JSON.stringify(e.fields.map(fieldToRow)) !== JSON.stringify(want)) { ops.push({ op: 'sync-fields', id: e.id, rows: want }); synced.add(e.id); }
  }
  const relDone = new Set();
  for (const c of changes) {
    if (c.k === 'rel+') { ops.push(relOp(c.r, 'create-rel')); summary['create-rel']++; relDone.add(c.id); }
    else if (c.k === 'rel~' && !relDone.has(c.id)) { ops.push({ ...relOp(ours.relationships.find((r) => r.id === c.id), 'update-rel'), lineId: c.x.lineId }); summary['update-rel']++; relDone.add(c.id); }
  }
  const moved = new Set([...synced, ...created]);
  for (const r of ours.relationships) { // an end somebody (or Lucid's rerouting) attached to another row of the parent: pin it back to the PK
    const l = now.relationships.find((x) => x.id === r.id);
    if (l && !relDone.has(r.id) && l.pk !== r.pk) { ops.push({ ...relOp(r, 'update-rel'), lineId: l.lineId }); summary['update-rel']++; relDone.add(r.id); }
  }
  for (const r of ours.relationships) { // lines pinned to rows that moved
    if (relDone.has(r.id) || !(moved.has(r.from) || moved.has(r.to))) continue;
    const l = now.relationships.find((x) => x.id === r.id);
    if (l) ops.push({ ...relOp(r, 'update-rel'), lineId: l.lineId });
  }
  const touched = ops.filter((o) => o.op === 'create-rel' || o.op === 'update-rel').map((o) => o.id);
  if (touched.length) ops.push({ op: 'reroute', ids: touched });
  if (ops.length) ops.push({ op: 'update-header', header: headerText(n, date) });
  return { mode: 'incremental', ops, batches: chunk(ops, batchSize), summary, warnings, counts: Object.fromEntries(Object.entries(summary).filter(([, v]) => v)) };
}
