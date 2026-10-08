import { test } from 'node:test';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseErd, parseMermaid } from '../lib/parse.mjs';
import { render } from '../erd-view.mjs';
import { genLarge } from './gen-large.mjs';

const fixture = readFileSync(fileURLToPath(new URL('../../../examples/fixtures/flawed-ERD.md', import.meta.url)), 'utf8');

test('fixture: entities, fields, relationships, meta', () => {
  const m = parseErd(fixture);
  assert.equal(m.entities.length, 9);
  assert.equal(m.relationships.length, 7);
  assert.equal(m.meta['Target database'], 'Oracle');
  const app = m.entities.find((e) => e.table === 'CCA_APPLICATION');
  assert.equal(app.kind, 'Core');
  assert.equal(app.volume, '40,000/yr');
  assert.equal(app.fields.length, 4);
  assert.equal(app.fields[1].key, 'FK→E-1');
  assert.equal(m.questions.length, 1);
  assert.equal(m.assumptions.length, 0);
});

test('fixture: relationships resolve by E-id even when the name differs from the heading', () => {
  const m = parseErd(fixture);
  const r3 = m.relationships.find((r) => r.id === 'R-3'); // "E-4 Income Verification"
  assert.equal(r3.from, 'E-4');
  assert.equal(r3.to, 'E-3');
  assert.equal(r3.label, 'reports'); // label merged from mermaid
});

test('fixture: many-to-many is kept and warned about', () => {
  const m = parseErd(fixture);
  assert.equal(m.relationships.find((r) => r.id === 'R-7').cardinality, 'many-to-many');
  assert.ok(m.warnings.some((w) => w.includes('R-7')));
});

test('mermaid-only input still produces a model', () => {
  const md = '# T\n\n```mermaid\nerDiagram\n  A ||--o{ B : "has"\n  A {\n    int ID PK\n  }\n  B {\n    int ID PK\n    int A_ID FK\n  }\n```\n';
  const m = parseErd(md);
  assert.equal(m.entities.length, 2);
  assert.equal(m.relationships.length, 1);
  const r = m.relationships[0];
  assert.equal(m.entities.find((e) => e.id === r.from).table, 'B'); // many side is the child
  assert.equal(m.entities.find((e) => e.table === 'B').fields[1].key, 'FK');
});

test('mermaid cardinality: many on the left flips the child', () => {
  const p = parseMermaid('```mermaid\nerDiagram\n  C }o--|| P : x\n```\n');
  assert.equal(p.relationships[0].left, '}o');
  assert.equal(p.relationships[0].right, '||');
});

test('dangling FK target is reported', () => {
  const md = fixture.replace('FK→E-1 |', 'FK→E-99 |');
  assert.ok(parseErd(md).warnings.some((w) => w.includes('E-99')));
});

test('render: model is embedded and </script cannot break out', () => {
  const evil = fixture.replace('Household submits applications', '</script><script>alert(1)</script>');
  const { html } = render(evil);
  assert.ok(!html.includes('</script><script>alert(1)'));
  assert.ok(html.includes('const MODEL = {'));
});

test('large ERD parses quickly and completely', () => {
  const { md, entities, relationships } = genLarge(300);
  const t = Date.now();
  const m = parseErd(md);
  assert.equal(m.entities.length, entities);
  assert.equal(m.relationships.length, relationships);
  assert.ok(Date.now() - t < 2000);
});

test('deprecation and change log are parsed', () => {
  const md = fixture.replace('- **Sensitivity:** None\n- **Sources:** [S1 §Household]', '- **Sensitivity:** None\n- **Status:** Deprecated in v2: merged into X [S1 §Household]\n- **Sources:** [S1 §Household]') + '\n## Change log\n| Version | Date | Change set | Summary |\n|---|---|---|---|\n| 1 | 2026-09-20 | full build | Initial |\n';
  const m = parseErd(md);
  assert.match(m.entities.find((e) => e.id === 'E-1').deprecated, /^Deprecated in v2/);
  assert.equal(m.changeLog.length, 1);
  assert.equal(m.entities.find((e) => e.id === 'E-2').deprecated, '');
});

test('baseline fixture (maintained ERD) parses completely', () => {
  const m = parseErd(readFileSync(fileURLToPath(new URL('../../../examples/fixtures/baseline/ERD.md', import.meta.url)), 'utf8'));
  assert.equal(m.entities.length, 14);
  assert.equal(m.relationships.length, 18);
  assert.deepEqual(m.warnings, []);
});

const mini = (rels, mermaid) => `# T

## Diagram

\`\`\`mermaid
erDiagram
${mermaid}
\`\`\`

## Entities

### E-1 User (\`U\`)
- **Kind:** Core

| Field | Column | Type | Req | Key | Description | Sources |
|---|---|---|---|---|---|---|
| id | ID | Integer | Y | PK | k | CONVENTION |

| Index | Cols |
|---|---|
| ix | ID |

### E-2 Doc (\`D\`)
- **Kind:** Core

| Field | Column | Type | Req | Key | Description | Sources |
|---|---|---|---|---|---|---|
| id | ID | Integer | Y | PK | k | CONVENTION |
| submitterId | SUBMITTER_ID | Integer | Y | FK→E-1 | s | CONVENTION |
| reviewerId | REVIEWER_ID | Integer | N | FK→E-1 | r | CONVENTION |
| parentId | PARENT_ID | Integer | N | FK→E-2 | p | CONVENTION |

## Relationships

| ID | From | To | Cardinality | FK field | Description | Sources |
|---|---|---|---|---|---|---|
${rels}
`;

test('parallel relationships between one pair each keep their own label', () => {
  const m = parseErd(mini(
    '| R-1 | E-2 Doc | E-1 User | many-to-one | submitterId | | |\n| R-2 | E-2 Doc | E-1 User | many-to-one | reviewerId | | |',
    '  U ||--o{ D : "submitted by"\n  U ||--o{ D : "reviewed by"'));
  assert.deepEqual(m.relationships.map((r) => r.label), ['submitted by', 'reviewed by']);
  assert.deepEqual(m.warnings, []);
});

test('extra Mermaid edges for a pair are reported, not silently dropped', () => {
  const m = parseErd(mini('| R-1 | E-2 Doc | E-1 User | many-to-one | submitterId | | |', '  U ||--o{ D : "a"\n  U ||--o{ D : "b"'));
  assert.equal(m.relationships.length, 1);
  assert.ok(m.warnings.some((w) => w.includes('extra "b" edge ignored')));
});

test('self-referencing relationship parses', () => {
  const m = parseErd(mini('| R-1 | E-2 Doc | E-2 Doc | many-to-one | parentId | | |', '  D ||--o{ D : "parent of"'));
  assert.equal(m.relationships[0].from, 'E-2');
  assert.equal(m.relationships[0].to, 'E-2');
  assert.equal(m.relationships[0].label, 'parent of');
});

test('a second table in an entity section is not merged into its fields', () => {
  const m = parseErd(mini('', ''));
  assert.deepEqual(m.entities.find((e) => e.id === 'E-1').fields.map((f) => f.column), ['ID']);
});

test('Mermaid-only entities have the same shape as table entities', () => {
  const m = parseErd('# T\n\n```mermaid\nerDiagram\n  A {\n    int ID PK\n  }\n```\n');
  assert.equal(m.entities[0].deprecated, '');
});

test('generated HTML: inline scripts parse and a CSP is present', () => {
  const { html } = render(fixture);
  assert.match(html, /Content-Security-Policy[^>]*default-src 'none'/);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(scripts.length, 2);
  for (const src of scripts) assert.doesNotThrow(() => new Function(src));
});

const cli = fileURLToPath(new URL('../erd-view.mjs', import.meta.url));
const fixturePath = fileURLToPath(new URL('../../../examples/fixtures/flawed-ERD.md', import.meta.url));

test('CLI: -o writes to the given path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'erdview-'));
  const out = join(dir, 'x.html');
  const r = spawnSync(process.execPath, [cli, fixturePath, '-o', out], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.ok(existsSync(out));
});

test('CLI: -o without a value is an error', () => {
  const r = spawnSync(process.execPath, [cli, fixturePath, '-o'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /needs a path/);
});

test('CLI: --json prints the model on stdout and warnings on stderr', () => {
  const r = spawnSync(process.execPath, [cli, fixturePath, '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).entities.length, 9);
  assert.match(r.stderr, /warning: R-7/);
});
