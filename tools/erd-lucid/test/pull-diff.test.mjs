import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeErd } from '../lib/model.mjs';
import { buildPull, renderChangeset } from '../lib/pull.mjs';
import { baselineMd, decsMd, decisionsMd, stateFor, snapshotFor, edit, shape, row, reindex, lineFor, mdEdit, cli, read } from './helpers.mjs';

const S = 'S9';
const pull = (snap, { md = baselineMd, base = baselineMd, decisions = null } = {}) => buildPull(normalizeErd(md), stateFor(base), snap, { source: S, decisions, url: 'https://lucid.app/lucidchart/doc-1/edit' });
const only = (r) => { assert.equal(r.ops.length, 1, JSON.stringify(r.ops.map((o) => [o.op, o.target, o.change]))); return r.ops[0]; };
const faithful = () => snapshotFor(baselineMd);

test('a doc that matches ERD.md proposes nothing', () => {
  const r = pull(faithful());
  assert.equal(r.ops.length, 0);
  assert.deepEqual(r.notProposed, []);
});

test('position, size and colour changes are ignored', () => {
  const snap = edit(faithful(), (s) => { shape(s, 'CCA_CHILD').boundingBox = { x: 9999, y: 9999, w: 777, h: 99 }; });
  assert.equal(pull(snap).ops.length, 0);
});

test('field added -> add-field (additive), named by the camelCase rule, cited to the Lucid table', () => {
  const snap = edit(faithful(), (s) => { const e = shape(s, 'CCA_HOUSEHOLD_MEMBER'); e.fields.splice(2, 0, { index: 3, name: 'MIDDLE_NAME', key: '', type: 'Text(50)', nullable: true }); reindex(e); });
  const o = only(pull(snap));
  assert.deepEqual([o.cls, o.op, o.target, o.evidence, o.supersedes], ['additive', 'add-field', 'E-2.middleName', '[S9 §CCA_HOUSEHOLD_MEMBER.MIDDLE_NAME]', '—']);
  assert.match(o.change, /MIDDLE_NAME Text\(50\), Req N, Key —/);
});

test('field removed -> deprecate (breaking), superseding the field\'s citations', () => {
  const snap = edit(faithful(), (s) => { const e = shape(s, 'CCA_HOUSEHOLD_MEMBER'); e.fields = e.fields.filter((f) => f.name !== 'SSN'); reindex(e); });
  const o = only(pull(snap));
  assert.deepEqual([o.cls, o.op, o.target, o.supersedes], ['breaking', 'deprecate', 'E-2.ssn', '[S3 @00:02:10] [S2 §Security]']);
});

test('field renamed (same index, same type) -> rename, Medium confidence', () => {
  const snap = edit(faithful(), (s) => { row(s, 'CCA_CASE_NOTE', 'NOTE_TEXT').name = 'BODY_TEXT'; });
  const o = only(pull(snap));
  assert.deepEqual([o.cls, o.op, o.target, o.confidence], ['breaking', 'rename', 'E-13.noteText', 'Medium']);
  assert.match(o.change, /NOTE_TEXT → BODY_TEXT \(field bodyText\)/);
});

test('type text changed -> modify-field (modifying); NOT NULL toggled -> modify-field (Req); key changed -> modify-field (breaking)', () => {
  let o = only(pull(edit(faithful(), (s) => { row(s, 'CCA_HOUSEHOLD_MEMBER', 'FULL_NAME').type = 'Text(200) NOT NULL'; })));
  assert.deepEqual([o.cls, o.op, o.target, o.change, o.supersedes], ['modifying', 'modify-field', 'E-2.fullName', 'Type Text(100) → Text(200)', '[S3 @00:02:10]']);
  o = only(pull(edit(faithful(), (s) => { const f = row(s, 'CCA_HOUSEHOLD_MEMBER', 'SSN'); f.type = 'Text(11) NOT NULL'; f.nullable = false; })));
  assert.deepEqual([o.cls, o.target, o.change], ['modifying', 'E-2.ssn', 'Req N → Y']);
  o = only(pull(edit(faithful(), (s) => { row(s, 'CCA_CASE', 'CASE_NUMBER').key = ''; })));
  assert.deepEqual([o.cls, o.target, o.change], ['breaking', 'E-7.caseNumber', 'Key UK → —']);
});

test('table renamed -> rename (breaking); deleted -> deprecate and only that (its lines go with it)', () => {
  let o = only(pull(edit(faithful(), (s) => { shape(s, 'CCA_COUNTY').name = 'CCA_COUNTIES'; })));
  assert.deepEqual([o.cls, o.op, o.target, o.change], ['breaking', 'rename', 'E-14', 'Table CCA_COUNTY → CCA_COUNTIES']);
  const snap = edit(faithful(), (s) => {
    s.entities = s.entities.filter((e) => e.name !== 'CCA_CASE_NOTE');
    s.relationships = s.relationships.filter((r) => r.erdId !== 'R-11');
  });
  o = only(pull(snap));
  assert.deepEqual([o.cls, o.op, o.target], ['breaking', 'deprecate', 'E-13']);
});

test('shape data Kind / Sensitivity / Purpose -> modify-field on E-n.<attr>; Group -> rename E-n.group (breaking)', () => {
  const r = pull(edit(faithful(), (s) => {
    const e = shape(s, 'CCA_PROVIDER');
    e.shapeData.Kind = 'Reference'; e.shapeData.Sensitivity = 'None'; e.shapeData.Purpose = 'A provider of care';
    shape(s, 'CCA_CHILD').shapeData.Group = 'Somewhere else';
  }));
  const by = Object.fromEntries(r.ops.map((o) => [o.target, o]));
  assert.deepEqual(Object.keys(by).sort(), ['E-8.group', 'E-9.kind', 'E-9.purpose', 'E-9.sensitivity']);
  assert.deepEqual([by['E-9.kind'].cls, by['E-9.kind'].op, by['E-9.kind'].change], ['modifying', 'modify-field', 'Kind Core → Reference']);
  assert.deepEqual([by['E-8.group'].cls, by['E-8.group'].op], ['breaking', 'rename']);
});

test('a data field somebody deleted in Lucid is not a change', () => {
  const snap = edit(faithful(), (s) => { delete shape(s, 'CCA_CHILD').shapeData.Purpose; });
  assert.equal(pull(snap).ops.length, 0);
});

test('line deleted -> deprecate R-n (breaking); cardinality changed -> modify-relationship (breaking)', () => {
  let o = only(pull(edit(faithful(), (s) => { s.relationships = s.relationships.filter((r) => r.erdId !== 'R-8'); })));
  assert.deepEqual([o.cls, o.op, o.target, o.supersedes], ['breaking', 'deprecate', 'R-8', '[S3 @00:05:12]']);
  o = only(pull(edit(faithful(), (s) => { lineFor(s, 'R-6').foreign.cardinality = 'zeroOrMany'; })));
  assert.deepEqual([o.cls, o.op, o.target, o.change], ['breaking', 'modify-relationship', 'R-6', 'Cardinality one-to-one → many-to-one']);
});

test('a parent end that only flips optionality is a Req change on the FK, not a cardinality change', () => {
  const o = only(pull(edit(faithful(), (s) => { lineFor(s, 'R-1').primary.cardinality = 'zeroOrOne'; })));
  assert.deepEqual([o.op, o.target, o.change.split(' (')[0]], ['modify-field', 'E-3.householdId', 'Req Y → N']);
});

test('a new line between existing tables -> add-relationship R-new-k', () => {
  const snap = edit(faithful(), (s) => {
    s.relationships.push({ lineId: 'LN-new', primary: { entityId: 'L-E-9', fieldIndex: 1, fieldName: 'ID', cardinality: 'exactlyOne' }, foreign: { entityId: 'L-E-13', fieldIndex: 4, fieldName: 'AUTHOR_ID', cardinality: 'zeroOrMany' } });
  });
  const o = only(pull(snap));
  assert.deepEqual([o.cls, o.op, o.target], ['additive', 'add-relationship', 'R-new-1']);
  assert.match(o.change, /E-13 → E-9 via AUTHOR_ID \(many-to-one\)/);
});

const newTable = (group = 'Provider', { pk = true } = {}) => (s) => {
  s.entities.push({
    lucidId: 'L-N1', name: 'CCA_PROVIDER_CAPACITY', boundingBox: { x: 0, y: 0, w: 1, h: 1 }, shapeData: { Kind: 'Core', Group: group, Purpose: 'Licensed slots per provider' },
    fields: [
      ...(pk ? [{ index: 1, name: 'ID', key: 'PK', type: 'Integer NOT NULL', nullable: false }] : []),
      { index: 2, name: 'PROVIDER_ID', key: 'FK', type: 'Integer NOT NULL', nullable: false }, { index: 3, name: 'LICENSED_SLOTS', key: '', type: 'Integer', nullable: true },
    ],
  });
  s.relationships.push({ lineId: 'LN-n1', primary: { entityId: 'L-E-9', fieldIndex: 1, fieldName: 'ID', cardinality: 'exactlyOne' }, foreign: { entityId: 'L-N1', fieldIndex: 2, fieldName: 'PROVIDER_ID', cardinality: 'zeroOrMany' } });
};

test('a new table with a PK and a Group -> add-entity (+ its line), with a field detail block', () => {
  const r = pull(edit(faithful(), newTable()));
  assert.deepEqual(r.ops.map((o) => [o.op, o.target]), [['add-entity', 'E-new-1 CCA Provider Capacity (`CCA_PROVIDER_CAPACITY`)'], ['add-relationship', 'R-new-1']]);
  assert.match(r.ops[0].change, /^Group: Provider\. Kind: Core\. Licensed slots per provider\. Fields: id|^Group: Provider\. Kind: Core\. Licensed slots per provider\. Fields: providerId/);
  assert.equal(r.details.length, 1);
  assert.deepEqual(r.details[0].rows.map((x) => [x.column, x.req, x.key]), [['ID', 'Y', 'PK'], ['PROVIDER_ID', 'Y', 'FK→E-9'], ['LICENSED_SLOTS', 'N', '']]);
  assert.match(r.ops[1].change, /E-new-1 → E-9 via PROVIDER_ID/);
});

test('a new table with no Group -> add-entity plus a raise-question', () => {
  const r = pull(edit(faithful(), newTable('')));
  assert.deepEqual(r.ops.map((o) => o.op).sort(), ['add-entity', 'add-relationship', 'raise-question']);
  assert.ok(r.ops.some((o) => o.op === 'raise-question' && /Which Group/.test(o.change)));
  assert.match(r.ops.find((o) => o.op === 'add-entity').change, /Group: \(not set/);
});

test('a table without a PK, and a line attached to a header, are not proposed', () => {
  const r = pull(edit(faithful(), newTable('Provider', { pk: false })));
  assert.equal(r.ops.length, 0);
  assert.ok(r.notProposed.some((s) => /CCA_PROVIDER_CAPACITY.*no PK row/.test(s)));
  const h = pull(edit(faithful(), (s) => { s.relationships.push({ lineId: 'LN-h', primary: { entityId: 'L-E-9', fieldIndex: 0, cardinality: 'one' }, foreign: { entityId: 'L-E-13', fieldIndex: 0, cardinality: 'many' } }); }));
  assert.equal(h.ops.length, 0);
  assert.ok(h.notProposed.some((s) => /attached to a table header/.test(s)));
});

test('an unstamped table named like a baseline entity is that entity until a push stamps it; one already in ERD.md is not proposed again', () => {
  const snap = edit(faithful(), (s) => { shape(s, 'CCA_COUNTY').shapeData = {}; });
  assert.equal(pull(snap).ops.length, 0, 'the lost stamp is not a deleted table');
  // ERD.md already has the table (a pull accepted it) but the baseline of this run predates it
  const md = baselineMd.replace('## Relationships', `### E-15 CCA Waitlist (\`CCA_WAITLIST\`)
- **Purpose:** Households waiting for a slot
- **Kind:** Core
- **Group:** Household
- **Est. volume:** unknown
- **Sensitivity:** PII
- **Sources:** CONVENTION

| Field | Column | Type | Req | Key | Description | Sources |
|---|---|---|---|---|---|---|
| id | ID | Integer | Y | PK | Surrogate key | CONVENTION |

## Relationships`);
  const drawn = edit(faithful(), (s) => { s.entities.push({ lucidId: 'L-W', name: 'CCA_WAITLIST', boundingBox: { x: 0, y: 0, w: 1, h: 1 }, shapeData: {}, fields: [{ index: 1, name: 'ID', key: 'PK', type: 'Integer NOT NULL', nullable: false }] }); });
  const r = pull(drawn, { md, base: baselineMd });
  assert.equal(r.ops.length, 0, JSON.stringify(r.ops));
  assert.ok(r.notProposed.some((s) => /CCA_WAITLIST.*already E-15/.test(s)));
});

test('duplicate ERD_ID (copy/paste): the shape that matches the baseline wins, the copy is a new table, with a warning', () => {
  const snap = edit(faithful(), (s) => {
    const copy = JSON.parse(JSON.stringify(shape(s, 'CCA_COUNTY')));
    copy.lucidId = 'L-copy'; copy.name = 'CCA_COUNTY_COPY'; copy.boundingBox.y += 5000;
    s.entities.push(copy);
  });
  const r = pull(snap);
  assert.ok(r.warnings.some((w) => /Duplicate ERD_ID E-14/.test(w)));
  assert.match(renderChangeset(r, { run: '2026-10-20', baseVersion: 1 }), /^- Warning: Duplicate ERD_ID E-14/m, 'warnings are visible at Gate C, not only on stderr');
  assert.deepEqual(r.ops.map((o) => o.op), ['add-entity']);
  assert.match(r.ops[0].target, /CCA_COUNTY_COPY/);
});

test('a table that ERD.md deprecated and somebody restored -> raise-question, never an un-deprecate', () => {
  const md = baselineMd.replace('### E-13 CCA Case Note (`CCA_CASE_NOTE`)\n', '### E-13 CCA Case Note (`CCA_CASE_NOTE`)\n- **Status:** Deprecated in v2: replaced\n');
  const base = baselineMd; // the baseline still had it; Lucid still has it
  const r = pull(faithful(), { md, base });
  const q = r.ops.filter((o) => o.op === 'raise-question');
  assert.equal(r.ops.filter((o) => o.op !== 'raise-question').length, 0);
  assert.equal(q.length, 0, 'unchanged since the baseline: nothing to restore');
  const state = stateFor(md); // the push removed it, so the baseline lacks it; the snapshot has it back (undo)
  const back = buildPull(normalizeErd(md), state, snapshotFor(baselineMd), { source: S });
  assert.deepEqual(back.ops.map((o) => o.op), ['raise-question']);
  assert.match(back.ops[0].change, /E-13 .*deprecated in ERD\.md/);
});

test('conflict: the same field changed in ERD.md and in Lucid -> class conflict plus a paired raise-question', () => {
  const md = mdEdit(baselineMd, '| fullName | FULL_NAME |', (l) => l.replace('Text(100)', 'Text(150)'));
  const snap = edit(faithful(), (s) => { row(s, 'CCA_HOUSEHOLD_MEMBER', 'FULL_NAME').type = 'Text(200) NOT NULL'; });
  const r = pull(snap, { md });
  assert.deepEqual(r.ops.map((o) => [o.id, o.cls, o.op]), [['CS-1', 'conflict', 'modify-field'], ['CS-2', 'additive', 'raise-question']]);
  assert.match(r.ops[0].change, /Pairs with CS-2/);
  assert.match(r.ops[1].change, /Pairs with CS-1/);
  assert.match(r.ops[1].evidence, /\[S9 §CCA_HOUSEHOLD_MEMBER\.FULL_NAME\]/);
  assert.match(r.ops[1].evidence, /\[S3 @00:02:10\]/);
  // both sides changing it to the same thing is agreement, not a conflict
  const same = pull(edit(faithful(), (s) => { row(s, 'CCA_HOUSEHOLD_MEMBER', 'FULL_NAME').type = 'Text(150) NOT NULL'; }), { md });
  assert.equal(same.ops.length, 0);
});

test('conflict: an element in an Active decision\'s Affects is a conflict, and Supersedes names the DEC', () => {
  const snap = edit(snapshotFor(decsMd), (s) => { row(s, 'CCA_AUTHORIZATION', 'AUTHORIZED_HOURS_PER_WEEK').type = 'Decimal(5,2) NOT NULL'; });
  const r = pull(snap, { md: decsMd, base: decsMd, decisions: decisionsMd });
  assert.deepEqual(r.ops.map((o) => [o.cls, o.op]), [['conflict', 'modify-field'], ['additive', 'raise-question']]);
  assert.match(r.ops[0].supersedes, /\[DEC-1\]/);
  assert.match(r.ops[1].change, /reverses DEC-1/);
  // a superseded decision binds nobody: DEC-2 (E-2.householdId) is Superseded, DEC-4 (E-2, R-2) is Active
  const free = pull(edit(snapshotFor(decsMd), (s) => { row(s, 'CCA_CASE_NOTE', 'NOTE_TEXT').type = 'Text(900) NOT NULL'; }), { md: decsMd, base: decsMd, decisions: decisionsMd });
  assert.deepEqual(free.ops.map((o) => o.cls), ['modifying']);
  const e2 = pull(edit(snapshotFor(decsMd), (s) => { row(s, 'CCA_HOUSEHOLD_MEMBER', 'FULL_NAME').type = 'Text(300) NOT NULL'; }), { md: decsMd, base: decsMd, decisions: decisionsMd });
  assert.equal(e2.ops[0].cls, 'conflict', 'DEC-4 affects E-2 as a whole');
});

test('CLI pull-diff: writes the change set, numbers a second same-day file, and writes nothing when nothing changed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lucid-'));
  mkdirSync(join(dir, 'erd'));
  const erd = join(dir, 'erd', 'ERD.md');
  writeFileSync(erd, baselineMd);
  writeFileSync(join(dir, 'lucid.json'), JSON.stringify(stateFor(baselineMd)));
  const snapPath = join(dir, 'snap.json');
  writeFileSync(snapPath, JSON.stringify(faithful()));
  const args = ['pull-diff', erd, '--state', join(dir, 'lucid.json'), '--snapshot', snapPath, '--source', 'S4', '--run', '2026-10-20'];
  let r = spawnSync('node', [cli, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Lucid doc matches ERD v1\./);
  assert.ok(!existsSync(join(dir, 'erd', 'changes')), 'no file when nothing changed');
  writeFileSync(snapPath, JSON.stringify(edit(faithful(), (s) => { row(s, 'CCA_CASE', 'CASE_NUMBER').key = ''; })));
  r = spawnSync('node', [cli, ...args, '--dry-run'], { encoding: 'utf8' });
  assert.match(r.stdout, /1 proposed change\(s\): 0 additive · 0 modifying · 1 breaking · 0 conflict/);
  assert.ok(!existsSync(join(dir, 'erd', 'changes')), '--dry-run writes nothing');
  r = spawnSync('node', [cli, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(dir, 'erd', 'changes', '2026-10-20-lucid-changeset.md')));
  r = spawnSync('node', [cli, ...args], { encoding: 'utf8' });
  assert.ok(existsSync(join(dir, 'erd', 'changes', '2026-10-20-2-lucid-changeset.md')));
});

test('CLI record --pull: baseline becomes ERD.md, seen becomes the snapshot, so the next push may proceed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lucid-'));
  const erd = join(dir, 'ERD.md');
  writeFileSync(erd, baselineMd);
  const st = join(dir, 'lucid.json');
  writeFileSync(st, JSON.stringify(stateFor(baselineMd)));
  const snap = edit(faithful(), (s) => { row(s, 'CCA_CASE', 'CASE_NUMBER').key = ''; });
  writeFileSync(join(dir, 'snap.json'), JSON.stringify(snap));
  const r = spawnSync('node', [cli, 'record', '--pull', erd, '--snapshot', join(dir, 'snap.json'), '--state', st, '--source', 'S4'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const state = JSON.parse(readFileSync(st, 'utf8'));
  assert.deepEqual(state.lastPull, { at: snap.takenAt, sourceId: 'S4' });
  assert.deepEqual(state.seen.entities.find((e) => e.id === 'E-7').fields.find((f) => f.column === 'CASE_NUMBER').key, []);
  assert.deepEqual(state.baseline.entities.find((e) => e.id === 'E-7').fields.find((f) => f.column === 'CASE_NUMBER').key, ['UK']);
});

test('the §9 scenario: five edits in Lucid -> exactly five proposed changes, matching the fixture change set', () => {
  const snap = edit(faithful(), (s) => {
    const m = shape(s, 'CCA_HOUSEHOLD_MEMBER'); m.fields.splice(6, 0, { index: 7, name: 'PREFERRED_NAME', key: '', type: 'Text(60)', nullable: true }); reindex(m);   // add a field
    row(s, 'CCA_PROVIDER', 'LICENSE_NUMBER').type = 'Text(30) NOT NULL';                                                                                                  // change a type
    s.relationships = s.relationships.filter((r) => r.erdId !== 'R-17');                                                                                                   // delete a line
    newTable('Provider')(s);                                                                                                                                              // add a table with Group set
    shape(s, 'CCA_PROVIDER_LICENSE_TYPE').shapeData.Kind = 'Core';                                                                                                        // change a Kind
  });
  const r = pull(snap);
  assert.equal(r.ops.length, 6, 'five edits; the new table brings its line as a sixth row');
  assert.deepEqual(r.ops.map((o) => o.op), ['modify-field', 'add-field', 'modify-field', 'add-entity', 'deprecate', 'add-relationship']);
  const fixture = read('examples/fixtures/lucid/expected-changeset.md');
  assert.equal(renderChangeset(r, { run: '2026-10-20', baseVersion: 1 }), fixture);
});
