// ERD.md -> the normalized model erd-lucid diffs and syncs, plus the field/cardinality mapping to Lucid rows (spec §4c, §4d).
// Everything here is pure (no Lucid, no file system), so the push, pull and tests all share one definition of "the same".

import { parseErd } from '../../erd-view/lib/parse.mjs';
import { kindOf } from '../../erd-view/lib/layout.mjs';

const FLAGS = ['PK', 'FK', 'UK'];
const lc = (s) => (s ?? '').toLowerCase();

// CASE_TYPE_ID -> caseTypeId, ID -> id, IS_APPLICANT -> isApplicant
export const camel = (col) => col.toLowerCase().split('_').filter(Boolean).map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join('');

export const keyFlags = (key) => FLAGS.filter((k) => new RegExp(`\\b${k}\\b`).test(key ?? ''));

// Header colours by Kind (Core keeps the default).
export const KIND_COLORS = { Core: null, Reference: '#d9d9d9', Junction: '#b2dfdb', 'History/Audit': '#e8d5a8', Lookup: '#ffd966', Unspecified: null };

/* ---------- ERD.md -> normalized model ---------- */

export function normalizeErd(md) {
  const model = parseErd(md);
  const warnings = [...model.warnings];
  const live = model.entities.filter((e) => !e.deprecated);
  const liveIds = new Set(live.map((e) => e.id));
  const entities = live.map((e) => ({
    id: e.id, key: e.id, table: e.table, kind: kindOf(e), group: e.isLookup ? '' : e.group, sensitivity: e.sensitivity, purpose: e.purpose,
    fields: e.fields.filter((f) => !f.deprecated).map((f) => ({
      column: f.column, field: f.field || camel(f.column), type: f.type, req: !!f.req, key: keyFlags(f.key), ...(f.lookupType ? { lookupType: f.lookupType } : {}),
    })),
  }));
  const byId = new Map(entities.map((e) => [e.id, e]));
  const relationships = [];
  for (const r of model.relationships) {
    if (r.deprecated || r.lookup || !liveIds.has(r.from) || !liveIds.has(r.to)) continue;
    const child = byId.get(r.from), parent = byId.get(r.to);
    const fk = child.fields.find((f) => [f.field, f.column].some((n) => n && lc(n) === lc(r.fk)));
    const pk = parent.fields.find((f) => f.key.includes('PK'));
    if (!fk) { warnings.push(`${r.id}: FK "${r.fk}" is not a live field of ${child.table}; relationship not synced`); continue; }
    if (!pk) { warnings.push(`${r.id}: ${parent.table} has no PK row; relationship not synced`); continue; }
    relationships.push({ id: r.id, key: r.id, from: r.from, to: r.to, fk: fk.column, pk: pk.column, cardinality: r.cardinality === 'one-to-one' ? 'one-to-one' : 'many-to-one', fkReq: fk.req });
  }
  // Citations of the existing elements, for a change set's Supersedes column.
  const cites = { entity: {}, field: {}, rel: {} };
  for (const e of model.entities) {
    cites.entity[e.id] = e.sources;
    for (const f of e.fields) cites.field[`${e.id}.${f.column}`] = f.sources;
  }
  for (const r of model.relationships) cites.rel[r.id] = r.sources;
  return {
    title: model.title, version: +model.meta.Version || 0, prefix: model.meta['Application prefix'] || '', entities, relationships, warnings, cites,
    groups: model.groups, deprecatedEntityIds: new Set(model.entities.filter((e) => e.deprecated).map((e) => e.id)), model,
  };
}

// The part of a model that lives in lucid.json (§5a): no citations, no descriptions beyond Purpose.
export const toBaseline = (n) => ({
  entities: n.entities.map(({ id, table, kind, group, sensitivity, purpose, fields }) => ({ id, table, kind, group, sensitivity, purpose, fields: fields.map((f) => ({ ...f })) })),
  relationships: n.relationships.map(({ id, from, to, fk, pk, cardinality, fkReq }) => ({ id, from, to, fk, pk, cardinality, fkReq })),
});

export const fromBaseline = (b) => ({
  entities: (b?.entities ?? []).map((e) => ({ ...e, key: e.key ?? e.id })),
  relationships: (b?.relationships ?? []).map((r) => ({ ...r, key: r.key ?? r.id })),
});

/* ---------- field rows (§4c) ---------- */

// The runtime stores a value that starts with '=' with one leading space (Lucid would read it as a formula); read it back without.
export const unclean = (v) => (typeof v === 'string' && v.startsWith(' =') ? v.slice(1) : v);

export function fieldToRow(f) {
  const flags = f.key.map((k) => (k === 'UK' ? 'AK' : k)).join(',');
  return { name: f.column, key: [flags, f.lookupType ? `LK:${f.lookupType}` : ''].filter(Boolean).join(' '), type: [f.type, f.req ? 'NOT NULL' : ''].filter(Boolean).join(' ') };
}

export function rowToField(rowIn) {
  const row = { ...rowIn, name: unclean(rowIn.name), key: unclean(rowIn.key), type: unclean(rowIn.type) };
  const keyText = row.key ?? '';
  const lk = keyText.match(/LK:(\S+)/);
  const rest = keyText.replace(/LK:\S+/, '');
  const type = (row.type ?? '').replace(/\s*NOT NULL\s*$/i, '').trim();
  const flags = [/\bPK\b/.test(rest) && 'PK', /\bFK\b/.test(rest) && 'FK', /\bAK\b/.test(rest) && 'UK'].filter(Boolean);
  return { column: row.name, type, req: row.nullable === false || /NOT NULL/i.test(row.type ?? ''), key: flags, ...(lk ? { lookupType: lk[1] } : {}) };
}

/* ---------- relationship ends (§4d) ---------- */

export const relEnds = (r) => ({ primary: r.fkReq ? 'exactlyOne' : 'zeroOrOne', foreign: r.cardinality === 'one-to-one' ? 'zeroOrOne' : 'zeroOrMany' });

export const endsToRel = (primary, foreign) => ({
  cardinality: ['many', 'oneOrMany', 'zeroOrMany'].includes(foreign) ? 'many-to-one' : 'one-to-one',
  fkReq: ['one', 'exactlyOne', 'oneOrMany'].includes(primary),
});

/* ---------- sizes (used by the first-push layout) ---------- */

const ceil10 = (n) => Math.ceil(n / 10) * 10;
export function entitySize(e) {
  const rows = e.fields.map(fieldToRow);
  const longest = (k) => Math.max(0, ...rows.map((r) => (r[k] ?? '').length));
  // Measured in Lucid: about 10 px per character; height = 40 px + 32 px per row (when no cell wraps). Widths are generous so none does.
  const columnWidths = [ceil10(Math.max(40, 10.2 * longest('key') + 28)), ceil10(Math.max(140, 10.8 * Math.max(longest('name'), e.table.length * 0.8) + 30)), ceil10(Math.max(220, 10.2 * longest('type') + 28))];
  return { columnWidths, w: columnWidths.reduce((a, b) => a + b, 0), h: 40 + 32 * Math.max(1, rows.length) };
}

/* ---------- 3-way helpers ---------- */

export const sigOf = (r) => `${r.from}|${r.to}|${r.fk}`;
export const relKey = (r) => r.id ?? `sig:${sigOf(r)}`;

// All atomic differences from model `a` to model `b`. Entities match on `key`, fields on column, relationships on id (else signature).
// lenient: an entity attribute that is undefined on `b` (a Lucid data field somebody deleted) is not a change.
export function diffModels(a, b, { lenient = false } = {}) {
  const ch = [];
  const am = new Map(a.entities.map((e) => [e.key, e])), bm = new Map(b.entities.map((e) => [e.key, e]));
  for (const [k, e] of am) if (!bm.has(k)) ch.push({ k: 'entity-', key: k, id: e.id, e });
  for (const [k, e] of bm) {
    const x = am.get(k);
    if (!x) { ch.push({ k: 'entity+', key: k, id: e.id ?? null, e }); continue; }
    for (const attr of ['table', 'kind', 'group', 'sensitivity', 'purpose']) {
      if (lenient && e[attr] === undefined) continue;
      if (x[attr] !== e[attr]) ch.push({ k: 'entity~', key: k, id: e.id, attr, from: x[attr], to: e[attr], e, x });
    }
    const af = new Map(x.fields.map((f, i) => [f.column, { ...f, idx: i }])), bf = new Map(e.fields.map((f, i) => [f.column, { ...f, idx: i }]));
    for (const [c, f] of af) if (!bf.has(c)) ch.push({ k: 'field-', key: k, id: e.id, column: c, f, e, x });
    for (const [c, f] of bf) {
      const g = af.get(c);
      if (!g) { ch.push({ k: 'field+', key: k, id: e.id, column: c, f, e, x }); continue; }
      if (g.type !== f.type) ch.push({ k: 'field~', key: k, id: e.id, column: c, attr: 'type', from: g.type, to: f.type, f, g, e });
      if (g.req !== f.req) ch.push({ k: 'field~', key: k, id: e.id, column: c, attr: 'req', from: g.req, to: f.req, f, g, e });
      const kf = (h) => `${h.key.join(',')}${h.lookupType ? ` LK:${h.lookupType}` : ''}`;
      if (kf(g) !== kf(f)) ch.push({ k: 'field~', key: k, id: e.id, column: c, attr: 'key', from: kf(g), to: kf(f), f, g, e });
    }
  }
  const ar = new Map(a.relationships.map((r) => [relKey(r), r])), br = new Map(b.relationships.map((r) => [relKey(r), r]));
  for (const [k, r] of ar) if (!br.has(k)) ch.push({ k: 'rel-', key: k, id: r.id, r });
  for (const [k, r] of br) {
    const x = ar.get(k);
    if (!x) { ch.push({ k: 'rel+', key: k, id: r.id ?? null, r }); continue; }
    if (x.cardinality !== r.cardinality) ch.push({ k: 'rel~', key: k, id: r.id, attr: 'cardinality', from: x.cardinality, to: r.cardinality, r, x });
    if (x.fkReq !== r.fkReq) ch.push({ k: 'rel~', key: k, id: r.id, attr: 'fkReq', from: x.fkReq, to: r.fkReq, r, x });
  }
  return ch;
}
