import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeErd, entitySize, toBaseline } from '../lib/model.mjs';
import { toSeen } from '../lib/snapshot.mjs';
import { firstPush, incrementalPush, unpulled } from '../lib/push.mjs';
import { genLarge } from '../../erd-view/test/gen-large.mjs';
import { baselineMd, groupedMd, stateFor, snapshotFor, edit, shape, row, mdEdit, cli } from './helpers.mjs';

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const opts = { date: '2026-10-20' };
const allOps = (plan) => plan.batches.flat();
const parses = (src) => { try { new AsyncFunction('skills', src); return true; } catch (e) { return String(e); } };
const run = (...args) => spawnSync('node', [cli, ...args], { encoding: 'utf8' });
const deprecateField = (md, col) => mdEdit(md, `| ${col} |`, (l) => l.replace(/\| [YN] \|/, '| — |').replace(/\| ([^|]*?) \| ([^|]*) \|$/, (m, d, s) => `| DEPRECATED v2: ${d} | ${s} |`));

test('first push: one entity per live entity, no lines to the LOOKUP table, nothing deprecated', () => {
  let md = mdEdit(groupedMd, '### E-15', (l) => l); // sanity: the line exists
  const n = normalizeErd(md);
  const plan = firstPush(n, opts);
  const ops = allOps(plan);
  const creates = ops.filter((o) => o.op === 'create-entity'), rels = ops.filter((o) => o.op === 'create-rel');
  assert.equal(creates.length, n.entities.length);
  const lookup = n.entities.find((e) => e.kind === 'Lookup');
  assert.ok(lookup && creates.some((o) => o.id === lookup.id), 'the lookup entity is drawn');
  assert.ok(rels.length > 0 && rels.every((o) => o.primary !== lookup.id && o.foreign !== lookup.id));
  assert.equal(ops.filter((o) => o.op === 'finalize').length, 1);
  assert.ok(creates.every((o) => o.rows.length && o.rows.every((r) => 'name' in r && 'key' in r && 'type' in r)));
});

test('first push leaves out deprecated entities, fields and lines', () => {
  let md = mdEdit(baselineMd, '- **Kind:** Reference', (l) => l); // keep structure
  md = mdEdit(md, '### E-13 ', (l) => l);
  md = md.replace('### E-13 CCA Case Note (`CCA_CASE_NOTE`)\n', '### E-13 CCA Case Note (`CCA_CASE_NOTE`)\n- **Status:** Deprecated in v2: replaced\n');
  md = deprecateField(md, 'SSN');
  md = mdEdit(md, '| R-18 |', (l) => l.replace('A county has many providers', 'DEPRECATED v2: A county has many providers'));
  const ops = allOps(firstPush(normalizeErd(md), opts));
  assert.ok(!ops.some((o) => o.id === 'E-13'));
  assert.ok(!ops.some((o) => o.op === 'create-rel' && (o.id === 'R-11' || o.id === 'R-18')), 'lines of a deprecated entity or a deprecated line');
  assert.ok(!ops.find((o) => o.id === 'E-2').rows.some((r) => r.name === 'SSN'));
  assert.equal(ops.filter((o) => o.op === 'create-entity').length, 13);
});

test('an incremental push after deprecating one field emits exactly one remove-field', () => {
  const md = deprecateField(baselineMd, 'SSN');
  const state = stateFor(baselineMd);
  const plan = incrementalPush(normalizeErd(md), state, snapshotFor(baselineMd), opts);
  assert.deepEqual(plan.counts, { 'remove-field': 1 });
  const sync = plan.ops.filter((o) => o.op === 'sync-fields');
  assert.equal(sync.length, 1);
  assert.equal(sync[0].id, 'E-2');
  assert.ok(!sync[0].rows.some((r) => r.name === 'SSN'));
  assert.ok(!plan.ops.some((o) => ['create-entity', 'delete-entity', 'create-rel', 'delete-rel'].includes(o.op)));
});

test('an incremental push covers add, update and reorder of rows; entity attributes; lines', () => {
  let md = baselineMd.replace('| createdBy | CREATED_BY | User | Y |  | Row creator | CONVENTION |\n\n### E-9 ', '| createdBy | CREATED_BY | User | Y |  | Row creator | CONVENTION |\n| nickname | NICKNAME | Text(30) | N |  | Preferred name | [S3 @00:09:15] |\n\n### E-9 ');
  assert.notEqual(md, baselineMd);
  md = mdEdit(md, '| countyId | COUNTY_ID | Integer | Y | FK→E-14 | County that received the household', (l) => l.replace('| Integer |', '| Text(5) |'));
  md = md.replace('- **Sensitivity:** PII\n- **Sources:** [S1 §Glossary] [S3 @00:01:02]', '- **Sensitivity:** None\n- **Sources:** [S1 §Glossary] [S3 @00:01:02]');
  md = mdEdit(md, '| R-6 |', (l) => l.replace('one-to-one', 'many-to-one'));
  md = mdEdit(md, '| R-18 |', (l) => l.replace('A county has many providers', 'DEPRECATED v2: A county has many providers'));
  const plan = incrementalPush(normalizeErd(md), stateFor(baselineMd), snapshotFor(baselineMd), opts);
  assert.equal(plan.summary['add-field'], 1);
  assert.equal(plan.summary['update-field'], 1);
  assert.equal(plan.summary['update-entity'], 1);
  assert.equal(plan.summary['update-rel'], 1);
  assert.equal(plan.summary['delete-rel'], 1);
  const o = plan.ops.find((x) => x.op === 'update-rel' && x.id === 'R-6');
  assert.equal(o.fc, 'zeroOrMany');
  assert.ok(plan.ops.find((x) => x.op === 'delete-rel').lineId === 'LN-R-18');

  const swapped = baselineMd.replace('| createdAt | CREATED_AT | Date and Time | Y |  | Row creation timestamp | CONVENTION |\n| createdBy | CREATED_BY | User | Y |  | Row creator | CONVENTION |\n\n### E-2 ', '| createdBy | CREATED_BY | User | Y |  | Row creator | CONVENTION |\n| createdAt | CREATED_AT | Date and Time | Y |  | Row creation timestamp | CONVENTION |\n\n### E-2 ');
  assert.notEqual(swapped, baselineMd);
  const moved = incrementalPush(normalizeErd(swapped), stateFor(baselineMd), snapshotFor(baselineMd), opts);
  assert.deepEqual(moved.counts, { 'move-field': 1 });
});

test('an incremental push creates new entities and lines, and deleting an entity does not also delete its lines', () => {
  const gone = baselineMd.replace('### E-13 CCA Case Note (`CCA_CASE_NOTE`)\n', '### E-13 CCA Case Note (`CCA_CASE_NOTE`)\n- **Status:** Deprecated in v2: replaced\n');
  const del = incrementalPush(normalizeErd(gone), stateFor(baselineMd), snapshotFor(baselineMd), opts);
  assert.equal(del.counts['delete-entity'], 1);
  assert.ok(!del.ops.some((o) => o.op === 'delete-rel'));

  const added = baselineMd.replace('## Relationships', `### E-15 CCA Waitlist (\`CCA_WAITLIST\`)
- **Purpose:** Households waiting for a slot
- **Kind:** Core
- **Group:** Household
- **Est. volume:** unknown
- **Sensitivity:** PII
- **Sources:** CONVENTION

| Field | Column | Type | Req | Key | Description | Sources |
|---|---|---|---|---|---|---|
| id | ID | Integer | Y | PK | Surrogate key | CONVENTION |
| householdId | HOUSEHOLD_ID | Integer | Y | FK→E-1 | Waiting household | CONVENTION |

## Relationships`).replace('| R-18 |', '| R-19 | E-15 CCA Waitlist | E-1 CCA Household | many-to-one | householdId | A household may wait | CONVENTION |\n| R-18 |');
  const plan = incrementalPush(normalizeErd(added), stateFor(baselineMd), snapshotFor(baselineMd), opts);
  const create = plan.ops.find((o) => o.op === 'create-entity');
  assert.equal(create.id, 'E-15');
  assert.ok(create.place && !('x' in create), 'new tables are placed at run time, next to their group');
  assert.ok(plan.ops.some((o) => o.op === 'create-rel' && o.id === 'R-19'));
  assert.ok(plan.ops.some((o) => o.op === 'reroute'));
  assert.equal(plan.ops.at(-1).op, 'update-header');
});

test('guard: unpulled Lucid changes stop the push (library and CLI exit code 3)', () => {
  const state = stateFor(baselineMd);
  const snap = edit(snapshotFor(baselineMd), (s) => { const e = shape(s, 'CCA_COUNTY'); e.fields.push({ index: 3, name: 'POPULATION', key: '', type: 'Integer', nullable: true }); });
  assert.equal(unpulled(snap, state).length, 1);
  assert.equal(unpulled(snapshotFor(baselineMd), state).length, 0);
  const dir = mkdtempSync(join(tmpdir(), 'lucid-'));
  writeFileSync(join(dir, 'ERD.md'), baselineMd);
  writeFileSync(join(dir, 'lucid.json'), JSON.stringify(state));
  writeFileSync(join(dir, 'snap.json'), JSON.stringify(snap));
  const r = run('push-plan', join(dir, 'ERD.md'), '--state', join(dir, 'lucid.json'), '--snapshot', join(dir, 'snap.json'), '--out', join(dir, 'out'));
  assert.equal(r.status, 3);
  assert.match(r.stderr, /Lucid has 1 unpulled change\(s\)\. Run pull first\./);
  assert.ok(!existsSync(join(dir, 'out', 'batch-001.js')));
});

test('after a pull that rejected a Lucid edit, the push puts Lucid back in line with ERD.md', () => {
  const state = stateFor(baselineMd);
  const snap = edit(snapshotFor(baselineMd), (s) => { row(s, 'CCA_HOUSEHOLD_MEMBER', 'FULL_NAME').type = 'Text(250) NOT NULL'; });
  state.seen = toSeen(state.baseline, snap); // what `record --pull` stores
  assert.equal(unpulled(snap, state).length, 0);
  const plan = incrementalPush(normalizeErd(baselineMd), state, snap, opts);
  assert.deepEqual(plan.counts, { 'update-field': 1 });
  const rows = plan.ops.find((o) => o.op === 'sync-fields').rows;
  assert.equal(rows.find((r) => r.name === 'FULL_NAME').type, 'Text(100) NOT NULL');
});

test('adopt rule: a table drawn in Lucid and accepted through a pull is stamped, not created twice', () => {
  const state = stateFor(baselineMd);
  const snap = edit(snapshotFor(baselineMd), (s) => { const e = shape(s, 'CCA_COUNTY'); e.shapeData = {}; });
  state.seen = toSeen(state.baseline, snap);
  const plan = incrementalPush(normalizeErd(baselineMd), state, snap, opts);
  const adopt = plan.ops.filter((o) => o.op === 'adopt-entity');
  assert.equal(adopt.length, 1);
  assert.equal(adopt[0].id, 'E-14');
  assert.equal(adopt[0].lucidId, 'L-E-14');
  assert.ok(!plan.ops.some((o) => o.op === 'create-entity'));
  assert.ok(!plan.ops.some((o) => o.op === 'create-rel'), 'the lines to the adopted table already exist');
  assert.ok(!plan.ops.some((o) => o.op === 'delete-entity'));
});

test('shapes and lines people added that ERD.md does not know are left alone, with a warning', () => {
  const state = stateFor(baselineMd);
  const snap = edit(snapshotFor(baselineMd), (s) => {
    s.entities.push({ lucidId: 'L-X', name: 'SCRATCH', boundingBox: { x: 0, y: 0, w: 1, h: 1 }, shapeData: {}, fields: [{ index: 1, name: 'ID', key: 'PK', type: 'Integer NOT NULL', nullable: false }] });
  });
  state.seen = toSeen(state.baseline, snap);
  const plan = incrementalPush(normalizeErd(baselineMd), state, snap, opts);
  assert.equal(plan.ops.length, 0);
  assert.ok(plan.warnings.some((w) => /SCRATCH/.test(w)));
});

test('batches respect the configured size, keep phase order, and every script parses', () => {
  const n = normalizeErd(baselineMd);
  for (const size of [1, 5, 40]) {
    const plan = firstPush(n, { ...opts, batchSize: size });
    assert.ok(plan.batches.every((b) => b.length <= size), `size ${size}`);
    const order = allOps(plan).map((o) => o.op);
    assert.ok(order.lastIndexOf('create-entity') < order.indexOf('create-rel') && order.lastIndexOf('create-rel') < order.indexOf('finalize'));
  }
  const dir = mkdtempSync(join(tmpdir(), 'lucid-'));
  writeFileSync(join(dir, 'ERD.md'), baselineMd);
  const r = run('push-plan', join(dir, 'ERD.md'), '--out', join(dir, 'out'), '--batch-size', '10');
  assert.equal(r.status, 0, r.stderr);
  const files = readdirSync(join(dir, 'out')).filter((f) => f.endsWith('.js'));
  assert.equal(files.length, 5); // 14 entities -> 2, 18 lines -> 2, finalize -> 1
  for (const f of files) assert.equal(parses(readFileSync(join(dir, 'out', f), 'utf8')), true, f);
  const plan = JSON.parse(readFileSync(join(dir, 'out', 'plan.json'), 'utf8'));
  assert.deepEqual(plan.counts, { entities: 14, relationships: 18 });
  assert.equal(parses(run('snapshot-script').stdout), true);
});

test('the incremental batch scripts parse too', () => {
  const md = deprecateField(baselineMd, 'SSN');
  const dir = mkdtempSync(join(tmpdir(), 'lucid-'));
  writeFileSync(join(dir, 'ERD.md'), md);
  writeFileSync(join(dir, 'lucid.json'), JSON.stringify(stateFor(baselineMd)));
  writeFileSync(join(dir, 'snap.json'), JSON.stringify(snapshotFor(baselineMd)));
  const r = run('push-plan', join(dir, 'ERD.md'), '--state', join(dir, 'lucid.json'), '--snapshot', join(dir, 'snap.json'), '--out', join(dir, 'out'));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Incremental push: 1 remove-field/);
  for (const f of readdirSync(join(dir, 'out')).filter((x) => x.endsWith('.js'))) assert.equal(parses(readFileSync(join(dir, 'out', f), 'utf8')), true, f);
});

test('a doc that already matches ERD.md produces no batches', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lucid-'));
  writeFileSync(join(dir, 'ERD.md'), baselineMd);
  writeFileSync(join(dir, 'lucid.json'), JSON.stringify(stateFor(baselineMd)));
  writeFileSync(join(dir, 'snap.json'), JSON.stringify(snapshotFor(baselineMd)));
  const r = run('push-plan', join(dir, 'ERD.md'), '--state', join(dir, 'lucid.json'), '--snapshot', join(dir, 'snap.json'), '--out', join(dir, 'out'));
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Lucid doc matches ERD v1\./);
  assert.deepEqual(readdirSync(join(dir, 'out')).filter((f) => f.endsWith('.js')), []);
});

test('large model (150 entities): batch count, and no two tables closer than 160 px', () => {
  const { md, entities } = genLarge(150, 7, { grouped: true });
  const n = normalizeErd(md);
  assert.equal(n.entities.length, entities);
  const plan = firstPush(n, opts);
  const size = Math.ceil(n.entities.length / 40), rels = Math.ceil(n.relationships.length / 40);
  assert.equal(plan.batches.length, size + rels + 1);
  assert.ok(plan.batches.every((b) => b.length <= 40));
  const rects = n.entities.map((e) => ({ id: e.id, ...plan.positions[e.id], ...entitySize(e) }));
  assert.equal(rects.length, n.entities.length);
  let min = Infinity;
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i], b = rects[j];
    const gx = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w)), gy = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h));
    min = Math.min(min, Math.max(gx, gy));
  }
  assert.ok(min >= 160, `closest gap is ${min}px`);
  assert.ok(allOps(plan).every((o) => o.op !== 'create-rel' || !o.label || o.label.length <= 40));
});

test('CLI: init, first push, record, then a matching incremental push', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lucid-'));
  writeFileSync(join(dir, 'ERD.md'), baselineMd);
  const st = join(dir, 'lucid.json');
  assert.equal(run('init', '--state', st, '--doc-id', 'abc', '--doc-url', 'https://lucid.app/lucidchart/abc/edit', '--title', 'T').status, 0);
  assert.equal(run('push-plan', join(dir, 'ERD.md'), '--state', st, '--out', join(dir, 'o1')).status, 0);
  writeFileSync(join(dir, 'ids.json'), JSON.stringify({ 'E-1': 'x', 'E-99': 'stale', 'F:CCA Household': 'frame' }));
  const rec = run('record', '--push', join(dir, 'ERD.md'), '--ids', join(dir, 'ids.json'), '--state', st);
  assert.equal(rec.status, 0, rec.stderr);
  const state = JSON.parse(readFileSync(st, 'utf8'));
  assert.equal(state.document.id, 'abc');
  assert.equal(state.lastPush.erdVersion, 1);
  assert.deepEqual(state.ids, { 'E-1': 'x', 'F:CCA Household': 'frame' }, 'ids of elements that no longer exist are pruned');
  assert.equal(state.baseline.entities.length, 14);
  assert.deepEqual(state.baseline, state.seen);
  assert.deepEqual(state.baseline, toBaseline(normalizeErd(baselineMd)));
});
