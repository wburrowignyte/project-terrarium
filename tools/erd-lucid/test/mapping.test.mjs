import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeErd, fieldToRow, rowToField, relEnds, endsToRel, camel, keyFlags } from '../lib/model.mjs';
import { baselineMd, groupedMd } from './helpers.mjs';

const strip = ({ field, ...rest }) => rest;
const rowAsLucid = (f) => { const r = fieldToRow(f); return { name: r.name, key: r.key, type: r.type, nullable: !f.req }; };

test('field round-trip is lossless for every field of the baseline and the grouped fixture', () => {
  for (const md of [baselineMd, groupedMd]) {
    const n = normalizeErd(md);
    let count = 0;
    for (const e of n.entities) for (const f of e.fields) {
      assert.deepEqual(rowToField(rowAsLucid(f)), strip(f), `${e.table}.${f.column}`);
      count++;
    }
    assert.ok(count > 50);
  }
});

test('PK, FK, AK, composite keys, LOOKUP FKs, Req and parenthesised types map as specified (§4c)', () => {
  const cases = [
    [{ column: 'ID', type: 'Integer', req: true, key: ['PK'] }, { name: 'ID', key: 'PK', type: 'Integer NOT NULL' }],
    [{ column: 'HOUSEHOLD_ID', type: 'Integer', req: true, key: ['FK'] }, { name: 'HOUSEHOLD_ID', key: 'FK', type: 'Integer NOT NULL' }],
    [{ column: 'CASE_NUMBER', type: 'Text(20)', req: true, key: ['UK'] }, { name: 'CASE_NUMBER', key: 'AK', type: 'Text(20) NOT NULL' }],
    [{ column: 'PARENT_ID', type: 'Integer', req: true, key: ['PK', 'FK'] }, { name: 'PARENT_ID', key: 'PK,FK', type: 'Integer NOT NULL' }],
    [{ column: 'CASE_TYPE_ID', type: 'Integer', req: false, key: ['FK'], lookupType: 'CASE_TYPE' }, { name: 'CASE_TYPE_ID', key: 'FK LK:CASE_TYPE', type: 'Integer' }],
    [{ column: 'AMOUNT', type: 'Decimal(5,2)', req: false, key: [] }, { name: 'AMOUNT', key: '', type: 'Decimal(5,2)' }],
    [{ column: 'NOTE', type: 'Extra Long Text', req: true, key: [] }, { name: 'NOTE', key: '', type: 'Extra Long Text NOT NULL' }],
  ];
  for (const [f, row] of cases) {
    assert.deepEqual(fieldToRow(f), row);
    assert.deepEqual(rowToField(rowAsLucid(f)), f);
  }
});

test('a lookup type that contains PK, FK or AK does not leak into the key flags', () => {
  const f = { column: 'X_ID', type: 'Integer', req: false, key: ['FK'], lookupType: 'PKG_AKA' };
  assert.deepEqual(rowToField(rowAsLucid(f)), f);
});

test('rows a person types in Lucid read back sensibly (empty key/type, lowercase NOT NULL)', () => {
  assert.deepEqual(rowToField({ name: 'EXTRA', key: '', type: '', nullable: true }), { column: 'EXTRA', type: '', req: false, key: [] });
  assert.deepEqual(rowToField({ name: 'X', key: 'PK', type: 'int not null', nullable: false }), { column: 'X', type: 'int', req: true, key: ['PK'] });
});

test('relationship ends (§4d), both ways', () => {
  const table = [
    [{ cardinality: 'many-to-one', fkReq: true }, 'exactlyOne', 'zeroOrMany'],
    [{ cardinality: 'many-to-one', fkReq: false }, 'zeroOrOne', 'zeroOrMany'],
    [{ cardinality: 'one-to-one', fkReq: true }, 'exactlyOne', 'zeroOrOne'],
    [{ cardinality: 'one-to-one', fkReq: false }, 'zeroOrOne', 'zeroOrOne'],
  ];
  for (const [rel, primary, foreign] of table) {
    assert.deepEqual(relEnds(rel), { primary, foreign });
    assert.deepEqual(endsToRel(primary, foreign), rel);
  }
  for (const many of ['many', 'oneOrMany', 'zeroOrMany']) assert.equal(endsToRel('one', many).cardinality, 'many-to-one');
  for (const other of ['one', 'exactlyOne', 'zeroOrOne']) assert.equal(endsToRel('one', other).cardinality, 'one-to-one');
});

test('camelCase naming follows the ERD naming rules', () => {
  assert.equal(camel('CASE_TYPE_ID'), 'caseTypeId');
  assert.equal(camel('ID'), 'id');
  assert.equal(camel('IS_APPLICANT'), 'isApplicant');
  assert.equal(camel('AUTHORIZED_HOURS_PER_WEEK'), 'authorizedHoursPerWeek');
  assert.deepEqual(keyFlags('FK→LOOKUP:CASE_TYPE'), ['FK']);
  assert.deepEqual(keyFlags('PK, FK→E-1'), ['PK', 'FK']);
});

test('normalizeErd drops deprecated elements, LOOKUP lines and lines it cannot pin', () => {
  const n = normalizeErd(groupedMd);
  assert.ok(n.entities.some((e) => e.kind === 'Lookup'));
  const lookupId = n.entities.find((e) => e.kind === 'Lookup').id;
  assert.ok(!n.relationships.some((r) => r.to === lookupId), 'no line may target the lookup table');
  const base = normalizeErd(baselineMd);
  assert.equal(base.entities.length, 14);
  assert.equal(base.relationships.length, 18);
  assert.equal(base.entities.find((e) => e.id === 'E-2').fields.find((f) => f.column === 'SSN').req, false);
});
