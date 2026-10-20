// Emits the Lucid scripts (§5b). Each batch is self-contained: the ops are inlined as a JSON literal and the runtime below
// interprets them. Ops are idempotent (entities and lines are found by their ERD_ID shape data first), and the script throws at
// the end if any op failed, so Lucid reverts the whole batch and a rerun starts clean.

import { KIND_COLORS } from './model.mjs';

const RUNTIME = String.raw`
const erds = skills.erds, fm = skills.formulas, bc = skills.basecanvasediting;
const out = { ok: true, created: {}, errors: [], applied: 0 };
const dataOf = (id) => { const o = {}; try { for (const x of fm.listShapeDataFields(id)) o[x.name] = x.value; } catch (e) {} return o; };
const clean = (v) => { v = v == null ? '' : String(v); return v.charAt(0) === '=' ? ' ' + v : v; };
const setData = (id, name, value) => { if (name in dataOf(id)) fm.setShapeDataValue(id, name, clean(value)); else fm.addShapeDataField(id, name, clean(value)); };
const stamp = (id, o) => { setData(id, 'ERD_ID', o.id); setData(id, 'Kind', o.kind); setData(id, 'Group', o.group); setData(id, 'Sensitivity', o.sensitivity); setData(id, 'Purpose', o.purpose); };
const shade = (id, kind) => { const c = SHADE[kind]; erds.update(id, c ? { headerShading: { enabled: true, color: c } } : { headerShading: { enabled: false } }); };

const ents = new Map(), lines = new Map();
for (const s of erds.list()) { const d = dataOf(s.id); if (d.ERD_ID && !ents.has(d.ERD_ID)) ents.set(d.ERD_ID, s.id); }
for (const r of erds.listRelationships()) { const d = dataOf(r.lineId); if (d.ERD_ID && !lines.has(d.ERD_ID)) lines.set(d.ERD_ID, r.lineId); }

let blocks = null;
const scan = async () => {
  if (blocks) return blocks;
  const res = await bc.read(), page = res.pages.find((p) => p.id === bc.getCurrentPageId()) || res.pages[0], ids = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (!v || typeof v !== 'object') return;
    for (const k of Object.keys(v)) { const c = v[k]; if (typeof c === 'string' && (k === 'id' || /Id$/.test(k))) ids.add(c); else if (Array.isArray(c) && /Ids$/.test(k)) c.forEach((i) => typeof i === 'string' && ids.add(i)); walk(c); }
  };
  walk(page.data);
  blocks = ids.size ? bc.inspect([...ids]).filter((i) => i.kind === 'block' || i.kind === 'container') : [];
  return blocks;
};
const findManaged = async (cls, prefix) => {
  const found = {};
  for (const b of await scan()) if (b.className === cls) { const v = dataOf(b.id).ERD_ID; if (v && v.indexOf(prefix) === 0) found[v.slice(prefix.length)] = b.id; }
  return found;
};

const place = (group) => {
  const all = erds.list(), mates = all.filter((s) => dataOf(s.id).Group === group);
  if (mates.length) return { x: Math.max(...mates.map((s) => s.boundingBox.x + s.boundingBox.w)) + 160, y: Math.min(...mates.map((s) => s.boundingBox.y)) };
  return { x: 0, y: all.length ? Math.max(...all.map((s) => s.boundingBox.y + s.boundingBox.h)) + 260 : 0 };
};
let frameMemo = null;
const getFrames = async () => (frameMemo = frameMemo || (await findManaged('SparkFrameBlock', 'F:')));
const growFrame = async (group, id) => {
  if (!group) return;
  const frames = await getFrames();
  const e = erds.read(id);
  if (frames[group]) {
    const f = bc.inspect([frames[group]])[0], bb = f.boundingBox;
    bc.resizeBlock({ itemId: frames[group], width: Math.max(bb.w, e.boundingBox.x + e.boundingBox.w + 50 - bb.x), height: Math.max(bb.h, e.boundingBox.y + e.boundingBox.h + 50 - bb.y) });
  } else {
    const w = await bc.wrapInContainer({ itemIds: [id], className: 'SparkFrameBlock', label: group, padding: 50 });
    setData(w.containerId, 'ERD_ID', 'F:' + group);
    out.created['F:' + group] = w.containerId; frames[group] = w.containerId;
  }
};
const syncFields = (id, rows) => {
  const cur = erds.read(id).fields.map((f) => f.name);
  rows.forEach((r, i) => {
    const j = cur.indexOf(r.name, i);
    if (j === -1) { erds.addField(id, { name: r.name, type: r.type, key: r.key }, { index: i + 1 }); cur.splice(i, 0, r.name); return; }
    if (j !== i) { erds.moveField(id, j + 1, i + 1); cur.splice(i, 0, cur.splice(j, 1)[0]); }
    const f = erds.read(id).fields[i];
    if ((f.type || '') !== r.type || (f.key || '') !== r.key) erds.updateField(id, i + 1, { type: r.type, key: r.key });
  });
  while (cur.length > rows.length) { erds.removeField(id, cur.length); cur.pop(); }
};
const pinRel = (o, lineId) => {
  const p = ents.get(o.primary), c = ents.get(o.foreign);
  if (!p || !c) throw new Error(o.id + ': entity not found (' + (p ? o.foreign : o.primary) + ')');
  const pi = erds.read(p).fields.findIndex((f) => f.name === o.primaryColumn) + 1, ci = erds.read(c).fields.findIndex((f) => f.name === o.foreignColumn) + 1;
  if (!pi || !ci) throw new Error(o.id + ': column not found (' + (pi ? o.foreignColumn : o.primaryColumn) + ')');
  const spec = { primaryFieldIndex: pi, foreignFieldIndex: ci, primaryCardinality: o.pc, foreignCardinality: o.fc, label: o.label || '' };
  if (lineId) return erds.updateRelationship(lineId, spec);
  return erds.createRelationship({ primaryEntityId: p, foreignEntityId: c, ...spec });
};

const reroute = async (ids) => {
  const l = ids.map((i) => lines.get(i)).filter(Boolean);
  if (l.length) await bc.rerouteLines({ blockIds: [...ents.values()], lineIds: l });
};

const run = {
  'reroute': async (o) => { await reroute(o.ids); },
  'create-entity': async (o) => {
    if (ents.has(o.id)) return;
    const at = o.place ? place(o.group) : { x: o.x, y: o.y };
    const e = erds.create({ name: o.table, variant: 'keyFieldType', fields: o.rows, location: at, columnWidths: o.columnWidths });
    stamp(e.id, o); shade(e.id, o.kind);
    ents.set(o.id, e.id); out.created[o.id] = e.id;
    if (o.place) await growFrame(o.group, e.id);
  },
  'adopt-entity': async (o) => {
    const id = o.lucidId; if (!id) throw new Error(o.id + ': no lucidId to adopt');
    stamp(id, o); shade(id, o.kind); ents.set(o.id, id); out.created[o.id] = id;
  },
  'update-entity': async (o) => {
    const id = ents.get(o.id); if (!id) throw new Error(o.id + ': entity not found');
    if (o.rename) erds.update(id, { name: o.table });
    stamp(id, o); shade(id, o.kind);
  },
  'delete-entity': async (o) => {
    const id = ents.get(o.id); if (!id) return;
    const ls = erds.listRelationships(id).map((r) => r.lineId);
    bc.deleteItem({ itemIds: [...ls, id] }); ents.delete(o.id);
  },
  'sync-fields': async (o) => { const id = ents.get(o.id); if (!id) throw new Error(o.id + ': entity not found'); syncFields(id, o.rows); },
  'create-rel': async (o) => {
    if (lines.has(o.id)) return;
    const r = pinRel(o, null); setData(r.lineId, 'ERD_ID', o.id); lines.set(o.id, r.lineId); out.created[o.id] = r.lineId;
  },
  'update-rel': async (o) => { const l = lines.get(o.id) || o.lineId; if (!l) throw new Error(o.id + ': line not found'); pinRel(o, l); },
  'delete-rel': async (o) => { const l = lines.get(o.id) || o.lineId; if (l) { bc.deleteItem({ itemIds: [l] }); lines.delete(o.id); } },
  'finalize': async (o) => {
    const frames = await getFrames();
    for (const g of o.groups) {
      if (frames[g.name]) continue;
      const ids = g.ids.map((i) => ents.get(i)).filter(Boolean); if (!ids.length) continue;
      const w = await bc.wrapInContainer({ itemIds: ids, className: 'SparkFrameBlock', label: g.name, padding: 50 });
      setData(w.containerId, 'ERD_ID', 'F:' + g.name); out.created['F:' + g.name] = w.containerId; frames[g.name] = w.containerId;
    }
    await reroute([...lines.keys()]);
    const hdr = await findManaged('TextBlock', 'HEADER');
    if (!hdr['']) {
      const t = await bc.createBlock({ className: 'TextBlock', label: o.header, x: o.hx, y: o.hy, width: 1400, height: 120 });
      setData(t.id, 'ERD_ID', 'HEADER'); out.created.HEADER = t.id;
    }
  },
  'update-header': async (o) => {
    const hdr = await findManaged('TextBlock', 'HEADER');
    if (hdr['']) await bc.setText({ itemId: hdr[''], text: o.header });
  },
};

for (const o of OPS) {
  try { await run[o.op](o); out.applied++; } catch (e) { out.ok = false; out.errors.push({ op: o.op, id: o.id, error: String(e && e.message || e) }); }
}
if (!out.ok) throw new Error('erd-lucid batch failed (reverted): ' + JSON.stringify(out.errors));
return out;
`;

export const batchScript = (ops, label) => `// project-terrarium erd-lucid ${label}: ${ops.length} op(s). Generated; rerunning is safe.
const SHADE = ${JSON.stringify(KIND_COLORS)};
const OPS = ${JSON.stringify(ops)};
${RUNTIME}`;
