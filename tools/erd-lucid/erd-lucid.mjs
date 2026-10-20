#!/usr/bin/env node
// ERD.md <-> Lucidchart sync tool. No dependencies, no network: it plans, diffs and records; the erd-lucid skill moves the
// generated scripts and snapshots to and from Lucid through the Lucid MCP connector.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { normalizeErd, toBaseline } from './lib/model.mjs';
import { SNAPSHOT_SCRIPT, toSeen } from './lib/snapshot.mjs';
import { batchScript } from './lib/scripts.mjs';
import { firstPush, incrementalPush, unpulled, DEFAULT_BATCH } from './lib/push.mjs';
import { buildPull, renderChangeset } from './lib/pull.mjs';

const USAGE = `Usage: node erd-lucid.mjs <command> [options]
  init            --state <lucid.json> --doc-id <uuid> --doc-url <url> --title <title>
  push-plan       <ERD.md> --out <dir> [--state <lucid.json>] [--snapshot <snap.json>] [--batch-size <n>] [--date <YYYY-MM-DD>]
                  First push when the state has no baseline; otherwise an incremental push that needs --snapshot.
                  Exit 3: Lucid has unpulled changes (run pull first).
  snapshot-script prints the read-only Lucid script that dumps the document
  pull-diff       <ERD.md> --state <lucid.json> --snapshot <snap.json> --source S<n> --run <YYYY-MM-DD> [--decisions <DECISIONS.md>] [--out <file>] [--dry-run]
                  Writes <erd dir>/changes/<run>-lucid-changeset.md; with no changes it writes nothing and exits 0.
  record          --push <ERD.md> --ids <ids.json> --state <lucid.json> [--date <YYYY-MM-DD>]
  record          --pull <ERD.md> --snapshot <snap.json> --state <lucid.json> [--source S<n>]`;

const die = (msg, code = 2) => { console.error(msg); process.exit(code); };
const today = () => new Date().toISOString().slice(0, 10);

function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { console.log(USAGE); process.exit(0); }
    if (a === '--dry-run') o.dryRun = true;
    else if (a.startsWith('--')) { const v = argv[++i]; if (v === undefined || v.startsWith('--')) die(`${a} needs a value\n${USAGE}`); o[a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v; }
    else o._.push(a);
  }
  return o;
}
const readJson = (p, what) => { if (!existsSync(p)) die(`${what} not found: ${p}`); try { return JSON.parse(readFileSync(p, 'utf8')); } catch (e) { die(`${what} is not valid JSON: ${p}`); } };
const readMd = (p) => { if (!p) die(USAGE); if (!existsSync(p)) die(`File not found: ${p}`); return readFileSync(p, 'utf8'); };
const writeState = (p, st) => writeFileSync(p, JSON.stringify(st, null, 2) + '\n');

const [cmd, ...rest] = process.argv.slice(2);
const a = parseArgs(rest);

if (!cmd || cmd === '-h' || cmd === '--help') { console.log(USAGE); process.exit(cmd ? 0 : 2); }

if (cmd === 'snapshot-script') {
  process.stdout.write(SNAPSHOT_SCRIPT);
} else if (cmd === 'init') {
  if (!a.state || !a.docId || !a.docUrl) die(`init needs --state, --doc-id and --doc-url\n${USAGE}`);
  const st = existsSync(a.state) ? readJson(a.state, 'State file') : {};
  writeState(a.state, { format: 1, document: { id: a.docId, url: a.docUrl, title: a.title ?? st.document?.title ?? '', page: 1 }, lastPush: st.lastPush ?? { at: null, erdVersion: null }, lastPull: st.lastPull ?? { at: null, sourceId: null }, ids: st.ids ?? {}, baseline: st.baseline ?? null, seen: st.seen ?? null });
  console.log(`Recorded document ${a.docId} in ${a.state}`);
} else if (cmd === 'push-plan') {
  const n = normalizeErd(readMd(a._[0]));
  if (!n.entities.length) die(`No live entities found in ${a._[0]}`, 1);
  if (!a.out) die(`push-plan needs --out <dir>\n${USAGE}`);
  const batchSize = a.batchSize ? +a.batchSize : DEFAULT_BATCH;
  if (!(batchSize >= 1)) die('--batch-size must be a positive number');
  const date = a.date ?? today();
  const state = a.state && existsSync(a.state) ? readJson(a.state, 'State file') : null;
  for (const w of n.warnings) console.error(`warning: ${w}`);
  mkdirSync(a.out, { recursive: true });
  let plan;
  if (!state?.baseline) {
    plan = firstPush(n, { batchSize, date });
  } else {
    if (!a.snapshot) die('An incremental push needs --snapshot <snap.json> (run the snapshot script first)');
    const snap = readJson(a.snapshot, 'Snapshot');
    const open = unpulled(snap, state);
    if (open.length) { console.error(`Lucid has ${open.length} unpulled change(s). Run pull first.`); process.exit(3); }
    plan = incrementalPush(n, state, snap, { batchSize, date });
    for (const w of plan.warnings) console.error(`warning: ${w}`);
    if (!plan.ops.length) { console.log(`Lucid doc matches ERD v${n.version}.`); writeFileSync(join(a.out, 'plan.json'), JSON.stringify({ mode: 'incremental', counts: {}, batches: 0 }, null, 2)); process.exit(0); }
  }
  plan.batches.forEach((ops, i) => writeFileSync(join(a.out, `batch-${String(i + 1).padStart(3, '0')}.js`), batchScript(ops, `${plan.mode} push, batch ${i + 1}/${plan.batches.length}`)));
  writeFileSync(join(a.out, 'plan.json'), JSON.stringify({ mode: plan.mode, erdVersion: n.version, counts: plan.counts, batches: plan.batches.length, batchSizes: plan.batches.map((b) => b.length), warnings: plan.warnings ?? [], ops: plan.mode === 'incremental' ? plan.ops.map(({ op, id }) => ({ op, id })) : undefined }, null, 2) + '\n');
  const c = plan.counts;
  console.log(plan.mode === 'first'
    ? `First push: ${c.entities} entities, ${c.relationships} relationships, ${plan.batches.length} batch(es) in ${a.out}`
    : `Incremental push: ${Object.entries(c).map(([k, v]) => `${v} ${k}`).join(', ')}; ${plan.batches.length} batch(es) in ${a.out}`);
} else if (cmd === 'pull-diff') {
  if (!a.state || !a.snapshot || !a.source || !a.run) die(`pull-diff needs --state, --snapshot, --source and --run\n${USAGE}`);
  const erdPath = a._[0], md = readMd(erdPath);
  const n = normalizeErd(md), state = readJson(a.state, 'State file'), snap = readJson(a.snapshot, 'Snapshot');
  if (!state.baseline) die('The state file has no baseline: run push first', 1);
  const decisions = a.decisions && existsSync(a.decisions) ? readFileSync(a.decisions, 'utf8') : null;
  const r = buildPull(n, state, snap, { source: a.source, decisions, url: state.document?.url ?? '' });
  for (const w of r.warnings) console.error(`warning: ${w}`);
  if (!r.ops.length) { console.log(`Lucid doc matches ERD v${n.version}.`); for (const s of r.notProposed) console.log(`not proposed: ${s}`); process.exit(0); }
  const summary = `${r.ops.length} proposed change(s): ${r.counts[0]} additive · ${r.counts[1]} modifying · ${r.counts[2]} breaking · ${r.counts[3]} conflict`;
  if (a.dryRun) { console.log(summary); process.exit(0); }
  const dir = join(dirname(resolve(erdPath)), 'changes');
  let file = a.out;
  if (!file) { mkdirSync(dir, { recursive: true }); file = join(dir, `${a.run}-lucid-changeset.md`); for (let i = 2; existsSync(file); i++) file = join(dir, `${a.run}-${i}-lucid-changeset.md`); }
  writeFileSync(file, renderChangeset(r, { run: a.run, baseVersion: n.version }));
  console.log(`${file}\n${summary}`);
} else if (cmd === 'record') {
  if (!a.state) die(`record needs --state\n${USAGE}`);
  const st = readJson(a.state, 'State file');
  if (a.push) {
    const n = normalizeErd(readMd(a.push));
    const ids = a.ids ? readJson(a.ids, 'Ids file') : {};
    const live = new Set([...n.entities.map((e) => e.id), ...n.relationships.map((r) => r.id)]);
    const merged = { ...st.ids, ...ids };
    for (const k of Object.keys(merged)) if (/^[ER]-/.test(k) && !live.has(k)) delete merged[k];
    st.ids = merged; st.baseline = toBaseline(n); st.seen = toBaseline(n);
    st.lastPush = { at: `${a.date ?? today()}T${new Date().toISOString().slice(11, 19)}Z`, erdVersion: n.version };
    writeState(a.state, st);
    console.log(`Recorded push of ERD v${n.version}: ${n.entities.length} entities, ${n.relationships.length} relationships`);
  } else if (a.pull) {
    if (!a.snapshot) die('record --pull needs --snapshot');
    const n = normalizeErd(readMd(a.pull)), snap = readJson(a.snapshot, 'Snapshot');
    st.baseline = toBaseline(n); st.seen = toSeen(toBaseline(n), snap);
    st.lastPull = { at: snap.takenAt, sourceId: a.source ?? st.lastPull?.sourceId ?? null };
    writeState(a.state, st);
    console.log(`Recorded pull at ${snap.takenAt}; baseline is ERD v${n.version}`);
  } else die(`record needs --push or --pull\n${USAGE}`);
} else die(`Unknown command: ${cmd}\n${USAGE}`);
