import { test } from 'node:test';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { run, load, check, parseDecisions } from '../erd-slice.mjs';

const root = (p) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const cli = root('tools/erd-assist/erd-slice.mjs');
const baselinePath = root('examples/fixtures/baseline/ERD.md');
const baseline = readFileSync(baselinePath, 'utf8');
const exec = (...args) => spawnSync('node', [cli, ...args], { encoding: 'utf8' });

const decisions = `# Technical decisions

| | |
|---|---|
| Last ID | DEC-2 |
| Active | 1 |
| Last updated | 2026-10-09 |

## Index
| ID | Date | Status | Affects | Rule |
|---|---|---|---|---|
| DEC-2 | 2026-10-09 | Active | E-11.authorizedHoursPerWeek | Store authorized hours as Decimal(5,2) |
| DEC-1 | 2026-10-02 | Superseded by DEC-2 | E-11.authorizedHoursPerWeek | Store authorized hours as Integer |
`;

test('--outline: header, sections, entity lines, counts', () => {
  const { stdout } = run(baseline, { outline: true });
  assert.match(stdout, /\| Version \| 1 \|/);
  assert.match(stdout, /^## Entities \[lines 148–373\]$/m);
  assert.match(stdout, /^E-11 CCA Authorization \(CCA_AUTHORIZATION\) · Core · — · PII · \[lines 310–327\]$/m);
  assert.match(stdout, /Relationships 18 · Assumptions 3 · Questions 1 \(1 open\)/);
  assert.match(stdout, /^## Change log \(last 1\)$/m); // --outline implies --log 3
});

test('--log N returns the last N rows', () => {
  const md = baseline.trimEnd() + '\n| 2 | 2026-10-01 | assist DEC-1 | x |\n| 3 | 2026-10-02 | assist DEC-2 | y |\n';
  const { stdout } = run(md, { log: 2 });
  assert.match(stdout, /last 2/);
  assert.ok(!stdout.includes('full build'));
  assert.ok(stdout.includes('assist DEC-2'));
});

test('--ids: entity section, relationships touching it, mermaid, neighbours', () => {
  const { stdout } = run(baseline, { ids: ['E-11'], neighbors: true });
  assert.match(stdout, /^### E-11 CCA Authorization/m);
  assert.ok(!stdout.includes('### E-8 '));
  for (const r of ['R-8', 'R-9', 'R-10']) assert.match(stdout, new RegExp(`^\\| ${r} \\|`, 'm'));
  assert.ok(!/^\| R-1 \|/m.test(stdout));
  assert.match(stdout, /CCA_AUTHORIZATION \{/);
  assert.match(stdout, /^## Neighbors/m);
  for (const e of ['E-8 ', 'E-9 ', 'E-12 ']) assert.ok(stdout.includes(`\nE-${e.slice(2)}`));
});

test('--ids: R/A/Q rows carry their table header; E-n.field prints one field row', () => {
  const { stdout } = run(baseline, { ids: ['R-8', 'A-2', 'Q-1', 'E-11.authorizedHoursPerWeek'] });
  assert.match(stdout, /^\| ID \| From/m);
  assert.match(stdout, /^\| A-2 \|/m);
  assert.match(stdout, /^\| Q-1 \|/m);
  assert.match(stdout, /^\| authorizedHoursPerWeek \| AUTHORIZED_HOURS_PER_WEEK \| Integer/m);
  assert.ok(!/^\| childId \|/m.test(stdout));
  assert.match(run(baseline, { ids: ['E-99'] }).stdout, /not found: E-99/);
});

test('--find matches names, tables, fields and columns, case-insensitively', () => {
  const { stdout } = run(baseline, { find: 'AUTHORIZED_hours' });
  assert.match(stdout, /^E-11\.authorizedHoursPerWeek /m);
  assert.match(stdout, /^E-12\.authorizedHoursPerWeek /m);
  assert.match(run(baseline, { find: 'provider' }).stdout, /^E-9 CCA Provider /m);
  assert.match(run(baseline, { find: 'zzz' }).stdout, /no match/);
});

test('--next-ids counts deprecated IDs', () => {
  assert.equal(run(baseline, { nextIds: true }).stdout, 'E-15 R-19 A-4 Q-2');
  const dep = baseline.replace('| Q-1 | Is co-payment', '| Q-5 | Is co-payment')
    .replace('| A-3 | Audit', '| A-3 | DEPRECATED v2: Audit')
    .replace('### E-14 CCA County (`CCA_COUNTY`)\n', '### E-14 CCA County (`CCA_COUNTY`)\n- **Status:** Deprecated in v2: merged [S4 @00:01:00]\n');
  assert.equal(run(dep, { nextIds: true }).stdout, 'E-15 R-19 A-4 Q-6');
});

test('--check: clean baseline is ok', () => {
  const r = run(baseline, { check: true });
  assert.equal(r.errors, 0);
  assert.equal(r.stdout, 'ok');
});

test('--check catches a dangling FK', () => {
  const md = baseline.replace('| FK→E-8 | Child receiving care', '| FK→E-99 | Child receiving care');
  const r = run(md, { check: true });
  assert.equal(r.errors > 0, true);
  assert.ok(r.stderr.some((l) => l.startsWith('error:') && l.includes('E-99')));
});

test('--check catches a Relationships FK field missing from the child entity', () => {
  const md = baseline.replace('| many-to-one | childId |', '| many-to-one | kidId |');
  const r = run(md, { check: true });
  assert.ok(r.stderr.some((l) => l.includes('R-8') && l.includes('kidId')));
});

test('--check catches Mermaid/table mismatches in both directions', () => {
  const [diagram, rest] = baseline.split('## Entities');
  const noMermaidBlock = diagram.replace(/ {4}CCA_COUNTY \{[\s\S]*?\n {4}\}\n/, '').split('\n').filter((l) => !l.includes('CCA_COUNTY')).join('\n') + '## Entities' + rest;
  assert.ok(run(noMermaidBlock, { check: true }).stderr.some((l) => l.includes('CCA_COUNTY') && l.includes('missing from the Mermaid')));
  const extra = baseline.replace('    CCA_COUNTY {', '    CCA_GHOST {\n        int ID PK\n    }\n    CCA_COUNTY {');
  assert.ok(run(extra, { check: true }).stderr.some((l) => l.includes('CCA_GHOST') && l.includes('no entity table')));
});

test('--check catches an unknown [DEC-9] and warns on a non-Active citation', () => {
  const md = baseline.replace('| Integer | Y |  | Authorized hours per week | [S3 @00:06:30] |', '| Integer | Y |  | Authorized hours per week | [S3 @00:06:30] [DEC-9] |');
  const r = run(md, { check: true }, decisions);
  assert.ok(r.errors > 0);
  assert.ok(r.stderr.some((l) => l.startsWith('error:') && l.includes('DEC-9')));
  const old = md.replace('[DEC-9]', '[DEC-1]');
  const r2 = run(old, { check: true }, decisions);
  assert.equal(r2.errors, 0);
  assert.ok(r2.stderr.some((l) => l.startsWith('warning:') && l.includes('DEC-1')));
  assert.equal(run(md.replace('[DEC-9]', '[DEC-2]'), { check: true }, decisions).stdout, 'ok');
  // no decisions given at all: citations are not checked
  assert.equal(run(md, { check: true }).errors, 0);
});

test('--check catches a duplicate ID', () => {
  const md = baseline.replace('| R-2 | E-2', '| R-1 | E-2');
  assert.ok(run(md, { check: true }).stderr.some((l) => l.includes('R-1') && l.includes('duplicate')));
});

test('--check with ids reports only nearby issues', () => {
  const md = baseline.replace('| FK→E-8 | Child receiving care', '| FK→E-99 | Child receiving care');
  assert.ok(run(md, { check: true, checkIds: ['E-11'] }).errors > 0);
  assert.equal(run(md, { check: true, checkIds: ['E-14'] }).errors, 0); // E-14 County is not within one hop of E-11
});

test('--check <ids> keeps DECISIONS.md log-level issues (hand-edited header, duplicate row)', () => {
  const badActive = decisions.replace('| Active | 1 |', '| Active | 99 |');
  const scoped = run(baseline, { check: true, checkIds: ['E-11'] }, badActive);
  assert.ok(scoped.stderr.some((l) => l.startsWith('warning:') && l.includes('header says Active 99')));
  assert.notEqual(scoped.stdout, 'ok');
  const dup = decisions + '| DEC-1 | 2026-10-02 | Active | E-3 | again |\n';
  const r = run(baseline, { check: true, checkIds: ['E-14'] }, dup);
  assert.ok(r.errors > 0 && r.stderr.some((l) => l.includes('DEC-1') && l.includes('duplicate')));
  // unrelated scoped issues are still filtered out
  const fk = baseline.replace('| FK→E-8 | Child receiving care', '| FK→E-99 | Child receiving care');
  assert.equal(run(fk, { check: true, checkIds: ['E-14'] }, decisions).errors, 0);
});

test('--check catches a stale Last ID (error) and a too-high one (warning)', () => {
  const stale = decisions.replace('| Last ID | DEC-2 |', '| Last ID | DEC-1 |');
  const r = run(baseline, { check: true }, stale);
  assert.ok(r.errors > 0 && r.stderr.some((l) => l.startsWith('error:') && l.includes('Last ID DEC-1')));
  assert.ok(run(baseline, { check: true, checkIds: ['E-11'] }, stale).errors > 0);
  const high = decisions.replace('| Last ID | DEC-2 |', '| Last ID | DEC-5 |');
  const w = run(baseline, { check: true }, high);
  assert.equal(w.errors, 0);
  assert.ok(w.stderr.some((l) => l.startsWith('warning:') && l.includes('Last ID DEC-5')));
});

test('--ids on an ### E-n heading that parseErd did not parse reports not found instead of throwing', () => {
  const md = baseline.replace('### E-14 CCA County (`CCA_COUNTY`)', '### E-14 CCA County');
  const { stdout } = run(md, { ids: ['E-14', 'E-14.name'], neighbors: true });
  assert.match(stdout, /not found: E-14, E-14\.name/);
});

test('parseDecisions reads the Index and header', () => {
  const d = parseDecisions(decisions);
  assert.equal(d.last, 2);
  assert.equal(d.active, 1);
  assert.equal(d.index.get(1).status, 'Superseded by DEC-2');
});

test('budget: --outline < 15% and --ids E-11 --neighbors < 25% of the ERD', () => {
  const size = Buffer.byteLength(baseline);
  assert.ok(Buffer.byteLength(run(baseline, { outline: true }).stdout) < size * 0.15);
  assert.ok(Buffer.byteLength(run(baseline, { ids: ['E-11'], neighbors: true }).stdout) < size * 0.25);
});

test('CLI: flags combine; exit codes', () => {
  const r = exec(baselinePath, '--outline', '--next-ids', '--check');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /E-15 R-19 A-4 Q-2/);
  assert.match(r.stdout, /ok$/m);
  assert.equal(exec(baselinePath).status, 2);
  assert.equal(exec(baselinePath, '--bogus').status, 2);
  assert.equal(exec('/no/such/file.md', '--outline').status, 2);
  assert.equal(exec(baselinePath, '--neighbors').status, 2);
});

test('CLI: --check exits 1 on errors', () => {
  const dir = mkdtempSync(join(tmpdir(), 'erd-slice-'));
  writeFileSync(join(dir, 'ERD.md'), baseline.replace('FK→E-8', 'FK→E-99'));
  const r = exec(join(dir, 'ERD.md'), '--check');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /error:/);
});
