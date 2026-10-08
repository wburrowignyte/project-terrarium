// Parse an ERD.md (see skills/erd-build/references/erd-format.md) into a plain model.
// Primary source: Entities + Relationships tables. Fallback/gap-fill: the mermaid erDiagram block.

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
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|'));
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
        cur.fields.push({ type: a[1], column: a[2], key: rest.filter((r) => /^(PK|FK|UK)$/.test(r)).join(',') });
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
  const model = { title: '', meta: {}, summary: '', entities: [], relationships: [], assumptions: [], questions: [], deferred: '', warnings };
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
      sensitivity: bullet(s.body, 'Sensitivity'), sources: bullet(s.body, 'Sources'),
      fields: parseTable(s.body).map((r) => ({
        field: colKey(r, 'field'), column: stripTicks(colKey(r, 'column')), type: colKey(r, 'type'),
        req: /^y/i.test(colKey(r, 'req')), key: colKey(r, 'key'), description: colKey(r, 'description'), sources: colKey(r, 'sources'),
      })).filter((f) => f.column),
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
      id, from: from.id, to: to.id, cardinality: card, fk: colKey(r, 'fk'), description: colKey(r, 'description'), sources: colKey(r, 'sources'), label: '',
    });
  }

  // ---- mermaid fallback / gap-fill
  const mm = parseMermaid(md);
  let next = model.entities.reduce((n, e) => Math.max(n, +e.id.slice(2) || 0), 0);
  for (const [table, me] of mm.entities) {
    let e = byTable.get(table);
    if (!e) {
      e = { id: `E-${++next}`, name: table, table, purpose: '', kind: '', volume: '', sensitivity: '', sources: '', fields: [], fromMermaidOnly: true };
      byTable.set(table, e); byId.set(e.id, e); model.entities.push(e);
      warnings.push(`${table}: only in Mermaid block (no Entities section)`);
    }
    if (!e.fields.length) e.fields = me.fields.map((f) => ({ field: '', column: f.column, type: f.type, req: false, key: f.key, description: '', sources: '' }));
  }
  const have = new Set(model.relationships.map((r) => [byId.get(r.from)?.table, byId.get(r.to)?.table].sort().join('|')));
  for (const r of mm.relationships) {
    const A = byTable.get(r.a), B = byTable.get(r.b);
    const sig = [A.table, B.table].sort().join('|');
    const l = endCard(r.left, 'left'), rt = endCard(r.right, 'right');
    // label: attach to existing table-derived relationship if any
    const existing = model.relationships.find((x) => [byId.get(x.from)?.table, byId.get(x.to)?.table].sort().join('|') === sig && !x.label);
    if (existing) { existing.label = r.label; continue; }
    if (have.has(sig)) continue;
    // Child (many) side is the "from".
    let from = A, to = B, card;
    if (l.many && rt.many) card = 'many-to-many';
    else if (l.many) { from = A; to = B; card = 'many-to-one'; }
    else if (rt.many) { from = B; to = A; card = 'many-to-one'; }
    else card = 'one-to-one';
    model.relationships.push({ id: `R-m${model.relationships.length + 1}`, from: from.id, to: to.id, cardinality: card, fk: '', description: '', sources: '', label: r.label });
    warnings.push(`Relationship ${A.table} -> ${B.table} only in Mermaid block`);
  }

  // ---- integrity checks
  for (const e of model.entities) for (const f of e.fields) {
    const m = f.key.match(/FK→(E-\d+)/);
    if (m && !byId.has(m[1])) warnings.push(`${e.table}.${f.column}: FK targets unknown ${m[1]}`);
  }
  for (const k of ['assumptions', 'questions']) {
    model[k] = parseTable(find(k === 'questions' ? 'open questions' : 'assumptions')).filter((r) => Object.values(r).some(Boolean));
  }
  return model;
}
