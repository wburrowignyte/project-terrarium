import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseErd } from '../lib/parse.mjs';
import { layoutDiagram, kindOf } from '../lib/layout.mjs';
import { render } from '../erd-view.mjs';
import { genLarge } from './gen-large.mjs';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const grouped = read('../../../examples/fixtures/grouped-ERD.md');
const baseline = read('../../../examples/fixtures/baseline/ERD.md');
const flawed = read('../../../examples/fixtures/flawed-ERD.md');

// Nodes sized like the viewer would: width varies a little so columns are not all equal.
function build(md, mode = 'grouped') {
  const m = parseErd(md);
  const nodes = m.entities.map((e, i) => ({ id: e.id, kind: kindOf(e), group: e.group, w: 190 + (i % 4) * 25, h: 40 + 16 * Math.min(e.fields.length, 10) }));
  const edges = m.relationships.filter((r) => !r.lookup).map((r) => ({ id: r.id, from: r.from, to: r.to, cardinality: r.cardinality }));
  const out = layoutDiagram(nodes, edges, m.groups, { mode });
  return { m, nodes, edges, out, byId: new Map(nodes.map((n) => [n.id, n])) };
}

const segs = (pts) => pts.slice(1).map((p, i) => [pts[i], p]);
const inters = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);

function checkRoutes({ nodes, edges, out, byId }) {
  const ends = new Map(edges.map((e) => [e.id, [e.from, e.to]]));
  for (const p of out.paths) {
    // orthogonal
    for (const [a, b] of segs(p.pts)) assert.ok(a[0] === b[0] || a[1] === b[1], `${p.id}: diagonal segment ${a} -> ${b}`);
    // never through a table (1px tolerance; the two endpoint tables are skipped)
    for (const [a, b] of segs(p.pts)) for (const n of nodes) {
      if (ends.get(p.id).includes(n.id)) continue;
      const x0 = n.x + 1, x1 = n.x + n.w - 1, y0 = n.y + 1, y1 = n.y + n.h - 1;
      const hit = a[1] === b[1] ? a[1] > y0 && a[1] < y1 && inters(Math.min(a[0], b[0]), Math.max(a[0], b[0]), x0, x1) > 0
        : a[0] > x0 && a[0] < x1 && inters(Math.min(a[1], b[1]), Math.max(a[1], b[1]), y0, y1) > 0;
      assert.ok(!hit, `${p.id} crosses table ${n.id}`);
    }
  }
  // no two connectors share a collinear stretch (lines within 0.2px of each other count as the same line)
  for (const dir of ['h', 'v']) {
    const list = [];
    for (const p of out.paths) for (const [a, b] of segs(p.pts)) {
      if ((a[1] === b[1]) !== (dir === 'h')) continue;
      list.push({ c: dir === 'h' ? a[1] : a[0], lo: dir === 'h' ? Math.min(a[0], b[0]) : Math.min(a[1], b[1]), hi: dir === 'h' ? Math.max(a[0], b[0]) : Math.max(a[1], b[1]), id: p.id });
    }
    list.sort((x, y) => x.c - y.c);
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length && list[j].c - list[i].c < 0.2; j++) {
      if (list[i].id === list[j].id) continue;
      assert.ok(inters(list[i].lo, list[i].hi, list[j].lo, list[j].hi) <= 1, `${list[i].id} and ${list[j].id} overlap on ${dir}${list[i].c}`);
    }
  }
}

test('parser: groups, lookupType, rel.lookup', () => {
  const m = parseErd(grouped);
  assert.deepEqual(m.groups.map((g) => g.name), ['Household', 'Application & Eligibility', 'Provider', 'Authorization & Payment']);
  assert.equal(m.groupsDerived, false);
  assert.equal(m.entities.find((e) => e.id === 'E-1').group, 'Household');
  assert.equal(m.lookupId, 'E-17');
  assert.equal(m.entities.find((e) => e.id === 'E-17').isLookup, true);
  assert.equal(m.entities.find((e) => e.id === 'E-1').fields.find((f) => f.column === 'LANGUAGE_ID').lookupType, 'LANGUAGE');
  const lk = m.relationships.filter((r) => r.lookup);
  assert.equal(lk.length, 7);
  assert.ok(lk.every((r) => r.to === 'E-17'));
  assert.deepEqual(m.warnings, []);
});

test('parser: group and lookup warnings', () => {
  const noRow = grouped.replace(/^\| R-\d+ \| E-1 CCA Household \| E-17 CCA Lookup .*\n/m, '');
  assert.ok(parseErd(noRow).warnings.some((w) => /CCA_HOUSEHOLD\.LANGUAGE_ID: FK→LOOKUP has no Relationships row/.test(w)));
  const badGroup = grouped.replaceAll('- **Group:** Provider\n', '- **Group:** Providers\n');
  const w = parseErd(badGroup).warnings;
  assert.ok(w.some((x) => /Group "Providers" not in ## Groups/.test(x)));
  assert.ok(w.some((x) => /Group "Provider" in ## Groups has no entities/.test(x)));
  const noLookup = grouped.replace('- **Kind:** Lookup', '- **Kind:** Reference').replace(/CCA_LOOKUP/g, 'CCA_CODES');
  assert.ok(parseErd(noLookup).warnings.some((x) => /no lookup entity/.test(x)));
});

test('derived groups are deterministic and complete', () => {
  for (const md of [baseline, flawed]) {
    const a = parseErd(md), b = parseErd(md);
    assert.equal(a.groupsDerived, true);
    assert.ok(a.entities.every((e) => e.group), 'every entity has a group');
    assert.deepEqual(a.entities.map((e) => e.group), b.entities.map((e) => e.group));
    assert.deepEqual(a.groups, b.groups);
    assert.ok(a.groups.every((g) => a.entities.some((e) => e.group === g.name)), 'no empty groups');
    assert.ok(!a.warnings.some((x) => /Groups/.test(x)), 'inferred groups are a notice in the viewer, not a parser warning');
  }
});

test('hierarchy: within a group Core is above Junction, Reference and History', () => {
  for (const md of [grouped, baseline, flawed]) {
    const { nodes } = build(md);
    for (const g of new Set(nodes.map((n) => n.group))) {
      const mine = nodes.filter((n) => n.group === g), core = mine.filter((n) => n.kind === 'Core'), rest = mine.filter((n) => ['Junction', 'Reference', 'History/Audit'].includes(n.kind));
      for (const c of core) for (const r of rest) assert.ok(c.y <= r.y, `${c.id} (${c.y}) below ${r.id} (${r.y}) in ${g}`);
    }
  }
});

test('a Core child sits below its in-group Core parent, side by side with its siblings', () => {
  const { byId } = build(grouped);
  const [hh, member, address, hist] = ['E-1', 'E-2', 'E-3', 'E-4'].map((i) => byId.get(i));
  assert.ok(member.y > hh.y && address.y > hh.y && hist.y > member.y);
  assert.equal(member.y, address.y, 'siblings share a row');
  assert.notEqual(member.x, address.x);
  const pay = byId.get('E-14'), line = byId.get('E-15');
  assert.ok(line.y > pay.y);
});

test('routes are orthogonal, avoid tables and never share a stretch', () => {
  for (const md of [grouped, baseline, flawed]) for (const mode of ['grouped', 'compact']) checkRoutes(build(md, mode));
  checkRoutes(build(genLarge(60, 3, { grouped: true }).md));
});

test('every edge path is straight segments only', () => {
  for (const mode of ['grouped', 'compact']) {
    const { out } = build(grouped, mode);
    assert.ok(out.paths.length > 0);
    for (const p of out.paths) assert.match(p.d, /^M[\d.,-]+(L[\d.,-]+)+$/, p.id);
  }
});

test('lazy layout: no connectors up front, reroute() routes a subset into the same grid', () => {
  const b = build(grouped);
  const lazy = layoutDiagram(b.nodes.map((n) => ({ ...n })), b.edges, b.m.groups, { lazy: true, base: 12 });
  assert.equal(lazy.paths.length, 0);
  const ids = new Set(b.edges.slice(0, 8).map((e) => e.id));
  const paths = lazy.reroute(ids);
  assert.equal(paths.length, 8);
  for (const p of paths) assert.match(p.d, /^M[\d.,-]+(L[\d.,-]+)+$/, p.id);
  // squeezed into tight gutters, they still go through no table
  const nodes = b.nodes.map((n) => ({ ...n }));
  const again = layoutDiagram(nodes, b.edges, b.m.groups, { lazy: true, base: 12 });
  checkRoutes({ nodes, edges: b.edges.filter((e) => ids.has(e.id)), out: { paths: again.reroute(ids) }, byId: new Map(nodes.map((n) => [n.id, n])) });
});

// The rendered viewer, when Playwright and Chromium are around (they are not a dependency of this repo).
test('rendered viewer: edge paths are M/L only, frames and LK markers are drawn', async (t) => {
  let chromium;
  try { chromium = createRequire(import.meta.url)('playwright').chromium; } catch { try { chromium = createRequire('/opt/node22/lib/node_modules/')('playwright').chromium; } catch { /* none */ } }
  const exe = process.env.CHROMIUM ?? '/opt/pw-browsers/chromium';
  if (!chromium || !existsSync(exe)) {
    const why = 'rendered-viewer test needs playwright and chromium (set CHROMIUM to the browser path)';
    if (process.env.CI) assert.fail(why);
    console.error(`skipped: ${why}`);
    return t.skip(why);
  }
  const dir = mkdtempSync(join(tmpdir(), 'erdview-')), file = join(dir, 'g.html');
  writeFileSync(file, render(grouped).html);
  const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('file://' + file);
    for (const layoutMode of ['grouped', 'compact']) {
      await page.selectOption('#layoutmode', layoutMode);
      const r = await page.evaluate(() => [...document.querySelectorAll('#vp [data-r]')].flatMap((g) => [g.children[0], g.children[1]].map((p) => p.getAttribute('d'))));
      assert.ok(r.length >= 20, `${layoutMode}: edges drawn`);
      for (const d of r) assert.match(d, /^M[\d.,-]+(L[\d.,-]+)+$/);
    }
    await page.selectOption('#layoutmode', 'grouped');
    assert.equal(await page.evaluate(() => document.querySelectorAll('[data-frame]').length), 4);
    assert.ok(await page.evaluate(() => /LK/.test(document.querySelector('#vp').textContent)));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('the lookup table has no connectors and is boxed below the groups', () => {
  const b = build(grouped);
  const { m, out, byId } = b;
  const lk = byId.get(m.lookupId);
  assert.equal(out.paths.length, m.relationships.filter((r) => !r.lookup).length);
  assert.ok(out.paths.every((p) => !b.edges.find((e) => e.id === p.id) || (b.edges.find((e) => e.id === p.id).to !== lk.id && b.edges.find((e) => e.id === p.id).from !== lk.id)));
  assert.ok(out.lookup && lk.y >= out.lookup.y && lk.y + lk.h <= out.lookup.y + out.lookup.h);
  const lowest = Math.max(...out.frames.map((f) => f.y + f.h));
  assert.ok(out.lookup.y >= lowest, 'lookup frame is below the last band');
  // even if an edge to the lookup is handed in, it is not routed
  const extra = [...b.edges, { id: 'X', from: 'E-1', to: lk.id }];
  assert.ok(!layoutDiagram(b.nodes, extra, m.groups).paths.some((p) => p.id === 'X'));
});

test('group frames do not overlap and contain their nodes', () => {
  for (const md of [grouped, genLarge(80, 5, { grouped: true }).md]) {
    const { out, byId } = build(md);
    for (const f of out.frames) for (const id of f.nodes) {
      const n = byId.get(id);
      assert.ok(n.x >= f.x && n.y >= f.y && n.x + n.w <= f.x + f.w && n.y + n.h <= f.y + f.h, `${id} outside ${f.name}`);
    }
    for (let i = 0; i < out.frames.length; i++) for (let j = i + 1; j < out.frames.length; j++) {
      const a = out.frames[i], b = out.frames[j];
      assert.ok(!(inters(a.x, a.x + a.w, b.x, b.x + b.w) > 0 && inters(a.y, a.y + a.h, b.y, b.y + b.h) > 0), `${a.name} overlaps ${b.name}`);
    }
  }
});

test('frames are placed left to right in group order', () => {
  const { out } = build(grouped);
  const x = (n) => out.frames.find((f) => f.name === n).x;
  assert.ok(x('Household') < x('Application & Eligibility'));
});

test('performance: 150 entities lay out and route in under 300 ms', () => {
  for (const opts of [{}, { grouped: true }]) {
    const { md } = genLarge(150, 7, opts), m = parseErd(md);
    const nodes = m.entities.map((e) => ({ id: e.id, kind: kindOf(e), group: e.group, w: 120, h: 60 }));
    const edges = m.relationships.filter((r) => !r.lookup).map((r) => ({ id: r.id, from: r.from, to: r.to }));
    layoutDiagram(nodes.map((n) => ({ ...n })), edges, m.groups); // warm up
    const t = Date.now();
    layoutDiagram(nodes, edges, m.groups);
    assert.ok(Date.now() - t < 300, `took ${Date.now() - t} ms`);
  }
});

test('large synthetic ERD routes cleanly', () => {
  checkRoutes(build(genLarge(150, 7, { grouped: true }).md));
});

test('randomized layouts of varied table sizes route cleanly', () => {
  for (const grouped of [false, true]) for (const n of [30, 90, 150]) for (const seed of [1, 2]) for (const mode of ['grouped', 'compact']) {
    const m = parseErd(genLarge(n, seed, { grouped }).md);
    const nodes = m.entities.map((e, i) => ({ id: e.id, kind: kindOf(e), group: e.group, w: 100 + ((i * 37) % 160), h: 40 + ((i * 53) % 150) }));
    const edges = m.relationships.filter((r) => !r.lookup).map((r) => ({ id: r.id, from: r.from, to: r.to }));
    for (const lanes of [{}, { maxLanes: 2, laneMin: 1.6, base: 14 }]) {
      const out = layoutDiagram(nodes, edges, m.groups, { mode, ...lanes });
      checkRoutes({ nodes, edges, out, byId: new Map(nodes.map((x) => [x.id, x])) });
    }
  }
});

test('render: layout module is inlined and the template has no placeholder left', () => {
  const { html } = render(grouped);
  assert.ok(!html.includes('/*__LAYOUT__*/'));
  assert.ok(html.includes('function layoutDiagram'));
  assert.ok(!/^export /m.test(html));
});
