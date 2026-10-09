#!/usr/bin/env node
// Context helper for erd-assist: print small slices of an ERD.md instead of the whole file. No dependencies.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseErd, parseMermaid } from '../erd-view/lib/parse.mjs';

const USAGE = `Usage: node erd-slice.mjs <ERD.md> [--outline] [--log N] [--ids E-3,R-5,Q-2] [--neighbors] [--find text]
                                   [--next-ids] [--check [ids]] [--decisions DECISIONS.md]
  --outline       header, section line ranges, one line per entity, R/A/Q counts
  --log N         last N Change log rows (default 3 with --outline)
  --ids ...       full E-n sections, R/A/Q rows, E-n.field rows; plus their relationships and Mermaid
  --neighbors     with --ids: outline lines of entities one relationship hop away
  --find text     entities and fields whose name, table or column matches (case-insensitive)
  --next-ids      next free E-, R-, A-, Q- IDs
  --check [ids]   integrity check (exit 1 on errors); with ids, only issues near them
  --decisions     DECISIONS.md for [DEC-n] checks (default: DECISIONS.md beside the ERD, if present)`;

const dash = '–';
const cells = (l) => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim());
const isRow = (l, id) => new RegExp(`^\\|\\s*${id}\\s*\\|`).test(l);
const idOf = (s) => (s.match(/\b[EARQ]-\d+\b/) ?? [])[0];
const idNum = (id) => +id.slice(2);
const baseId = (s) => s.split('.')[0];

// ---- line scan: sections, entity ranges, row ids (headings inside code fences are ignored)
function scan(md) {
  const lines = md.split('\n');
  const sections = [], entities = [];
  let fence = false;
  lines.forEach((l, i) => {
    if (/^```/.test(l)) { fence = !fence; return; }
    if (fence) return;
    const n = i + 1;
    let m;
    if ((m = l.match(/^## (.+)$/))) sections.push({ title: m[1].trim(), start: n });
    else if ((m = l.match(/^### (E-\d+)\b/))) entities.push({ id: m[1], start: n, heading: l });
  });
  const heads = [...sections.map((s) => s.start), ...entities.map((e) => e.start)].sort((a, b) => a - b);
  const endOf = (start, list) => (list.find((h) => h > start) ?? lines.length + 1) - 1;
  for (const s of sections) s.end = endOf(s.start, sections.map((x) => x.start));
  for (const e of entities) e.end = endOf(e.start, heads);
  return { lines, sections, entities };
}

const section = (sc, prefix) => sc.sections.find((s) => s.title.toLowerCase().startsWith(prefix));
const slice = (sc, a, b) => sc.lines.slice(a - 1, b).join('\n').replace(/\n+$/, '');

// Rows (`| X-n |`) of a section, with their 1-based line numbers, and the table's header lines.
function rowsIn(sc, sec, letter) {
  if (!sec) return { head: [], rows: [] };
  const rows = [];
  let head = [];
  for (let n = sec.start; n <= sec.end; n++) {
    const l = sc.lines[n - 1];
    if (!head.length && l.startsWith('|') && sc.lines[n]?.startsWith('|')) head = [l, sc.lines[n]];
    if (new RegExp(`^\\|\\s*${letter}-\\d+\\s*\\|`).test(l)) rows.push({ n, line: l, id: idOf(cells(l)[0]) });
  }
  return { head, rows };
}

const SECTION_OF = { R: 'relationships', A: 'assumptions', Q: 'open questions' };

// ---- the model: parseErd plus line ranges
export function load(md, decisionsMd) {
  const model = parseErd(md);
  const sc = scan(md);
  const ents = model.entities.filter((e) => !e.fromMermaidOnly);
  const range = new Map(sc.entities.map((e) => [e.id, e]));
  const byId = new Map(ents.map((e) => [e.id, e]));
  const tables = Object.fromEntries(Object.keys(SECTION_OF).map((k) => [k, rowsIn(sc, section(sc, SECTION_OF[k]), k)]));
  return { md, model, sc, ents, range, byId, tables, decisions: decisionsMd == null ? null : parseDecisions(decisionsMd) };
}

export function parseDecisions(md) {
  const index = new Map();
  for (const l of md.split('\n')) {
    const m = l.match(/^\|\s*DEC-(\d+)\s*\|([^|]*)\|([^|]*)\|/);
    if (m) index.set(+m[1], { status: m[3].trim(), dup: index.has(+m[1]) });
  }
  const last = +(md.match(/^\|\s*Last ID\s*\|\s*DEC-(\d+)/m) ?? [])[1] || 0;
  const active = +(md.match(/^\|\s*Active\s*\|\s*(\d+)/m) ?? [])[1];
  return { index, last, active };
}

const outlineLine = (v, e) => {
  const group = v.model.groupsDerived ? '—' : (e.group || '—');
  const r = v.range.get(e.id);
  return `${e.id} ${e.name} (${e.table}) · ${e.kind || '—'} · ${group} · ${e.sensitivity || '—'} · [lines ${r.start}${dash}${r.end}]`;
};

// ---- --outline
function outline(v) {
  const { sc, tables } = v;
  const out = [];
  const head = sc.lines.slice(0, (sc.sections[0]?.start ?? sc.lines.length + 1) - 1).filter((l) => l.startsWith('|') || /^# /.test(l));
  out.push(...head, '');
  for (const s of sc.sections) out.push(`## ${s.title} [lines ${s.start}${dash}${s.end}]`);
  out.push('', '### Entities');
  for (const e of v.ents) if (v.range.has(e.id)) out.push(outlineLine(v, e));
  const open = tables.Q.rows.filter((r) => !/resolved/i.test(r.line)).length;
  out.push('', `Relationships ${tables.R.rows.length} · Assumptions ${tables.A.rows.length} · Questions ${tables.Q.rows.length} (${open} open)`);
  return out.join('\n');
}

// ---- --log
function changeLog(v, n) {
  const sec = section(v.sc, 'change log');
  if (!sec) return '(no Change log)';
  const rows = [];
  let head = [];
  for (let i = sec.start; i <= sec.end; i++) {
    const l = v.sc.lines[i - 1];
    if (!l.startsWith('|')) continue;
    if (!head.length) { head = [l, v.sc.lines[i]]; i++; continue; }
    rows.push(l);
  }
  return ['## Change log (last ' + Math.min(n, rows.length) + ')', ...head, ...rows.slice(-n)].join('\n');
}

// ---- --ids
function mermaidLines(v) {
  const m = v.md.match(/```mermaid\s*\n\s*erDiagram\s*\n([\s\S]*?)```/);
  return m ? m[1].split('\n') : [];
}

function mermaidFor(v, tableNames) {
  const lines = mermaidLines(v);
  const out = [];
  const set = new Set(tableNames);
  for (const l of lines) {
    const rel = l.trim().match(/^(\S+)\s+[|}][|o](?:--|\.\.)[|o][|{]\s+(\S+)/);
    if (rel && (set.has(rel[1]) || set.has(rel[2]))) out.push(l);
  }
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].trim().match(/^([A-Za-z0-9_."-]+)\s*\{$/);
    if (!open || !set.has(open[1])) continue;
    let j = i; while (j < lines.length && lines[j].trim() !== '}') j++;
    out.push(...lines.slice(i, j + 1));
  }
  return out.length ? ['```mermaid', 'erDiagram', ...out, '```'].join('\n') : '';
}

function neighborIds(v, ids) {
  const set = new Set(ids);
  const near = new Set();
  for (const r of v.model.relationships) {
    if (set.has(r.from) && !set.has(r.to)) near.add(r.to);
    if (set.has(r.to) && !set.has(r.from)) near.add(r.from);
  }
  return [...near].filter((id) => v.range.has(id));
}

function pick(v, ids, withNeighbors) {
  const out = [];
  const entIds = [];
  const unknown = [];
  for (const raw of ids) {
    const id = raw.trim();
    const [base, field] = id.split('.');
    if (/^E-\d+$/.test(base)) {
      const r = v.range.get(base);
      if (!r) { unknown.push(id); continue; }
      if (!entIds.includes(base)) entIds.push(base);
      if (!field) { out.push(slice(v.sc, r.start, r.end)); continue; }
      const e = v.byId.get(base);
      const want = field.toLowerCase();
      const fi = e.fields.find((f) => [f.field, f.column].some((x) => x && x.toLowerCase() === want));
      if (!fi) { unknown.push(id); continue; }
      let head = [], row = '';
      for (let n = r.start; n <= r.end; n++) {
        const l = v.sc.lines[n - 1];
        if (!l.startsWith('|')) continue;
        if (!head.length) { head = [l, v.sc.lines[n]]; n++; continue; }
        const c = cells(l);
        if (c[0] === fi.field && c[1].replace(/`/g, '') === fi.column) { row = l; break; }
      }
      out.push([`${v.sc.lines[r.start - 1]} [${id}]`, ...head, row].join('\n'));
    } else if (/^[RAQ]-\d+$/.test(base)) {
      const t = v.tables[base[0]];
      const row = t.rows.find((x) => x.id === base);
      if (!row) { unknown.push(id); continue; }
      out.push([...t.head, row.line].join('\n'));
    } else unknown.push(id);
  }
  const full = entIds;
  // Relationships rows that reference a requested entity
  if (full.length) {
    const rels = v.tables.R.rows.filter((r) => { const c = cells(r.line); return full.some((e) => new RegExp(`\\b${e}\\b`).test(c[1] + ' ' + c[2])); });
    if (rels.length) out.push(['## Relationships touching ' + full.join(', '), ...v.tables.R.head, ...rels.map((r) => r.line)].join('\n'));
    const mm = mermaidFor(v, full.map((e) => v.byId.get(e).table));
    if (mm) out.push(mm);
  }
  if (withNeighbors) {
    const near = neighborIds(v, full);
    if (near.length) out.push(['## Neighbors (one hop)', ...near.map((e) => outlineLine(v, v.byId.get(e)))].join('\n'));
  }
  if (unknown.length) out.push(`not found: ${unknown.join(', ')}`);
  return out.join('\n\n');
}

// ---- --find
function find(v, text) {
  const q = text.toLowerCase();
  const has = (s) => (s ?? '').toLowerCase().includes(q);
  const out = [];
  for (const e of v.ents) {
    if (!v.range.has(e.id)) continue;
    if (has(e.name) || has(e.table)) out.push(outlineLine(v, e));
    for (const f of e.fields) if (has(f.field) || has(f.column)) out.push(`${e.id}.${f.field || f.column} · ${f.column} · ${f.type} · Req ${f.req ? 'Y' : 'N'} · ${f.key || '—'}`);
  }
  return out.length ? out.join('\n') : `no match for "${text}"`;
}

// ---- --next-ids
function nextIds(v) {
  const max = { E: 0, R: 0, A: 0, Q: 0 };
  for (const e of v.sc.entities) max.E = Math.max(max.E, idNum(e.id));
  for (const k of 'RAQ') for (const r of v.tables[k].rows) max[k] = Math.max(max[k], idNum(r.id));
  return ['E', 'R', 'A', 'Q'].map((k) => `${k}-${max[k] + 1}`).join(' ');
}

// ---- --check
export function check(v, ids) {
  const issues = [];
  const add = (level, touches, msg) => issues.push({ level, touches, msg });
  const { model, ents } = v;
  const entIds = new Set(ents.map((e) => e.id));

  // duplicate IDs
  const seen = new Map();
  for (const e of v.sc.entities) { if (seen.has(e.id)) add('error', [e.id], `${e.id}: duplicate entity ID`); seen.set(e.id, 1); }
  for (const k of 'RAQ') {
    const s = new Set();
    for (const r of v.tables[k].rows) { if (s.has(r.id)) add('error', [r.id], `${r.id}: duplicate ID`); s.add(r.id); }
  }

  // FK targets and Relationships FK fields
  for (const e of ents) for (const f of e.fields) {
    const m = (f.key || '').match(/FK→(E-\d+)/);
    if (m && !f.deprecated && !entIds.has(m[1])) add('error', [e.id, m[1]], `${e.id}.${f.field || f.column}: FK→${m[1]} targets a missing entity`);
  }
  for (const r of model.relationships) {
    if (r.deprecated || /^R-m/.test(r.id)) continue;
    const child = v.byId.get(r.from);
    if (!child || !r.fk) continue;
    const want = r.fk.toLowerCase();
    if (!child.fields.some((f) => [f.field, f.column].some((x) => x && x.toLowerCase() === want)))
      add('error', [r.id, r.from, r.to], `${r.id}: FK field "${r.fk}" is not a field of ${r.from} ${child.table}`);
  }

  // Mermaid vs tables (deprecated excluded)
  const live = new Map(ents.filter((e) => !e.deprecated).map((e) => [e.table, e]));
  const dep = new Set(ents.filter((e) => e.deprecated).map((e) => e.table));
  const mm = parseMermaid(v.md).entities;
  for (const t of mm.keys()) if (!live.has(t) && !dep.has(t)) add('error', [t], `${t}: in the Mermaid block but has no entity table`);
  if (mm.size) for (const [t, e] of live) if (!mm.has(t)) add('error', [e.id], `${e.id} ${t}: has an entity table but is missing from the Mermaid block`);

  // [DEC-n] citations
  if (v.decisions) {
    const cited = new Map();
    let cur = null;
    v.sc.lines.forEach((l, i) => {
      const h = l.match(/^### (E-\d+)\b/);
      if (h) cur = h[1]; else if (/^## /.test(l)) cur = null;
      for (const m of l.matchAll(/\[DEC-(\d+)\]/g)) {
        const where = idOf(l.startsWith('|') ? cells(l)[0] : '') ?? cur;
        const k = +m[1];
        if (!cited.has(k)) cited.set(k, new Set());
        cited.get(k).add(where ?? cur ?? `line ${i + 1}`);
      }
    });
    for (const [k, where] of cited) {
      const d = v.decisions.index.get(k);
      const at = [...where].join(', ');
      if (!d) add('error', [...where], `[DEC-${k}] cited at ${at} is not in the DECISIONS.md Index`);
      else if (d.status !== 'Active') add('warning', [...where], `[DEC-${k}] cited at ${at} is not Active (${d.status})`);
    }
    for (const [k, d] of v.decisions.index) if (d.dup) add('error', [], `DEC-${k}: duplicate Index row`);
    const act = [...v.decisions.index.values()].filter((d) => d.status === 'Active').length;
    if (v.decisions.active != null && v.decisions.active !== act) add('warning', [], `DECISIONS.md header says Active ${v.decisions.active}, the Index has ${act}`);
  }

  // parseErd warnings
  for (const w of model.warnings) {
    const touches = [...(w.match(/\b[ER]-\d+\b/g) ?? []), ...ents.filter((e) => w.includes(e.table)).map((e) => e.id)];
    add('warning', touches, w);
  }

  if (!ids?.length) return issues;
  // Only issues touching the given IDs and their 1-hop neighbours.
  const want = new Set();
  for (const raw of ids) {
    const b = baseId(raw);
    want.add(b);
    if (b.startsWith('R-')) { const r = model.relationships.find((x) => x.id === b); if (r) { want.add(r.from); want.add(r.to); } }
  }
  for (const e of [...want].filter((x) => x.startsWith('E-'))) {
    for (const n of neighborIds(v, [e])) want.add(n);
    for (const r of model.relationships) if (r.from === e || r.to === e) want.add(r.id);
  }
  for (const e of ents) if (want.has(e.id)) want.add(e.table);
  return issues.filter((i) => i.touches.some((t) => want.has(t)));
}

// ---- entry point
export function run(md, opts, decisionsMd) {
  const v = load(md, decisionsMd);
  const parts = [];
  let errors = 0;
  const stderr = [];
  if (opts.outline) parts.push(outline(v));
  if (opts.log != null || opts.outline) parts.push(changeLog(v, opts.log ?? 3));
  if (opts.ids) parts.push(pick(v, opts.ids, opts.neighbors));
  if (opts.find != null) parts.push(find(v, opts.find));
  if (opts.nextIds) parts.push(nextIds(v));
  if (opts.check) {
    const issues = check(v, opts.checkIds);
    for (const i of issues) stderr.push(`${i.level}: ${i.msg}`);
    errors = issues.filter((i) => i.level === 'error').length;
    const warns = issues.length - errors;
    parts.push(errors ? `${errors} error(s)` : warns ? `ok (${warns} warning(s))` : 'ok');
  }
  return { stdout: parts.join('\n\n'), stderr, errors };
}

const here = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === here) {
  const args = process.argv.slice(2);
  const opts = {};
  let input, decisionsPath;
  const bad = (m) => { console.error(`${m}\n${USAGE}`); process.exit(2); };
  const val = (i, flag) => { const x = args[i]; if (x == null || x.startsWith('--')) bad(`${flag} needs a value`); return x; };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-h' || a === '--help') { console.log(USAGE); process.exit(0); }
    else if (a === '--outline') opts.outline = true;
    else if (a === '--neighbors') opts.neighbors = true;
    else if (a === '--next-ids') opts.nextIds = true;
    else if (a === '--log') { opts.log = parseInt(val(++i, a), 10); if (!(opts.log > 0)) bad('--log needs a positive number'); }
    else if (a === '--ids') opts.ids = val(++i, a).split(/[,\s]+/).filter(Boolean);
    else if (a === '--find') opts.find = val(++i, a);
    else if (a === '--decisions') decisionsPath = val(++i, a);
    else if (a === '--check') {
      opts.check = true;
      if (args[i + 1] && !args[i + 1].startsWith('--')) opts.checkIds = args[++i].split(/[,\s]+/).filter(Boolean);
    } else if (a.startsWith('--')) bad(`Unknown flag: ${a}`);
    else if (!input) input = a;
    else bad(`Unexpected argument: ${a}`);
  }
  if (!input) bad('Missing <ERD.md>');
  if (!existsSync(input)) { console.error(`File not found: ${input}`); process.exit(2); }
  if (!opts.outline && opts.log == null && !opts.ids && opts.find == null && !opts.nextIds && !opts.check) bad('Nothing to do: pass at least one flag');
  if (opts.neighbors && !opts.ids) bad('--neighbors needs --ids');
  const besides = join(dirname(resolve(input)), 'DECISIONS.md');
  const dPath = decisionsPath ?? (existsSync(besides) ? besides : null);
  const decisionsMd = dPath ? (existsSync(dPath) ? readFileSync(dPath, 'utf8') : '') : null;
  const { stdout, stderr, errors } = run(readFileSync(input, 'utf8'), opts, decisionsMd);
  if (stdout) console.log(stdout);
  for (const l of stderr) console.error(l);
  process.exit(errors ? 1 : 0);
}
