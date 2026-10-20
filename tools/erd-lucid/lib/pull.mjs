// pull-diff (§6b): baseline · Lucid snapshot · ERD.md -> a change set in skills/erd-maintain/references/changeset-format.md.
// Theirs = snapshot vs baseline (what people changed in Lucid); ours = ERD.md vs baseline (what changed in ERD.md since the last sync).
// Per atomic attribute: theirs unchanged -> nothing; both sides agree -> nothing; ours unchanged -> a clean op; else a conflict.

import { diffModels, fromBaseline, camel } from './model.mjs';
import { normalizeSnapshot } from './snapshot.mjs';

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim() || '—';
const show = (v) => (v === undefined || v === '' ? '—' : v === true ? 'Y' : v === false ? 'N' : v);

// Active decisions from the Index table: [{id, affects: ['E-11.authorizedHoursPerWeek', 'R-2', ...]}]. `global` is not expanded (the agent judges those).
export function activeDecisions(md) {
  const out = [];
  for (const l of (md ?? '').split('\n')) {
    const m = l.match(/^\|\s*(DEC-\d+)\s*\|[^|]*\|\s*Active\s*\|([^|]*)\|/);
    if (m) out.push({ id: m[1], affects: m[2].split(/[\s,]+/).filter(Boolean) });
  }
  return out;
}

const entityName = (table, prefix) => table.split('_').filter(Boolean).map((w) => (prefix && w === prefix ? w : w[0] + w.slice(1).toLowerCase())).join(' ');

export function buildPull(n, state, snapshot, { source = 'S?', decisions = null, url = '' } = {}) {
  const base = fromBaseline(state.baseline);
  const theirs = normalizeSnapshot(snapshot, base, { adopt: true }); // an unstamped table named like a baseline entity is that entity until a push stamps it
  const ours = { entities: n.entities.map((e) => ({ ...e, key: e.id })), relationships: n.relationships };
  const tch = diffModels(base, theirs, { lenient: true });
  const och = diffModels(base, ours);
  const decs = activeDecisions(decisions);
  const warnings = [...theirs.warnings];
  const notProposed = [];
  const oursEnt = new Map(ours.entities.map((e) => [e.id, e]));
  const oursRel = new Map(ours.relationships.map((r) => [r.id, r]));
  const baseEnt = new Map(base.entities.map((e) => [e.id, e]));
  const theirsEnt = new Map(theirs.entities.map((e) => [e.key, e]));

  // ---- ours side
  const oEntity = new Set(och.filter((c) => c.k.startsWith('entity')).map((c) => c.id));
  const oAttr = new Set(och.filter((c) => c.k === 'entity~').map((c) => `${c.id}|${c.attr}`));
  const oField = new Set(och.filter((c) => c.k.startsWith('field')).map((c) => `${c.id}|${c.column}`));
  const oRel = new Set(och.filter((c) => c.k.startsWith('rel') && c.id).map((c) => c.id));
  const entityTouched = (id) => oEntity.has(id) || och.some((c) => c.id === id && (c.k.startsWith('field')));
  const sameField = (a, b) => a && b && a.type === b.type && a.req === b.req && JSON.stringify(a.key) === JSON.stringify(b.key) && a.lookupType === b.lookupType;
  const oursField = (id, col) => oursEnt.get(id)?.fields.find((f) => f.column === col);

  const ops = [];
  const cites = n.cites;
  const ev = (table, col) => `[${source} §${table}${col ? `.${col}` : ''}]`;
  const sup = (kind, id, col) => (kind === 'entity' ? cites.entity[id] : kind === 'field' ? cites.field[`${id}.${col}`] : cites.rel[id]) || '—';
  const push = (o) => { ops.push(o); return o; };
  const decFor = (target) => decs.filter((d) => d.affects.some((a) => a === target || target.startsWith(`${a}.`))).map((d) => d.id);

  // clean op, or a conflict when `conflict` holds (or an active decision covers the target)
  function emit(o, conflict) {
    const decIds = o.decTarget ? decFor(o.decTarget) : [];
    if (conflict || decIds.length) {
      const sups = [o.supersedes === '—' ? '' : o.supersedes, ...decIds.map((d) => `[${d}]`)].filter(Boolean).join(' ') || '—';
      const op = push({ ...o, cls: 'conflict', supersedes: sups, confidence: o.confidence === 'High' ? 'Medium' : o.confidence });
      push({ cls: 'additive', op: 'raise-question', target: 'Q-new', change: `Ask instead of change: ${o.op} ${o.target} (${decIds.length ? `reverses ${decIds.join(', ')}` : 'ERD.md and Lucid both changed it'})`, evidence: `${o.evidence} ${o.supersedes === '—' ? '' : o.supersedes}`.trim(), supersedes: '—', confidence: '—', pairOf: op });
      return op;
    }
    return push(o);
  }

  const removedIds = new Set(tch.filter((c) => c.k === 'entity-' && c.id).map((c) => c.id));

  // ---- entity-level changes
  for (const c of tch) {
    if (c.k === 'entity-') {
      if (!oursEnt.has(c.id)) continue; // already deprecated in ERD.md
      emit({ cls: 'breaking', op: 'deprecate', target: c.id, change: `Table ${c.e.table} was deleted in Lucid`, evidence: ev(c.e.table), supersedes: sup('entity', c.id), confidence: 'High', decTarget: c.id }, entityTouched(c.id));
    } else if (c.k === 'entity~') {
      const o = oursEnt.get(c.id); if (!o) continue;
      if (o[c.attr] === c.to) continue;
      const conflict = oAttr.has(`${c.id}|${c.attr}`);
      if (c.attr === 'table') emit({ cls: 'breaking', op: 'rename', target: c.id, change: `Table ${c.from} → ${c.to}`, evidence: ev(c.to), supersedes: sup('entity', c.id), confidence: 'High', decTarget: c.id }, conflict);
      else if (c.attr === 'group') emit({ cls: 'breaking', op: 'rename', target: `${c.id}.group`, change: `Group ${show(c.from)} → ${show(c.to)}`, evidence: ev(c.e.table), supersedes: sup('entity', c.id), confidence: 'High', decTarget: c.id }, conflict);
      else emit({ cls: 'modifying', op: 'modify-field', target: `${c.id}.${c.attr}`, change: `${c.attr[0].toUpperCase()}${c.attr.slice(1)} ${show(c.from)} → ${show(c.to)}`, evidence: ev(c.e.table), supersedes: sup('entity', c.id), confidence: 'High', decTarget: c.id }, conflict);
    }
  }

  // ---- field-level changes (a removed + an added row at the same index with the same type is a rename)
  const fieldCh = tch.filter((c) => c.k.startsWith('field') && c.id && baseEnt.has(c.id) && !removedIds.has(c.id));
  const consumed = new Set();
  for (const id of new Set(fieldCh.map((c) => c.id))) {
    const gone = fieldCh.filter((c) => c.id === id && c.k === 'field-'), added = fieldCh.filter((c) => c.id === id && c.k === 'field+');
    for (const g of gone) {
      const a = added.find((x) => !consumed.has(x) && x.f.idx === g.f.idx && x.f.type === g.f.type);
      if (!a || !oursField(id, g.column)) continue;
      consumed.add(a); consumed.add(g);
      const conflict = oField.has(`${id}|${g.column}`);
      emit({ cls: 'breaking', op: 'rename', target: `${id}.${g.f.field}`, change: `Column ${g.column} → ${a.column} (field ${camel(a.column)}); same type at the same position`, evidence: ev(a.e.table, a.column), supersedes: sup('field', id, g.column), confidence: 'Medium', decTarget: `${id}.${g.f.field}` }, conflict);
    }
  }
  const baseFieldName = (id, col) => baseEnt.get(id)?.fields.find((f) => f.column === col)?.field ?? camel(col);
  for (const c of fieldCh) {
    if (consumed.has(c)) continue;
    const o = oursEnt.get(c.id);
    if (!o) continue;
    const of = oursField(c.id, c.column);
    if (c.k === 'field-') {
      if (!of) continue;
      emit({ cls: 'breaking', op: 'deprecate', target: `${c.id}.${baseFieldName(c.id, c.column)}`, change: `Row ${c.column} was deleted in Lucid`, evidence: ev(c.e.table, c.column), supersedes: sup('field', c.id, c.column), confidence: 'High', decTarget: `${c.id}.${baseFieldName(c.id, c.column)}` }, oField.has(`${c.id}|${c.column}`));
    } else if (c.k === 'field+') {
      if (of) continue; // ERD.md has it already
      const key = c.f.key.join(',') + (c.f.lookupType ? ` LK:${c.f.lookupType}` : '');
      emit({ cls: 'additive', op: 'add-field', target: `${c.id}.${camel(c.column)}`, change: `${c.column} ${show(c.f.type)}, Req ${show(c.f.req)}, Key ${show(key)}`, evidence: ev(c.e.table, c.column), supersedes: '—', confidence: 'High' }, false);
    } else {
      if (!of) continue;
      if (c.attr === 'key' ? `${of.key.join(',')}${of.lookupType ? ` LK:${of.lookupType}` : ''}` === c.to : of[c.attr] === c.to) continue;
      const name = baseFieldName(c.id, c.column);
      const label = { type: 'Type', req: 'Req', key: 'Key' }[c.attr];
      emit({ cls: c.attr === 'key' ? 'breaking' : 'modifying', op: 'modify-field', target: `${c.id}.${name}`, change: `${label} ${show(c.from)} → ${show(c.to)}`, evidence: ev(c.e.table, c.column), supersedes: sup('field', c.id, c.column), confidence: 'High', decTarget: `${c.id}.${name}` }, oField.has(`${c.id}|${c.column}`));
    }
  }

  // ---- new, restored and look-alike tables
  const newEnt = new Map(); // theirs key -> {ref, e}
  let en = 0;
  for (const c of tch) {
    if (c.k !== 'entity+') continue;
    const e = c.e;
    if (e.id && n.deprecatedEntityIds.has(e.id)) {
      push({ cls: 'additive', op: 'raise-question', target: 'Q-new', change: `${e.id} (${e.table}) is deprecated in ERD.md but its table is back in Lucid (undo?). Restore it or remove the table?`, evidence: ev(e.table), supersedes: '—', confidence: '—' });
      continue;
    }
    const twin = ours.entities.find((x) => x.table === e.table);
    if (twin) { notProposed.push(`Table ${e.table} in Lucid is already ${twin.id} in ERD.md; the next push will stamp it.`); continue; }
    if (!e.fields.some((f) => f.key.includes('PK'))) { notProposed.push(`Table ${e.table} in Lucid has no PK row: not proposed. Add a PK row and pull again.`); continue; }
    if (e.staleId) warnings.push(`${e.table} carries ERD_ID ${e.staleId}, which is not in this ERD; treated as a new table`);
    newEnt.set(e.key, { ref: `E-new-${++en}`, e });
  }
  const refOf = (key) => (oursEnt.has(key) ? key : newEnt.get(key)?.ref ?? null);
  const tableOf = (key) => theirsEnt.get(key)?.table ?? baseEnt.get(key)?.table ?? key;
  const newRels = tch.filter((c) => c.k === 'rel+' && (newEnt.has(c.r.from) || newEnt.has(c.r.to) || (oursEnt.has(c.r.from) && oursEnt.has(c.r.to))));
  const details = [];
  for (const [, { ref, e }] of newEnt) {
    const group = (e.group ?? '').trim();
    const rows = e.fields.map((f) => {
      const rel = newRels.find((c) => c.r.from === e.key && c.r.fk === f.column);
      const key = [...f.key.map((k) => (k === 'FK' && rel && refOf(rel.r.to) ? `FK→${refOf(rel.r.to)}` : k)), ...(f.lookupType ? [`FK→LOOKUP:${f.lookupType}`] : [])].join(', ');
      return { field: camel(f.column), column: f.column, type: f.type, req: f.req ? 'Y' : 'N', key, description: '—', sources: ev(e.table, f.column) };
    });
    const q = group ? null : push({ cls: 'additive', op: 'raise-question', target: 'Q-new', change: `Which Group does new table ${e.table} belong to? The Group shape data is blank in Lucid`, evidence: ev(e.table), supersedes: '—', confidence: '—' });
    const op = push({ cls: 'additive', op: 'add-entity', target: `${ref} ${entityName(e.table, n.prefix)} (\`${e.table}\`)`, change: `Group: ${group || '(not set, see the paired question)'}. Kind: ${show(e.kind)}. ${e.purpose ? `${e.purpose}. ` : ''}Fields: ${rows.map((r) => `${r.field} ${r.type}`.trim()).join(', ')}`, evidence: ev(e.table), supersedes: '—', confidence: 'High' });
    details.push({ op, ref, rows });
  }

  // ---- relationships
  const refKey = refOf;
  const fieldChangeReq = new Set(tch.filter((c) => c.k === 'field~' && c.attr === 'req').map((c) => `${c.id}|${c.column}`));
  let rn = 0;
  for (const c of tch) {
    if (c.k === 'rel-') {
      if (!oursRel.has(c.id)) continue;
      if (removedIds.has(c.r.from) || removedIds.has(c.r.to)) continue;
      emit({ cls: 'breaking', op: 'deprecate', target: c.id, change: `Line ${tableOf(c.r.from)} → ${tableOf(c.r.to)} (via ${c.r.fk}) was deleted in Lucid`, evidence: ev(tableOf(c.r.from), c.r.fk), supersedes: sup('rel', c.id), confidence: 'High', decTarget: c.id }, oRel.has(c.id));
    } else if (c.k === 'rel+') {
      const from = refKey(c.r.from), to = refKey(c.r.to);
      if (!from || !to) { if (!theirsEnt.get(c.r.from)?.id || !theirsEnt.get(c.r.to)?.id) notProposed.push(`A line between ${tableOf(c.r.from)} and ${tableOf(c.r.to)} was not proposed because a table it touches was not proposed.`); continue; }
      if (ours.relationships.some((r) => r.from === c.r.from && r.to === c.r.to && r.fk === c.r.fk)) continue;
      push({ cls: 'additive', op: 'add-relationship', target: `R-new-${++rn}`, change: `${from} → ${to} via ${c.r.fk} (${c.r.cardinality})`, evidence: ev(tableOf(c.r.from), c.r.fk), supersedes: '—', confidence: 'High' });
    } else if (c.k === 'rel~') {
      const o = oursRel.get(c.id); if (!o) continue;
      if (c.attr === 'cardinality') {
        if (o.cardinality === c.to) continue;
        emit({ cls: 'breaking', op: 'modify-relationship', target: c.id, change: `Cardinality ${c.from} → ${c.to}`, evidence: ev(tableOf(c.r.from), c.r.fk), supersedes: sup('rel', c.id), confidence: 'High', decTarget: c.id }, oRel.has(c.id));
      } else {
        const child = oursEnt.get(o.from), f = child?.fields.find((x) => x.column === o.fk);
        if (!f || f.req === c.to || fieldChangeReq.has(`${o.from}|${o.fk}`)) continue;
        emit({ cls: 'modifying', op: 'modify-field', target: `${o.from}.${f.field}`, change: `Req ${show(c.from)} → ${show(c.to)} (the parent end of the line changed)`, evidence: ev(tableOf(o.from), o.fk), supersedes: sup('field', o.from, o.fk), confidence: 'High', decTarget: `${o.from}.${f.field}` }, oField.has(`${o.from}|${o.fk}`));
      }
    }
  }
  for (const h of theirs.headerRels) notProposed.push(`A line between ${h.from} and ${h.to} is attached to a table header, not to rows: not proposed. Attach it to the PK and FK rows and pull again.`);
  for (const e of theirs.entities) if (e.id && !baseEnt.has(e.id) && !n.deprecatedEntityIds.has(e.id) && !newEnt.has(e.key) && !oursEnt.has(e.id)) warnings.push(`${e.table}: unknown ERD_ID ${e.id}`);

  // ---- number the ops and resolve pairings
  ops.forEach((o, i) => { o.id = `CS-${i + 1}`; });
  let qn = 0;
  for (const o of ops) {
    if (o.op === 'raise-question') { o.target = `Q-new-${++qn}`; }
    if (o.pairOf) { o.change += `. Pairs with ${o.pairOf.id}`; o.pairOf.change += `. Pairs with ${o.id}`; }
  }
  const counts = ['additive', 'modifying', 'breaking', 'conflict'].map((k) => ops.filter((o) => o.cls === k).length);
  return { ops, counts, details, notProposed, warnings, url, source, takenAt: snapshot.takenAt };
}

export function renderChangeset(r, { run, baseVersion }) {
  const [a, m, b, c] = r.counts;
  const out = [
    `# ERD change set: ${run} (Lucid)`, '',
    '| | |', '|---|---|',
    `| Base ERD version | ${baseVersion} |`,
    `| New sources | ${r.source} (see \`sources.md\`) |`,
    `| Proposed | ${a} additive · ${m} modifying · ${b} breaking · ${c} conflict |`,
    '| Decided | pending |', '',
    '## Summary',
    `Edits made in the Lucid document${r.url ? ` (${r.url})` : ''}, read at ${r.takenAt}, differ from ERD v${baseVersion} in ${r.ops.length} proposed change(s). Citations point at the tables and rows of that document.`, '',
    '## Proposed changes',
    '| ID | Class | Op | Target | Change | Evidence | Supersedes | Confidence | Decision |',
    '|---|---|---|---|---|---|---|---|---|',
    ...r.ops.map((o) => `| ${o.id} | ${o.cls} | ${o.op} | ${cell(o.target)} | ${cell(o.change)} | ${cell(o.evidence)} | ${cell(o.supersedes)} | ${o.confidence} | pending |`), '',
  ];
  if (r.details.length) {
    out.push('## Field detail');
    for (const d of r.details) {
      out.push(`### ${d.op.id}`, '| Field | Column | Type | Req | Key | Description | Sources |', '|---|---|---|---|---|---|---|', ...d.rows.map((x) => `| ${x.field} | ${x.column} | ${cell(x.type)} | ${x.req} | ${x.key} | ${x.description} | ${x.sources} |`), '');
    }
  }
  out.push('## Not proposed', ...(r.notProposed.length ? r.notProposed.map((s) => `- ${s}`) : ['- (none)']), '');
  return out.join('\n');
}
