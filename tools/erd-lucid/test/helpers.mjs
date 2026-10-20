import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normalizeErd, toBaseline } from '../lib/model.mjs';
import { modelToSnapshot } from '../lib/snapshot.mjs';

export const root = (p) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
export const read = (p) => readFileSync(root(p), 'utf8');
export const cli = root('tools/erd-lucid/erd-lucid.mjs');

export const baselineMd = read('examples/fixtures/baseline/ERD.md');
export const groupedMd = read('examples/fixtures/grouped-ERD.md');
export const decsMd = read('examples/fixtures/decisions/ERD-with-decs.md');
export const decisionsMd = read('examples/fixtures/decisions/DECISIONS.md');

// lucid.json as it is right after a push of this ERD.md
export const stateFor = (md) => {
  const n = normalizeErd(md);
  return { format: 1, document: { id: 'doc-1', url: 'https://lucid.app/lucidchart/doc-1/edit', title: 'Test', page: 1 }, lastPush: { at: '2026-10-20T12:00:00Z', erdVersion: n.version }, lastPull: { at: null, sourceId: null }, ids: {}, baseline: toBaseline(n), seen: toBaseline(n) };
};

// What the snapshot script returns for a Lucid doc that matches this ERD.md exactly.
export const snapshotFor = (md) => modelToSnapshot(normalizeErd(md));

// Apply `fn` to a deep copy of a snapshot.
export const edit = (snap, fn) => { const s = JSON.parse(JSON.stringify(snap)); fn(s); return s; };
export const shape = (s, table) => s.entities.find((e) => e.name === table);
export const row = (s, table, col) => shape(s, table).fields.find((f) => f.name === col);
export const reindex = (e) => e.fields.forEach((f, i) => { f.index = i + 1; });
export const lineFor = (s, id) => s.relationships.find((r) => r.erdId === id);

// Edit one ERD.md line: replace the first line containing `needle` with `repl(line)`.
export const mdEdit = (md, needle, repl) => {
  const lines = md.split('\n'), i = lines.findIndex((l) => l.includes(needle));
  if (i < 0) throw new Error(`mdEdit: no line contains ${needle}`);
  lines[i] = repl(lines[i]);
  return lines.join('\n');
};
