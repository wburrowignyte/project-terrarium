// The Lucid side of the sync: the read-only snapshot script (§6a) and the normalization of its output.

import { rowToField, fieldToRow, endsToRel, relEnds, sigOf, unclean, KIND_COLORS } from './model.mjs';

export const SNAPSHOT_SCRIPT = `// project-terrarium erd-lucid: read-only snapshot of the ERD on the current page
const erds = skills.erds, fm = skills.formulas;
const dataOf = (id) => { const o = {}; try { for (const x of fm.listShapeDataFields(id)) o[x.name] = x.value; } catch (e) {} return o; };
const out = { takenAt: new Date().toISOString(), entities: [], relationships: [] };
for (const s of erds.list()) {
  const e = erds.read(s.id);
  const d = dataOf(s.id);
  out.entities.push({
    lucidId: s.id, name: e.name, boundingBox: e.boundingBox, headerShading: e.headerShading,
    shapeData: { ERD_ID: d.ERD_ID, Kind: d.Kind, Group: d.Group, Sensitivity: d.Sensitivity, Purpose: d.Purpose },
    fields: e.fields.map((f) => ({ index: f.index, name: f.name, key: f.key ?? '', type: f.type ?? '', nullable: f.nullable !== false })),
  });
}
for (const r of erds.listRelationships()) {
  const end = (x) => ({ entityId: x.entityId, fieldIndex: x.fieldIndex, fieldName: x.fieldName, cardinality: x.cardinality });
  out.relationships.push({ lineId: r.lineId, erdId: dataOf(r.lineId).ERD_ID, primary: end(r.primary), foreign: end(r.foreign) });
}
return out;
`;

// Snapshot -> the same shape as normalizeErd (entities with key/id/fields, relationships with id/from/to/fk/pk).
// ref (the baseline, or ERD.md when pushing) decides which stamped shape is "the" copy of a duplicated ERD_ID and gives
// unstamped lines their ids by (parent, child, column).
export function normalizeSnapshot(snap, ref, { adopt = false } = {}) {
  const warnings = [], headerRels = [];
  const refEnt = new Map(ref.entities.map((e) => [e.id, e]));
  const stamped = new Map();
  for (const s of snap.entities) {
    const id = s.shapeData?.ERD_ID;
    if (id) (stamped.get(id) ?? stamped.set(id, []).get(id)).push(s);
  }
  const winner = new Map();
  for (const [id, list] of stamped) {
    const r = refEnt.get(id);
    const score = (s) => (r ? (s.name === r.table ? 2 : 0) + s.fields.filter((f) => r.fields.some((x) => x.column === f.name)).length : 0);
    const best = list.slice().sort((a, b) => score(b) - score(a) || a.boundingBox.y - b.boundingBox.y || a.boundingBox.x - b.boundingBox.x)[0];
    winner.set(id, best.lucidId);
    if (list.length > 1) warnings.push(`Duplicate ERD_ID ${id} on ${list.map((s) => s.name).join(', ')}: kept ${best.name}, the rest are treated as new tables`);
  }
  // adopt: an unstamped table named like an ERD entity that has no stamped shape takes that entity's id (push only)
  const adoptable = new Map();
  if (adopt) for (const e of ref.entities) if (!winner.has(e.id)) adoptable.set(e.table, e.id);
  const keyOfLucid = new Map(), entities = [];
  for (const s of snap.entities) {
    const id = s.shapeData?.ERD_ID;
    const adoptId = !id && adoptable.get(s.name);
    const own = adoptId || (id && winner.get(id) === s.lucidId ? id : null);
    const key = own ?? `new:${s.lucidId}`;
    keyOfLucid.set(s.lucidId, key);
    const d = s.shapeData ?? {};
    entities.push({
      id: own, key, lucidId: s.lucidId, table: unclean(s.name), kind: unclean(d.Kind), group: unclean(d.Group), sensitivity: unclean(d.Sensitivity), purpose: unclean(d.Purpose),
      ...(adoptId ? { adopted: true } : {}), ...(id && !own ? { staleId: id } : {}),
      shading: s.headerShading ? (s.headerShading.enabled && s.headerShading.color ? s.headerShading.color.slice(0, 7).toLowerCase() : null) : undefined,
      fields: s.fields.filter((f) => (f.name ?? '').trim()).map((f) => rowToField(f)),
    });
  }
  const byKey = new Map(entities.map((e) => [e.key, e]));
  const refBySig = new Map(ref.relationships.map((r) => [sigOf(r), r.id]));
  const relationships = [];
  for (const r of snap.relationships) {
    const from = byKey.get(keyOfLucid.get(r.foreign.entityId)), to = byKey.get(keyOfLucid.get(r.primary.entityId));
    if (!from || !to) continue;
    if (!r.primary.fieldIndex || !r.foreign.fieldIndex || !r.primary.fieldName || !r.foreign.fieldName) { headerRels.push({ lineId: r.lineId, from: from.table, to: to.table }); continue; }
    const rel = { from: from.key, to: to.key, fk: unclean(r.foreign.fieldName), pk: unclean(r.primary.fieldName), lineId: r.lineId, ...endsToRel(r.primary.cardinality, r.foreign.cardinality) };
    const id = r.erdId || refBySig.get(sigOf(rel)) || null;
    relationships.push({ ...rel, id, key: id ?? `new:${r.lineId}` });
  }
  return { entities, relationships, warnings, headerRels };
}

// Test utility: what the snapshot script would return for a Lucid doc that holds exactly this model (a faithful push).
export function modelToSnapshot(n, { takenAt = '2026-10-20T12:00:00.000Z' } = {}) {
  const lucidId = (id) => `L-${id}`;
  const entities = n.entities.map((e, i) => ({
    lucidId: lucidId(e.id), name: e.table, boundingBox: { x: (i % 5) * 700, y: Math.floor(i / 5) * 500, w: 400, h: 200 },
    headerShading: KIND_COLORS[e.kind] ? { enabled: true, color: KIND_COLORS[e.kind] } : { enabled: false },
    shapeData: { ERD_ID: e.id, Kind: e.kind, Group: e.group, Sensitivity: e.sensitivity, Purpose: e.purpose },
    fields: e.fields.map((f, j) => { const r = fieldToRow(f); return { index: j + 1, name: r.name, key: r.key, type: r.type, nullable: !f.req }; }),
  }));
  const idx = (id, col) => entities.find((s) => s.lucidId === lucidId(id)).fields.findIndex((f) => f.name === col) + 1;
  const relationships = n.relationships.map((r) => {
    const ends = relEnds(r);
    return {
      lineId: `LN-${r.id}`, erdId: r.id,
      primary: { entityId: lucidId(r.to), fieldIndex: idx(r.to, r.pk), fieldName: r.pk, cardinality: ends.primary },
      foreign: { entityId: lucidId(r.from), fieldIndex: idx(r.from, r.fk), fieldName: r.fk, cardinality: ends.foreign },
    };
  });
  return { takenAt, entities, relationships };
}

// What lucid.json keeps as `seen` after a pull: the snapshot as it was read (new tables keep their provisional keys).
export function toSeen(baseline, snap) {
  const s = normalizeSnapshot(snap, baseline);
  return {
    entities: s.entities.map(({ id, key, table, kind, group, sensitivity, purpose, fields }) => ({ id, key, table, kind, group, sensitivity, purpose, fields })),
    relationships: s.relationships.map(({ id, key, from, to, fk, pk, cardinality, fkReq }) => ({ id, key, from, to, fk, pk, cardinality, fkReq })),
  };
}
