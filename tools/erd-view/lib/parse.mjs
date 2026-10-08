// Parse an ERD.md (see skills/erd-build/references/erd-format.md) into a plain model.
// Primary source: Entities + Relationships tables. Fallback/gap-fill: the mermaid erDiagram block.

import { kindOf } from './layout.mjs';

const norm = (s) => (s ?? '').trim();
const stripTicks = (s) => norm(s).replace(/^`+|`+$/g, '');

function sections(md, level) {
  const re = new RegExp(`^${'#'.repeat(level)} (.+)$`, 'gm');
  const hits = [...md.matchAll(re)];
  return hits.map((m, i) => ({
    title: m[1].trim(),
    body: md.slice(m.index + m[0].length, i + 1 < hits.length ? hits[i + 1].index : md.length),
  }));
}

function parseTable(text) {
  // Only the first contiguous block of table lines; a later table in the same section is ignored.
  const all = text.split('\n').map((l) => l.trim());
  const start = all.findIndex((l) => l.startsWith('|'));
  if (start === -1) return [];
  let end = start;
  while (end < all.length && all[end].startsWith('|')) end++;
  const lines = all.slice(start, end);
  if (lines.length < 2) return [];
  const cells = (l) => l.replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
  const head = cells(lines[0]);
  return lines.slice(2).map((l) => {
    const c = cells(l);
    return Object.fromEntries(head.map((h, i) => [h, c[i] ?? '']));
  });
}

function bullet(body, label) {
  const m = body.match(new RegExp(`^- \\*\\*${label}:\\*\\*\\s*(.*)$`, 'mi'));
  return m ? m[1].trim() : '';
}

const withLookup = (f) => {
  const m = (f.key || '').match(/^FK→LOOKUP:(\S+)/);
  return m ? { ...f, lookupType: m[1] } : f;
};

const colKey = (row, ...names) => {
  for (const k of Object.keys(row)) if (names.some((n) => k.toLowerCase().startsWith(n))) return row[k];
  return '';
};


export function parseMermaid(md) {
  const m = md.match(/```mermaid\s*\n\s*erDiagram\s*\n([\s\S]*?)```/);
  const out = { entities: new Map(), relationships: [] };
  if (!m) return out;
  const lines = m[1].split('\n');
  let cur = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('%%')) continue;
    if (cur) {
      if (line === '}') { cur = null; continue; }
      const a = line.match(/^(\S+)\s+(\S+)(?:\s+(.*))?$/);
      if (a) {
        const rest = (a[3] ?? '').replace(/"[^"]*"/g, '').split(/[\s,]+/).filter(Boolean);
        const lk = (a[3] ?? '').match(/"LOOKUP:\s*([^"\s]+)\s*"/);
        cur.fields.push({ type: a[1], column: a[2], key: rest.filter((r) => /^(PK|FK|UK)$/.test(r)).join(','), ...(lk ? { lookupType: lk[1] } : {}) });
      }
      continue;
    }
    const open = line.match(/^([A-Za-z0-9_."-]+)\s*\{$/);
    if (open) { cur = ent(out.entities, open[1]); continue; }
    const rel = line.match(/^(\S+)\s+([|}][|o])(--|\.\.)([|o][|{])\s+(\S+)\s*(?::\s*(.*))?$/);
    if (rel) {
      ent(out.entities, rel[1]); ent(out.entities, rel[5]);
      out.relationships.push({ a: rel[1], b: rel[5], left: rel[2], right: rel[4], identifying: rel[3] === '--', label: norm(rel[6]).replace(/^"|"$/g, '') });
      continue;
    }
    const lone = line.match(/^([A-Za-z0-9_."-]+)$/);
    if (lone) ent(out.entities, lone[1]);
  }
  return out;
}
function ent(map, name) {
  if (!map.has(name)) map.set(name, { table: name, fields: [] });
  return map.get(name);
}

function endCard(tok, side) {
  return side === 'left'
    ? { many: tok[0] === '}', optional: tok[1] === 'o' }
    : { many: tok[1] === '{', optional: tok[0] === 'o' };
}

export function parseErd(md) {
  const warnings = [];
  const model = { title: '', meta: {}, summary: '', groups: [], groupsDerived: false, lookupId: null, entities: [], relationships: [], assumptions: [], questions: [], deferred: '', changeLog: [], warnings };
  model.title = (md.match(/^# (.+)$/m) ?? [])[1]?.trim() ?? 'ERD';

  const h2 = Object.fromEntries(sections(md, 2).map((s) => [s.title.toLowerCase(), s.body]));
  const find = (prefix) => Object.entries(h2).find(([k]) => k.startsWith(prefix))?.[1] ?? '';

  // header table = first table in doc
  const headBody = md.slice(0, md.search(/^## /m) === -1 ? md.length : md.search(/^## /m));
  for (const r of parseTable(headBody.replace(/^\|\s*\|\s*\|\s*$/m, '| k | v |'))) {
    const k = Object.values(r)[0]; if (k && k !== 'k') model.meta[k] = Object.values(r)[1];
  }
  model.summary = norm(find('summary'));
  model.deferred = norm(find('out of scope'));

  // ---- entities from tables
  const byId = new Map(), byTable = new Map();
  for (const s of sections(find('entities'), 3)) {
    const m = s.title.match(/^(E-\d+)\s+(.*?)\s*\(`?([^`)]+)`?\)\s*$/);
    if (!m) { warnings.push(`Unparseable entity heading: "${s.title}"`); continue; }
    const e = {
      id: m[1], name: m[2], table: m[3],
      purpose: bullet(s.body, 'Purpose'), kind: bullet(s.body, 'Kind'), volume: bullet(s.body, 'Est\\. volume'),
      sensitivity: bullet(s.body, 'Sensitivity'), sources: bullet(s.body, 'Sources'), group: bullet(s.body, 'Group'), isLookup: false,
      deprecated: /^deprecated/i.test(bullet(s.body, 'Status')) ? bullet(s.body, 'Status') : '',
      fields: parseTable(s.body).map((r) => ({
        field: colKey(r, 'field'), column: stripTicks(colKey(r, 'column')), type: colKey(r, 'type'),
        req: /^y/i.test(colKey(r, 'req')), key: colKey(r, 'key'), description: colKey(r, 'description'), sources: colKey(r, 'sources'),
        deprecated: /^deprecated/i.test(colKey(r, 'description')),
      })).filter((f) => f.column).map(withLookup),
    };
    byId.set(e.id, e); byTable.set(e.table, e); model.entities.push(e);
  }

  // ---- relationships from table
  const resolve = (cell) => {
    const id = (cell.match(/E-\d+/) ?? [])[0];
    if (id && byId.has(id)) return byId.get(id);
    const t = byTable.get(stripTicks(cell));
    return t ?? null;
  };
  for (const r of parseTable(find('relationships'))) {
    const id = colKey(r, 'id'); if (!id) continue;
    const from = resolve(colKey(r, 'from')), to = resolve(colKey(r, 'to'));
    const card = colKey(r, 'cardinality').toLowerCase();
    if (!from || !to) { warnings.push(`${id}: cannot resolve entity in "${colKey(r, 'from')}" -> "${colKey(r, 'to')}"`); continue; }
    if (card === 'many-to-many') warnings.push(`${id}: many-to-many between ${from.table} and ${to.table} (contract requires a junction entity)`);
    model.relationships.push({
      id, from: from.id, to: to.id, cardinality: card, fk: colKey(r, 'fk'), description: colKey(r, 'description'), sources: colKey(r, 'sources'), label: '', deprecated: /^deprecated/i.test(colKey(r, 'description')),
    });
  }

  // ---- mermaid fallback / gap-fill
  const mm = parseMermaid(md);
  let next = model.entities.reduce((n, e) => Math.max(n, +e.id.slice(2) || 0), 0);
  for (const [table, me] of mm.entities) {
    let e = byTable.get(table);
    if (!e) {
      e = { id: `E-${++next}`, name: table, table, purpose: '', kind: '', volume: '', sensitivity: '', sources: '', group: '', isLookup: false, deprecated: '', fields: [], fromMermaidOnly: true };
      byTable.set(table, e); byId.set(e.id, e); model.entities.push(e);
      warnings.push(`${table}: only in Mermaid block (no Entities section)`);
    }
    if (!e.fields.length) e.fields = me.fields.map((f) => ({ field: '', column: f.column, type: f.type, req: false, key: f.key, description: '', sources: '', ...(f.lookupType ? { lookupType: f.lookupType } : {}) }));
  }
  const pairSig = (x) => [byId.get(x.from)?.table, byId.get(x.to)?.table].sort().join('|');
  const claimed = new Set(); // table relationships already matched to a Mermaid edge
  for (const r of mm.relationships) {
    const A = byTable.get(r.a), B = byTable.get(r.b);
    const sig = [A.table, B.table].sort().join('|');
    const l = endCard(r.left, 'left'), rt = endCard(r.right, 'right');
    const siblings = model.relationships.filter((x) => pairSig(x) === sig);
    // Mermaid edges carry only a label, so parallel edges between one pair are matched in document order.
    const target = siblings.find((x) => !claimed.has(x));
    if (target) { claimed.add(target); target.label = r.label; continue; }
    if (siblings.length) {
      warnings.push(`Mermaid has more edges between ${A.table} and ${B.table} (${siblings.length + 1}+) than the Relationships table (${siblings.length}); extra "${r.label}" edge ignored`);
      continue;
    }
    // Child (many) side is the "from".
    let from = A, to = B, card;
    if (l.many && rt.many) card = 'many-to-many';
    else if (l.many) { from = A; to = B; card = 'many-to-one'; }
    else if (rt.many) { from = B; to = A; card = 'many-to-one'; }
    else card = 'one-to-one';
    const added = { id: `R-m${model.relationships.length + 1}`, from: from.id, to: to.id, cardinality: card, fk: '', description: '', sources: '', label: r.label, deprecated: false };
    model.relationships.push(added); claimed.add(added);
    warnings.push(`Relationship ${A.table} -> ${B.table} only in Mermaid block`);
  }

  // ---- integrity checks
  for (const e of model.entities) for (const f of e.fields) {
    const m = f.key.match(/FK→(E-\d+)/);
    if (m && !byId.has(m[1])) warnings.push(`${e.table}.${f.column}: FK targets unknown ${m[1]}`);
  }
  groupsAndLookup(model, find('groups'), byId);
  model.changeLog = parseTable(find('change log')).filter((r) => Object.values(r).some(Boolean));
  for (const k of ['assumptions', 'questions']) {
    model[k] = parseTable(find(k === 'questions' ? 'open questions' : 'assumptions')).filter((r) => Object.values(r).some(Boolean));
  }
  return model;
}

// ---- groups and the shared lookup table
function groupsAndLookup(model, groupsBody, byId) {
  const { entities, relationships, warnings } = model;

  // Lookup entity: Kind starts with "lookup", or the table ends with _LOOKUP.
  const lk = entities.find((e) => /^lookup/i.test(e.kind)) ?? entities.find((e) => /_LOOKUP$/i.test(e.table));
  if (lk) {
    lk.isLookup = true; lk.group = '';
    model.lookupId = lk.id;
    for (const r of relationships) if (r.to === lk.id && r.from !== lk.id) r.lookup = true;
  }
  for (const e of entities) for (const f of e.fields) {
    if (!f.lookupType) continue;
    if (!lk) { warnings.push(`${e.table}.${f.column}: FK→LOOKUP:${f.lookupType} but no lookup entity (<PREFIX>_LOOKUP) exists`); continue; }
    const has = relationships.some((r) => r.from === e.id && r.to === lk.id && [f.field, f.column].some((n) => n && r.fk && r.fk.toLowerCase() === n.toLowerCase()));
    if (!has) warnings.push(`${e.table}.${f.column}: FK→LOOKUP has no Relationships row`);
  }

  // ## Groups
  model.groups = parseTable(groupsBody)
    .map((r) => ({ order: +colKey(r, 'order') || 0, name: colKey(r, 'group'), description: colKey(r, 'description') }))
    .filter((g) => g.name)
    .sort((a, b) => a.order - b.order);
  const grouped = entities.filter((e) => !e.isLookup);
  if (!grouped.some((e) => e.group)) { deriveGroups(model, byId); return; }

  if (!model.groups.length) {
    warnings.push('Entities have Group bullets but there is no ## Groups section; groups are ordered by first appearance');
    for (const e of grouped) if (e.group && !model.groups.some((g) => g.name === e.group)) model.groups.push({ order: model.groups.length + 1, name: e.group, description: '' });
  }
  const known = new Set(model.groups.map((g) => g.name));
  for (const e of grouped) {
    if (!e.group) { warnings.push(`entity ${e.table}: no Group`); e.group = 'Other'; }
    else if (!known.has(e.group)) warnings.push(`entity ${e.table}: Group "${e.group}" not in ## Groups`);
  }
  for (const g of model.groups) if (!grouped.some((e) => e.group === g.name)) warnings.push(`Group "${g.name}" in ## Groups has no entities`);
  // Groups used but not listed (or "Other") still need a slot, after the listed ones.
  for (const e of grouped) if (!model.groups.some((g) => g.name === e.group)) model.groups.push({ order: model.groups.length + 1, name: e.group, description: '' });
}

// Deterministic grouping for ERDs with no Group data. Order of operations is fixed (entity-ID order throughout).
function deriveGroups(model, byId) {
  const { entities, relationships } = model;
  model.groupsDerived = true;
  const num = (e) => +e.id.slice(2) || 0;
  const ents = entities.filter((e) => !e.isLookup).sort((a, b) => num(a) - num(b));
  const kind = new Map(ents.map((e) => [e.id, kindOf(e)]));
  const rels = relationships.filter((r) => r.from !== r.to && kind.has(r.from) && kind.has(r.to));
  const children = new Map(ents.map((e) => [e.id, []])), parents = new Map(ents.map((e) => [e.id, []]));
  for (const r of rels) { children.get(r.to).push(r.from); parents.get(r.from).push(r.to); }
  for (const l of children.values()) l.sort((a, b) => num(byId.get(a)) - num(byId.get(b)));
  const group = new Map(), order = [];
  // 1+2: every Core entity with no Core parent seeds a group named after it; one breadth-first walk from all seeds at once
  // (so groups stay balanced). A Core/Junction/History entity joins the group of its first-reached parent.
  const isSeed = (e) => kind.get(e.id) === 'Core' && !parents.get(e.id).some((p) => kind.get(p) === 'Core');
  const walk = (queue) => {
    while (queue.length) {
      const v = queue.shift();
      for (const c of children.get(v)) {
        if (group.has(c) || kind.get(c) === 'Reference') continue;
        group.set(c, group.get(v)); queue.push(c);
      }
    }
  };
  const seed = (list) => { for (const e of list) { group.set(e.id, e.name); if (!order.includes(e.name)) order.push(e.name); } walk(list.map((e) => e.id)); };
  seed(ents.filter(isSeed));
  // Core entities in a Core-only cycle have no seed: take the lowest unassigned one, repeat.
  for (const e of ents) if (kind.get(e.id) === 'Core' && !group.has(e.id)) seed([e]);
  // 3: Reference entities go to their only consumer group, or to "Shared reference" when used by 2+ groups.
  const consumers = new Map(ents.map((e) => [e.id, []]));
  for (const r of rels) consumers.get(r.to).push(r.from);
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of ents) {
      if (kind.get(e.id) !== 'Reference' || group.has(e.id)) continue;
      const cs = consumers.get(e.id);
      if (!cs.length || cs.some((c) => !group.has(c) && kind.get(c) !== 'Reference')) continue;
      const gs = new Set(cs.filter((c) => group.has(c)).map((c) => group.get(c)));
      if (!gs.size) continue;
      group.set(e.id, gs.size > 1 ? 'Shared reference' : [...gs][0]); changed = true;
    }
  }
  if ([...group.values()].includes('Shared reference')) order.push('Shared reference');
  // 4: anything left.
  for (const e of ents) if (!group.has(e.id)) group.set(e.id, 'Other');
  if ([...group.values()].includes('Other')) order.push('Other');
  for (const e of ents) e.group = group.get(e.id);
  model.groups = order.map((name, i) => ({ order: i + 1, name, description: '' }));
}
