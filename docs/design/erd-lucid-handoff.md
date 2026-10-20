# Handoff: sync ERD.md with Lucidchart (`erd-lucid`)

You are building a new module that **pushes** `ERD.md` into one living Lucidchart document and **pulls** edits
made in Lucid back into `ERD.md` as a reviewable change set. **This file is the build spec.** The decisions are
made below. If a question comes up that this file doesn't answer, choose the option most consistent with the
existing `tools/erd-view/`, `tools/erd-assist/` and `skills/erd-maintain/` code, and record it under
"Implementation notes" at the end of this file.

Work on branch `dev`. Commit in logical steps (suggested points are marked ✅). Push with
`git push -u origin dev` when done. Don't open a pull request.

Phase 0 (the spike) must be done first. Its results may change details in §4–§6. Record what you find
under "Implementation notes", then adjust the build.

---

## 1. Goal

`erd-view` renders `ERD.md` as an offline HTML page, and it stays as it is. The user also wants the ERD in Lucidchart,
where the team can look at it and edit it. Over time, edits made in Lucid must flow back into `ERD.md`.

The user's decisions:

| # | Decision |
|---|---|
| D1 | **One living Lucid doc per ERD.** The first push creates it. Later pushes update that doc in place: they add, change and remove tables, fields and lines, and they **never move a table a person has placed**. The doc id is stored in a committed `erd/lucid.json`. |
| D2 | **Leave existing hand-built Lucid ERDs alone** (for example "MN DHS ERD - Appian"). The tool only touches the doc recorded in `lucid.json`. There is no import of foreign docs. |
| D3 | **Pull is on demand only.** `/project-terrarium:erd-lucid pull`. No schedule, no auto-apply. `ERD.md` changes only through a change set the user accepts at Gate C, as `erd-maintain` already works. |
| D4 | **The Lucid doc is a source.** Each pull that finds changes registers a new row in `sources.md` (Kind `lucid-diagram`) that supersedes the previous Lucid row. Changes cite it as `[S<n> §<TABLE>]` or `[S<n> §<TABLE>.<COLUMN>]`. |
| D5 | `erd-view` is unchanged. ERD.md stays the canonical model; Lucid is a view people can edit, never a second source of truth. |

Out of scope: syncing citations, assumptions, questions, change log or decisions into Lucid; reading layout
(positions) back; Lucidspark; any CI or GitHub Action (there are no Lucid API credentials in the repo, see §2).

---

## 2. Architecture

Lucid is reached **only through the Lucid MCP connector** in a Claude session. The plugin holds no Lucid OAuth
client or API key, and the Lucid REST API has no element-level editing, so a headless CI job is not an option.
This also means everything runs as the signed-in user, with that user's Lucid permissions.

The work splits into two parts:

```
                    ┌──────────────── tools/erd-lucid/erd-lucid.mjs (Node 18+, no deps, offline, unit-tested) ───────────────┐
 ERD.md ─► parse ─► │ push-plan: diff ERD model vs baseline in lucid.json ─► ops ─► batched Lucid script sources (.js)    │
                    │ snapshot-script: the read-only Lucid script that dumps the doc                                     │
 snapshot.json ───► │ pull-diff: 3-way (baseline · Lucid snapshot · ERD.md) ─► erd/changes/<RUN>-lucid-changeset.md       │
                    │ record: write the new baseline + id map into erd/lucid.json                                          │
                    └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
                                         ▲ files                                    │ script source
                    ┌─────────── skills/erd-lucid/SKILL.md (orchestrator, runs in the main session) ───────────┐
                    │ calls mcp__Lucid__* tools: create doc, lucid_run_script (read + write), export PNG     │
                    │ Gate C + apply reuse erd-maintain Step 5/6 and erd-analyst apply mode                   │
                    └──────────────────────────────────────────────────────────────────────────────────────────┘
```

- **All logic lives in the Node tool**, so it's deterministic and testable without Lucid. The skill only moves
  files between the tool and the MCP calls, and it never hand-writes Lucid scripts.
- Lucid scripts (`lucid_run_script`) run JavaScript inside the doc. They have **no network**, a **25 s limit** and
  **atomic** commits (a failed script reverts all its changes). So the tool emits each batch as a self-contained
  script with its data inlined as a JSON literal, and the skill runs the batches one by one.
- Lucid APIs used inside scripts (confirmed available on this account, 2026-10-20):
  - `skills.erds`: `createSchema`, `create`, `list`, `read`, `update`, `addField`, `updateField`, `removeField`,
    `moveField`, `createRelationship`, `listRelationships`, `updateRelationship`. Field rows are 1-based indices.
    Cardinalities are `one | exactlyOne | zeroOrOne | many | oneOrMany | zeroOrMany`. The Key cell is raw text;
    `PK`, `FK` and `AK` (unique) are detected by "contains".
  - `skills.formulas`: `addShapeDataField`, `setShapeDataValue`, `listShapeDataFields`, `getShapeDataField`. This
    is per-shape data, used to stamp stable ERD IDs on Lucid shapes.
  - `skills.basecanvasediting`: read, delete, containers, text blocks. Load its documentation in the spike.
  - Load documentation with `lucid_load_script_documentation(doc, name)` before writing the script templates. The
    `erds` reference says entities need ≥160 px clearance and that `createSchema` gives **no** useful layout.

---

## 3. Phase 0: spike (do first, in a throwaway doc)

Ask the user before creating anything in their Lucid account. Name the doc
`project-terrarium sync test (delete me)` and put it in the root folder. Answer each question and write the answer
under "Implementation notes → Spike":

| # | Question | Why it matters |
|---|---|---|
| S1 | What's the cleanest way to create an **empty** Lucidchart doc that scripts can then write to? Candidates: `lucid_create_diagram_from_specification` with one text block (delete it afterwards), or `lucid_create_erd` with the real entities. | First push (§5a). Preferred: an empty doc, then `erds.createSchema` from a script, because it takes positions and returns `entityIdsByKey`. |
| S2 | Can `formulas.addShapeDataField` set shape data on **ERD relationship lines**, and does it survive `updateRelationship`? | Relationship identity (§4b). If not, fall back to matching by endpoints. |
| S3 | Does shape data on an entity survive `addField`, `removeField`, rename via `update`, and copy/paste in the Lucid UI? (Copy/paste must **not** be treated as the same entity, so check for duplicate `ERD_ID` values.) | Entity identity. |
| S4 | Throughput: how many entities with ~15 fields each, and how many relationships, fit in one script under 25 s? Is there a limit on script source size? Measure 10/25/50 entities. | Batch size (§5c). Keep a 50 % safety margin. |
| S5 | Can a container (group frame) be created with a label, and can entities sit inside it without being "owned" by it in a way that breaks `erds.read`? | Group frames (§4a). If containers cause trouble, use a plain labelled rectangle behind the tables. |
| S6 | What do `erds.read` / `listRelationships` return for a field row the UI user added with an empty Key or Type, and for a relationship drawn by hand to the table header (fieldIndex 0)? | Pull parsing edge cases (§6b). |
| S7 | Does `lucid_get_document_metadata` return a last-modified timestamp or version number? | Source fingerprint for D4. |

✅ Commit: `erd-lucid: record spike results` (only the notes in this file).

---

## 4. How the ERD looks in Lucid (the mapping)

### 4a. Shapes

| ERD.md | Lucid |
|---|---|
| Entity (not deprecated) | One ERD entity block, variant `keyFieldType`. Name = table name (`DHS_CASE`). |
| Field (not deprecated) | One row, in ERD.md order: Key · Field = **Column** (`CASE_NUMBER`) · Type (see 4c). |
| Relationship (not deprecated, not to the LOOKUP table) | A crow's-foot line from the parent's PK row to the child's FK row (see 4d). |
| Shared `<PREFIX>_LOOKUP` | An entity block with no lines, placed under the last group. Referencing FK rows carry `LK:<TYPE>` in the Key cell (4c). Seed tables are not pushed. |
| Group | A labelled container or frame (spike S5) sized around its tables, labelled with the group name. Visual only: the `Group` shape-data field is the truth. |
| Kind | Header shading: Core = default, Reference = grey, Junction = teal, History/Audit = sand, Lookup = amber. Put the colours in one constant table in the tool. |
| Deprecated entity, field or relationship | **Not drawn**, which matches the viewer's default. If it was drawn before, the push removes it. |
| Doc header | A text block above the diagram: `<title> · ERD v<n> · pushed <date> · managed by project-terrarium. Edit tables, fields, lines and the shape data; move anything. Citations live in ERD.md.` |

### 4b. Identity (shape data)

Every pushed entity block gets these shape-data fields. People may edit the last four in Lucid's data panel, and a
pull reads them:

| Field | Value | Pull reads it? |
|---|---|---|
| `ERD_ID` | `E-3` | identity only. Never edited by people. |
| `Kind` | `Core` / `Reference` / … | yes → `modify` op |
| `Group` | group name | yes → `rename E-n.group` op (breaking, per changeset-format) |
| `Sensitivity` | `None` / `PII` / … | yes → `modify` op |
| `Purpose` | the one-sentence purpose | yes → `modify` op |

Relationship lines get `ERD_ID = R-5` if spike S2 allows it. Otherwise a relationship is identified by
(parent `ERD_ID`, child `ERD_ID`, child FK column) against the baseline.

Fields have no IDs in Lucid. A field is identified by its Column within its entity, and the baseline gives each
column's record-field name (camelCase), so a field added in Lucid gets its camelCase name from the naming rules
(`CASE_TYPE_ID` → `caseTypeId`).

### 4c. Field row cells

- **Key:** `PK`, `FK`, `AK` (for ERD `UK`), combinations joined with `,` (`PK,FK`). A LOOKUP FK is
  `FK LK:CASE_TYPE`. An FK's target entity comes from the relationship line, not from the Key cell.
- **Type:** the Appian type, plus ` NOT NULL` when Req is `Y` (this is Lucid's own nullable convention, so
  `nullable` reads back correctly). Example: `Text(20) NOT NULL`.
- Pull maps all of these back exactly. Round-trip must be lossless for every field the push writes. A unit test
  checks this (§7).

### 4d. Relationship ends

| ERD cardinality | Parent end (primary) | Child end (foreign) |
|---|---|---|
| `many-to-one`, FK Req `Y` | `exactlyOne` | `zeroOrMany` |
| `many-to-one`, FK Req `N` | `zeroOrOne` | `zeroOrMany` |
| `one-to-one`, FK Req `Y` | `exactlyOne` | `zeroOrOne` |
| `one-to-one`, FK Req `N` | `zeroOrOne` | `zeroOrOne` |

On pull, any child end in `many | oneOrMany | zeroOrMany` means `many-to-one`. Any other end means `one-to-one`.
Parent-end changes that only flip optionality are reported as a `modify-field` op on the FK's Req, not as a
cardinality change. New lines are drawn without a label; the relationship Description stays in ERD.md only. Labels already on managed lines (matched to an ERD id) are cleared once on the next push with an explicit `updateRelationship(lineId, { label: '' })` (`clear-rel-label` op); `updateRelationship` only changes the fields it is given, so clearing has to be explicit and the usual `update-rel` never touches a label. The snapshot records each line's label only to decide this; it never enters pull diffs or the baseline, and clearing does not reroute the line. Hand-drawn lines that ERD.md does not know are left alone.

---

## 5. Push (ERD.md → Lucid)

### 5a. Sync state: `<erd_dir>/lucid.json` (committed)

```json
{
  "format": 1,
  "document": { "id": "<uuid>", "url": "https://lucid.app/lucidchart/<uuid>/edit", "title": "<Project> ERD", "page": 1 },
  "lastPush": { "at": "2026-10-20T15:04:05Z", "erdVersion": 7 },
  "lastPull": { "at": null, "sourceId": null },
  "ids": { "E-3": "<lucid block id>", "R-5": "<lucid line id>" },
  "baseline": { "entities": [ /* normalized model as of the last push or applied pull: id, table, kind, group, sensitivity, purpose, fields[{column, field, type, req, key, lookupType}] */ ], "relationships": [ /* id, from, to, fk, cardinality */ ] }
}
```

The baseline is the common ancestor for the 3-way diff. It contains only what the push wrote: no citations and no
descriptions beyond Purpose. That's no more than `ERD.md`, which is committed too, so `lucid.json` is safe to commit.

### 5b. `node tools/erd-lucid/erd-lucid.mjs push-plan <ERD.md> [--state <lucid.json>] [--snapshot <snap.json>] --out <dir>`

1. Parse `ERD.md` with `tools/erd-view/lib/parse.mjs` (import it; don't copy it). Normalize to the baseline shape.
2. **No state file → first push.** Lay out with `layoutDiagram` from `tools/erd-view/lib/layout.mjs` in grouped
   mode. Scale positions so there's ≥160 px between tables (the `erds` rule), and emit `createSchema` batches,
   then a stamping batch (shape data and shading), then group frames and the header text block.
3. **State file present → incremental push.** It requires `--snapshot` (a fresh Lucid snapshot, §6a).
   - **Guard:** diff snapshot against baseline first. If Lucid has changes that haven't been pulled, stop with exit
     code 3 and the message `Lucid has N unpulled change(s). Run pull first.` Push never overwrites a Lucid edit.
     There is no `--force` in v1.
   - Diff ERD model vs baseline into ops: `create-entity`, `delete-entity` (deprecated or gone), `update-entity`
     (name, shape data, shading), `add-field`, `remove-field`, `update-field`, `move-field` (order), `create-rel`,
     `delete-rel`, `update-rel`.
   - Place a new entity to the right of the rightmost table in its group's frame (`location.nextTo` with
     `padding: 160`), and grow the frame. **Never move an existing table.**
   - A table that exists in the snapshot with no `ERD_ID` but has the same name as a new ERD entity (someone drew it
     in Lucid and it was then accepted through a pull) is **adopted**: stamp it, don't create a second one.
4. Write `<dir>/batch-001.js …` (each one a complete script that returns `{ ok, created: {ERD_ID: lucidId}, errors }`),
   `<dir>/plan.json` (ops and counts), and print a one-line summary. Scripts must be **idempotent**: before
   creating, check whether a block with that `ERD_ID` already exists, so a rerun after a failed batch is safe.

### 5c. Skill steps for `push`

1. Resolve the ERD path as `erd-view` does. Read `lucid.json` if it exists.
2. First push: confirm the doc title with the user, create the doc (per spike S1) with `product: "lucidchart"`,
   and put `document` into the state.
3. Incremental push: run the snapshot script (§6a), save it to the scratchpad, and pass `--snapshot`. On exit 3,
   tell the user to pull first and stop.
4. Run each batch with `lucid_run_script`, in order. Collect the returned id maps. If a batch fails, stop, report
   which one, and don't record. A rerun is safe (idempotent).
5. Run `erd-lucid.mjs record --push <ERD.md> --ids <merged ids json> --state <lucid.json>` to write the baseline and
   `lastPush`.
6. Export page 1 with `lucid_export_document_as_PNG` and look at it. If tables overlap or lines run through tables,
   run `basecanvasediting.rerouteLines` on the affected lines and nudge **only newly created** tables. Report the
   doc URL, the counts, and any warnings.

✅ Commit: `erd-lucid: push-plan, layout mapping and batch scripts`

---

## 6. Pull (Lucid → change set → ERD.md)

### 6a. `erd-lucid.mjs snapshot-script` → prints a read-only script

The script returns `{ takenAt, entities: [{lucidId, name, shapeData:{ERD_ID,Kind,Group,Sensitivity,Purpose}, fields:[{index,name,key,type,nullable}]}], relationships: [{lineId, erdId?, primary:{entityId,fieldName,cardinality}, foreign:{…}}] }`.
It uses `erds.list`, `erds.read`, `erds.listRelationships` and `formulas.listShapeDataFields`. If one script can't
read the whole doc in 25 s (spike S4), the tool emits paged read scripts (`--page k`) and the skill concatenates
the results.

### 6b. `erd-lucid.mjs pull-diff <ERD.md> --state <lucid.json> --snapshot <snap.json> --source S<n> [--decisions <DECISIONS.md>] --run <RUN>`

A 3-way diff. **Theirs** = snapshot vs baseline (what people changed in Lucid). **Ours** = ERD.md vs baseline
(what changed in ERD.md since the last sync).

| Lucid change (theirs) | Change-set op | Class (per changeset-format) |
|---|---|---|
| New table with no `ERD_ID` | `add-entity` with `E-new-k`, Field detail block, Group from shape data (`Group` blank → `raise-question`) | additive |
| Table removed | `deprecate E-n` | breaking |
| Table renamed | `rename E-n` | breaking |
| Field added | `add-field E-n.<camelCase>` | additive |
| Field removed | `deprecate E-n.<field>` | breaking |
| Field renamed (one removed and one added with the same type at the same index) | `rename E-n.<field>`, Confidence Medium | breaking |
| Type text changed | `modify-field` | modifying |
| `NOT NULL` toggled | `modify-field` (Req) | modifying |
| Key cell changed | `modify-field` | breaking |
| Line added / removed | `add-relationship R-new-k` / `deprecate R-n` | additive / breaking |
| Cardinality changed | `modify-relationship` | breaking |
| Shape data Kind / Sensitivity / Purpose changed | `modify-field`-style op on `E-n.kind` etc. | modifying |
| Shape data Group changed | `rename E-n.group` | breaking |
| Table drawn without a PK, or a line attached to a header (fieldIndex 0) | no op. Listed under *Not proposed* with the reason. | — |
| Position, colour or size change | ignored | — |

Rules:

- **Evidence** is `[S<n> §<TABLE>]` or `[S<n> §<TABLE>.<COLUMN>]`. **Supersedes** (required for
  modifying and breaking ops) is the element's existing citations from `ERD.md`.
- **Conflicts:** if the same element also changed on the ours side, or the element is in an Active decision's Affects
  (parse with `parseDecisions` from `tools/erd-assist/erd-slice.mjs`), the op's class is `conflict` and it gets the
  paired `raise-question` op, exactly as in changeset-format.
- An ID-stamped Lucid shape that's deprecated in ERD.md (because the push removed it and someone restored it via
  undo) → `raise-question`, never an un-deprecate.
- Duplicate `ERD_ID` (copy/paste in Lucid): the shape nearest the baseline wins. The rest are treated as new
  tables, and a warning is printed.
- Apply the re-proposal rule: read prior `erd/changes/*-lucid-changeset.md` files. Since each pull gets a higher
  S-ID, a re-made Lucid change is proposed again on purpose.
- Header: `New sources` = the one Lucid S-ID. Summary names the doc URL and the snapshot time.
- **No changes → exit 0, write nothing**, print `Lucid doc matches ERD v<n>.`

### 6c. Skill steps for `pull`

1. Needs `lucid.json`. Without it: "Nothing to pull. Run push first."
2. Run the snapshot script(s) and save the result to `.project-terrarium/staging/lucid-<RUN>.json` (git-ignored).
3. Dry run: `pull-diff` with a placeholder `--source S?`. If there are no changes, report and stop.
4. Add the ledger row to `sources.md`: Kind `lucid-diagram`, Title = doc title, Date = snapshot date, Location = doc
   URL, Fingerprint = `lucid:<lastModified>` (spike S7; fall back to `lucid:<takenAt>`), Ingested = today,
   Staged file = `lucid-<RUN>.json`, Status `active`. Mark the previous `lucid-diagram` row `superseded`.
   Rerun `pull-diff` with the real S-ID.
5. **Gate C** and **apply**: follow `skills/erd-maintain/SKILL.md` Step 5 and Step 6 as written (same questions, same
   `erd-analyst` apply mode, Version+1, Change log row naming the change-set path and accepted count). Don't
   duplicate that text in the new skill; reference it.
6. After apply, run `record --pull <ERD.md> --snapshot <snap> --state <lucid.json>`, which sets the baseline from the
   new ERD.md. Then offer a **push**: rejected ops mean Lucid now differs from ERD.md, and the push puts Lucid back
   in line. It also stamps `ERD_ID` on tables accepted from Lucid (the adopt rule in 5b).

✅ Commit: `erd-lucid: snapshot, 3-way pull-diff to change set, record`

---

## 7. Tests (`tools/erd-lucid/test/*.test.mjs`, `node --test "tools/*/test/*.test.mjs"`)

Fixtures in `examples/fixtures/lucid/`. Build them from `examples/fixtures/baseline/ERD.md`:

- `mapping.test.mjs`: field round-trip (4c) for PK, FK, AK, `FK LK:<TYPE>`, Req Y/N, and types with parentheses;
  cardinality table (4d) both ways.
- `push-plan.test.mjs`: the first push emits one entity per non-deprecated entity, no lines to LOOKUP, and no deprecated items;
  an incremental push after deprecating a field emits exactly one `remove-field`; the unpulled-changes guard exits 3;
  the adopt rule; batches respect the configured size; every emitted script parses (`new Function` in an async wrapper).
- `pull-diff.test.mjs`: one hand-written snapshot per row of the 6b table → expected change-set rows (compare
  against `examples/fixtures/lucid/expected-changeset.md`); a conflict when ours and theirs both change a field; a
  conflict on a DEC-affected element (use `examples/fixtures/decisions/`); no changes → no file.
- Large model: run `push-plan` on `tools/erd-view/test/gen-large.mjs` output (150 entities) and check the batch count and
  that there are no overlapping positions.

Lucid itself isn't mocked beyond the snapshot JSON. The live check is §9.

✅ Commit: `erd-lucid: tests and fixtures`

---

## 8. Skill, docs, config, version

- `skills/erd-lucid/SKILL.md`: `argument-hint: "push|pull [path/to/ERD.md]"`. Its description triggers on
  "Lucid", "Lucidchart", "push/sync the ERD to Lucid", "pull changes from Lucid". It covers §5c and §6c, says the
  `Lucid` MCP connector is required (if missing, point to Settings → Connectors and stop), and says to read
  `lucid://skills/readme` once per session as the connector requires.
- `project-terrarium.yaml` (and `skills/setup/SKILL.md`): optional `lucid.folder_id` (where the first push
  creates the doc) and `lucid.document_title` (default `<Project> ERD`).
- `skills/erd-build/references/erd-format.md`: one bullet saying `lucid.json` sits next to `ERD.md` and is managed only by
  `erd-lucid`.
- `skills/erd-maintain/references/changeset-format.md`: Evidence may be `[S<n> §TABLE.COLUMN]` from a
  `lucid-diagram` source.
- `skills/erd-maintain/references/delta-discovery.md`: `lucid-diagram` rows are never re-discovered or re-staged by
  maintain.
- `agents/appian-erd-reviewer.md` / `erd-analyst.md`: a `lucid-diagram` source is a team edit, weighted like a vendor
  design decision (below DHS/state stakeholders in the conflict rule).
- README: module table row `ERD Lucid sync | /project-terrarium:erd-lucid | v0.1` and a short "ERD in Lucidchart"
  section with the push/pull diagram and the commands.
- `.claude-plugin/plugin.json` and `marketplace.json`: version → `0.7.0`, and mention Lucid sync in the description.

✅ Commit: `Document erd-lucid; bump to 0.7.0`

---

## 9. Verification (do all of it before pushing)

1. `node --test "tools/*/test/*.test.mjs"`: all green, including the existing erd-view and erd-assist tests.
2. Live, with the user's OK, in the spike doc or a new `project-terrarium sync test (delete me)` doc, using
   a scratch copy of `examples/fixtures/baseline/ERD.md`:
   1. First push → PNG export shows every live table in group frames, no overlaps, and no lines to LOOKUP.
   2. In Lucid (through a script, standing in for a person): add a field, change a type, delete a line, add a table
      with Group set, change one table's Kind.
   3. Push → refused (unpulled changes).
   4. Pull → change set has exactly those 5 changes, plus a ledger row. Accept 4 and reject 1 → ERD Version+1, with
      citations to the new S-ID.
   5. Push → Lucid reverts the rejected change, and the new table gets its `ERD_ID`. A second pull → "matches".
   6. Deprecate a field in ERD.md (as erd-assist would) → push removes the row and no table moves (compare bounding boxes
      before and after).
3. Put screenshots in `docs/design/erd-lucid/` (first push, after round-trip).
4. Tell the user the test doc's URL so they can delete it. Don't delete it yourself.

---

## 10. Known limits (state them in the README)

- Needs a Claude session with the Lucid connector. There's no headless or CI sync.
- Citations, descriptions (other than Purpose), assumptions, questions and seed values exist only in ERD.md.
- Layout is not read back, and people own it after the first push. Group frames don't follow tables a person drags
  out of them; the `Group` shape data does.
- Field renames in Lucid are a heuristic (Confidence Medium). Copy-pasted tables lose their identity.

---

## Implementation notes

### Spike

Run 2026-10-20 in `project-terrarium sync test (delete me)` (root folder, user-approved). Every answer below was measured, not assumed.

| # | Answer |
|---|---|
| S1 | **Empty doc:** `lucid_create_erd` with one placeholder entity (`SEED`), then delete it from a script (`basecanvasediting.deleteItem`). Simpler than a diagram-specification text block and needs no `lucid://skills/diagram-specification` read. `erds.createSchema` also works (positions honoured, `entityIdsByKey` returned), but the tool uses `erds.create` per entity instead (see Decisions): it is idempotent per `ERD_ID` and stamps shape data in the same call. |
| S2 | **Yes.** `formulas.addShapeDataField` works on relationship lines (`lineId`), and the value survives `updateRelationship` (cardinality edits). Relationships are identified by `ERD_ID = R-n`, with the (parent, child, FK column) signature as the fallback for lines without one. |
| S3 | Entity shape data **survives** `addField`, `moveField`, rename through `erds.update`. **Copy/paste duplicates the data**: `copyPasteItems` produced a second ERD entity carrying `ERD_ID = E-1`, so duplicate detection is required (§6b rule implemented: the shape that best matches the baseline keeps the id, the rest are new tables). |
| S4 | 10 entities ×15 fields + 9 lines: 0.85 s. 25 + 24: 1.4 s. 50 + 49: 2.4 s (`createSchema`), stamping 50 entities 21 ms, reading 50 entities 17 ms. Roughly 45 ms per entity, so the 25 s limit is nowhere near at 40 ops per batch; the default batch is **40 ops** (about 2 s, a >10x margin). No source-size limit was hit (a 16 KB script ran). A full snapshot of ~50 entities takes <100 ms, so the snapshot script needs no paging. |
| S5 | `wrapInContainer({className: 'SparkFrameBlock', label})` works. Entities inside the frame stay readable by `erds.list/read`, and relationships and shape data are unaffected. The frame is stamped with `ERD_ID = F:<group>` so later pushes find it. |
| S6 | A row a person adds with empty Key/Type reads `{key: '', type: '', nullable: true}`. A line drawn to the header reports `fieldIndex: 0` with no `fieldName` (cardinality defaults to `one`/`many`). Header lines are listed under *Not proposed*; rows with an empty name are ignored. |
| S7 | `lucid_get_document_metadata` (and the create response) return `version` (integer, bumps on every edit) and `lastModified`. Ledger fingerprint: `lucid:<lastModified>`. |

Other things the spike found: ERD entities size themselves from `columnWidths`; measured height is about 33 px header + 35.5 px per row, and about 10 px per character of text, so the tool sets generous column widths so no cell wraps. `basecanvasediting.rerouteLines` tidies the lines a lot and is run on every push for the lines it touched.

### Commits

1. `erd-lucid: record spike results` (notes only)
2. `erd-lucid: push-plan, layout mapping, batch scripts, snapshot, 3-way pull-diff and record` (the tool, `tools/erd-lucid/`: the push and pull halves share one model module, so they went in together)
3. `erd-lucid: tests and fixtures`
4. `Document erd-lucid; bump to 0.7.0`
5. a final commit with the fixes and screenshots from the live verification (below) and these notes

### Decisions and deviations

- **`erds.create` per entity instead of `createSchema`.** Each op finds its entity by the `ERD_ID` shape data first, so a rerun is idempotent, and stamping happens in the same call. Lines are created in later batches by `ERD_ID` lookup, so a batch boundary can fall anywhere.
- **State file gets a `seen` block (§5a).** `baseline` is the common ancestor for the 3-way diff and is set from `ERD.md` after a pull. After a pull that **rejected** an op, Lucid still holds the rejected edit, so a guard of "Lucid vs baseline" would refuse every later push, and §6c step 6 / §9.2.5 require the push to revert it. `seen` is the Lucid doc as it was last pulled or pushed: the guard is `snapshot vs seen`, and the push diffs `ERD.md vs the live snapshot`, so it reverts rejected edits, adopts accepted tables and repairs drift in one pass. `record --push` sets `seen = baseline`; `record --pull` sets `baseline` from `ERD.md` and `seen` from the snapshot.
- **Push never deletes what it does not own.** A table or line in Lucid with no `ERD_ID` that `ERD.md` does not know (for example a rejected new table) is left alone with a warning. Rows on an ERD-owned table are reconciled to `ERD.md`, so a rejected row edit is reverted.
- **Adopt rule applies to the pull as well.** An unstamped table named like an entity in the baseline is that entity until a push stamps it, so a lost stamp is not read as a delete plus an add.
- **`init` and `--dry-run` were added.** `init` writes the document id into `lucid.json` before the first push (§5c step 2); `pull-diff --dry-run` is the skill's dry run (§6c step 3) so no change-set file is written with a placeholder source id.
- **`rerouteLines` can re-attach a line end to another row** (found live: it moved a line's PK end to `ADDRESS`). The runtime now restores each rerouted line's row pins, and the push planner re-pins any line whose primary end is not on the parent's PK row.
- **Header colour follows Kind.** The snapshot carries `headerShading`, and a push repairs a stale colour (a Kind changed in Lucid and accepted is the case).
- **Sizes.** Measured in Lucid: height = 40 px + 32 px per row, about 10 px per character. Columns are widened so no cell wraps; every table is laid out with 200 px of slack, giving >=160 px between tables (checked on the 150-entity model).
- **Active decisions** are read with a small parser for the Index table (`activeDecisions` in `pull.mjs`), because `parseDecisions` returns only statuses, not Affects. A `global` decision is not expanded (it names no element); the apply agent still judges it.
- **Re-proposal rule:** nothing to implement. Every pull is a new S-ID, higher than every earlier one, so a rejected Lucid change is proposed again by design.
- **Snapshot paging** (§6a) was not needed: S4 measured a 50-entity read at <100 ms.
- **Group frames** do not move with tables a person drags out; a new table in an existing group goes to the right of that group's rightmost table and grows the frame to fit.
- The sample baseline has no `## Groups`, so groups were derived. For the live run the scratch `ERD.md` got a `## Groups` table and `Group` bullets (what an `erd-analyst` revise does) before the new table with a Group was accepted.
- **Gate C was simulated by hand.** The live run applied the accepted ops to the scratch `ERD.md` itself, following `erd-analyst` apply mode (Version + 1, Change log row, citations to the new source id), rather than launching the agent.

### Verification

`node --test "tools/*/test/*.test.mjs"`: 101 tests, all green (the existing erd-view and erd-assist tests plus 3 new files for erd-lucid).

Live, in `project-terrarium sync test (delete me)` (https://lucid.app/lucidchart/3e49ca06-c800-4ed4-bfe8-bbe127f51da6/edit, **left for the user to delete**), with a scratch copy of `examples/fixtures/baseline/ERD.md`:

1. **First push:** 14 entities, 18 lines, 3 group frames and the header in one run (33 ops, 0 errors). The PNG export shows no overlaps, no wrapped cells and no lines to a lookup table (`docs/design/erd-lucid/first-push.png`).
2. **Five edits made in Lucid by script** (added row, changed type, deleted line, new table with Group set, Kind changed).
3. **Push refused:** `Lucid has 5 unpulled change(s). Run pull first.`, exit 3.
4. **Pull:** exactly 5 proposed changes (2 additive, 2 modifying, 1 breaking) and a ledger row (S4, `lucid-diagram`). Accepted 4, rejected 1 (the type change); ERD Version 1 to 2 with citations to S4.
5. **Push:** reverted the rejected type, stamped the new table with `ERD_ID E-15`, repaired the stale header colour, created or moved no table. The second pull and a second push both said `Lucid doc matches ERD v2.` This step found the `rerouteLines` pin bug above; it was fixed and re-run live.
6. **Deprecated a field in `ERD.md` (v3):** the push removed the row. The x and y of every table were identical before and after (only the table that lost a row got shorter); all 17 lines stayed on their rows (`docs/design/erd-lucid/after-round-trip.png`).

Not exercised live: a push that creates a brand-new table in a *new* group (covered by unit tests of the plan and by the runtime's code path for frames), and the paired question flow for a conflict (unit-tested only).
