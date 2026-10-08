# Handoff: build the ERD maintain module

You are implementing the **ERD maintain** module of the `project-terrarium` Claude Code plugin.
The full design rationale is in [`erd-maintain.md`](erd-maintain.md). Read it once for context.
**This handoff is the build spec. Where the two differ, this file wins.** Every decision you need
is made below. If you hit a question this file doesn't answer, choose the option most consistent
with the existing `erd-build` module and record it under "Implementation notes" at the end of this
file.

Work on branch `dev`. Commit in logical steps (suggested commit points are marked ✅). Push to
`origin dev` when done. Do not open a pull request.

---

## 1. What this repo is (read before writing anything)

- The repo is a Claude Code plugin made **only of prompts**: Markdown + YAML frontmatter, JSON
  manifests, and YAML config. There is **no application code**, no package manager, and no test
  runner. Don't add any.
- A **skill** (`skills/<name>/SKILL.md`) is a user-invoked command, e.g.
  `/project-terrarium:erd-build`. It runs in the main session as an **orchestrator**:
  - it gathers inputs, launches subagents, verifies their output, and keeps the user in control
    at named gates;
  - it never authors the ERD itself and never commits.
- **Agents** (`agents/<role>.md`) are subagents. Their prompt sections always come in this order:
  **Inputs (given in your prompt)**, **How to work** (per `mode`), **Principles**, **Final message**.
- **References** (`skills/<name>/references/*.md`) are contracts and checklists. The orchestrator
  resolves them to absolute paths and passes those paths to agents.

Read these files in full before you start. Match their tone, density and structure exactly:

| File | Why |
|---|---|
| `skills/erd-build/SKILL.md` | The orchestrator pattern to copy for `erd-maintain` |
| `skills/erd-build/references/erd-format.md` | The ERD contract you will extend |
| `skills/erd-build/references/source-gathering.md` | Source discovery/staging you will extend |
| `skills/erd-build/references/review-format.md` | The review contract (small change) |
| `agents/erd-analyst.md` | Gets two new modes |
| `agents/appian-erd-reviewer.md` | Gets a delta scope |
| `skills/setup/SKILL.md` | Config template you will extend |
| `README.md`, `.claude-plugin/plugin.json` | Docs and version |
| `examples/sample-project/**`, `examples/fixtures/**` | Test fixtures you will extend |

### House style

- Plain, imperative English; short sentences. Use **bold** for key rules.
- Name tools in backticks (`outlook_calendar_search`).
- Every guardrail from erd-build carries over unchanged:
  - Microsoft 365 access is read-only.
  - Staged text stays git-ignored.
  - No PII/PHI values in outputs.
  - The ERD describes fields, never values.
  - The orchestrator never commits.

---

## 2. Locked decisions

### 2.1 Source ledger: `<erd_dir>/sources.md`

A committed file holding the **global, append-only** source registry. It replaces "source IDs
restart at S1 each run". Both `erd-build` and `erd-maintain` read and write it.

```markdown
# Source ledger

Global source registry for this ERD. IDs are permanent and never reused. Metadata only — no source content.

| ID | Kind | Title | Date | Location | Fingerprint | Ingested | Staged file | Status |
|---|---|---|---|---|---|---|---|---|
| S1 | context-md | Glossary | — | docs/context/glossary.md | git:3f2a9c1 | 2026-10-01 | (in repo) | active |
| S2 | transcript | Data workshop | 2026-09-15 | meeting-transcript:///events/… | event:AAMk…@2026-09-15T14:00Z | 2026-10-01 | S2-data-workshop.md | active |
| S5 | slide-deck | Provider design review v2 | 2026-10-05 | file:///…/Provider%20review.pptx | mod:2026-10-05T16:22Z | 2026-10-08 | S5-provider-design-review.md | active |
| S4 | slide-deck | Provider design review v1 | 2026-10-02 | file:///…/Provider%20review.pptx | mod:2026-10-02T09:10Z | 2026-10-03 | S4-provider-design-review.md | superseded by S5 |
```

- **Kind:** `context-md` | `transcript` | `slide-deck` | `sharepoint-doc` | `local-file`.
- **Fingerprint** (a prefix tells you how it was computed):
  - `git:<blob>` for in-repo files: `git hash-object <path>`, first 7 characters.
  - `event:<eventId>@<occurrenceStart>` for Teams transcripts.
  - `mod:<lastModifiedDateTime>` for SharePoint items (from the search hit or `read_resource`).
  - `sha256:<first 12 hex>` for local files: `sha256sum`.
- **Ingested:** the `RUN` date that first staged this version of the source.
- **Staged file:** relative to `<staging_dir>/<Ingested>/`, or `(in repo)` for context MDs.
- **Status:** `active` | `superseded by S<m>`.
- **Rows are ordered by ID.** The table above is out of order only to show the supersede row; in
  the real ledger, sort strictly by ID.
- **Matching:** a source is *known* if its **Location** is already in the ledger. If its
  Fingerprint matches the active row, it is unchanged. If the Fingerprint differs, it is *changed*:
  it gets a new ID, and the old row becomes `superseded by S<new>`.
- **IDs are never reused**, even when a source is superseded. Old citations to a superseded ID stay
  valid and keep resolving.
- **Never** put attendee names, content excerpts or staged text in the ledger.

The per-run `<staging_dir>/<RUN>/sources-manifest.md` still exists. It becomes "what was staged
this run" and uses the **global** IDs. The ledger is what citations resolve against.

### 2.2 Citation forms (`erd-format.md`)

| Form | Used for |
|---|---|
| `[S<n> @HH:MM:SS]` | transcript (unchanged) |
| `[S<n> §Section]` | document (unchanged) |
| `[S<n> slide <k>]` | **new**: slide deck, 1-based slide number |
| `ASSUMPTION` / `CONVENTION` | unchanged |

### 2.3 Deprecation (nothing is ever deleted)

- **Entity:** keep its section. Add the bullet `- **Status:** Deprecated in v<n>: <reason> [cite]`
  under Sources. Remove it from the Mermaid diagram. Add a bullet to *Out of scope / deferred*.
- **Field:** keep the row. Set Req to `—` and prefix the Description with `DEPRECATED v<n>:`.
  Remove it from the Mermaid entity block.
- **Relationship:** keep the row. Prefix its Description with `DEPRECATED v<n>:`. Remove it from
  Mermaid.
- **Assumption confirmed by a source:** keep the `A-n` row. Append ` — confirmed [S<n> …] v<n>`
  to *Why*. Replace `ASSUMPTION` with the source citation on the affected elements.
- **Question resolved:** keep the `Q-n` row. Append ` — **Resolved v<n>:** <answer> [S<n> …]` to
  the Question cell.

### 2.4 New ERD section: Change log

Add it after *Review responses* in `erd-format.md`:

```markdown
## Change log
| Version | Date | Change set | Summary |
|---|---|---|---|
| 3 | 2026-10-08 | changes/2026-10-08-changeset.md (CS-1–CS-9; 7 accepted) | +E-12 Provider Capacity; authorizedHours → Decimal; Q-2 resolved |
```

- Every write by `apply` mode adds one row.
- `build` mode adds a row with Change set `full build`. `revise` mode adds a row with
  Change set `review <file>`.

The header row `Sources` changes to: `` See `sources.md` (S1–S<n>) ``.

### 2.5 Change-set contract: `<erd_dir>/changes/<RUN>-changeset.md` (committed)

This becomes `skills/erd-maintain/references/changeset-format.md`. Write it in the same style as
`erd-format.md` (intro paragraph, Rules, then a fenced example document).

````markdown
# ERD change set: <RUN>

| | |
|---|---|
| Base ERD version | <n> |
| New sources | S<a>–S<b> (see `sources.md`) |
| Proposed | <n> additive · <n> modifying · <n> breaking · <n> conflict |
| Decided | <YYYY-MM-DD or "pending"> |

## Summary
2–4 sentences on what the new sources change.

## Proposed changes
| ID | Class | Op | Target | Change | Evidence | Supersedes | Confidence | Decision |
|---|---|---|---|---|---|---|---|---|
| CS-1 | additive | add-entity | E-new-1 CCA Provider Capacity (`CCA_PROVIDER_CAPACITY`) | Licensed slots per provider per age group; fields: providerId FK→E-6, ageGroupId FK→E-new-2, licensedSlots Integer | [S5 slide 4] | — | High | pending |
| CS-2 | modifying | modify-field | E-8.authorizedHoursPerWeek | Type Integer → Decimal(5,2) | [S4 @00:03:10] | [S3 @00:06:30] | High | pending |
| CS-3 | conflict | modify-relationship | R-7 | … | [S4 @00:05:02] | [S3 @00:05:12] | Medium | pending |
| CS-4 | additive | raise-question | Q-new-1 | Slide 6 shows a legacy data model image not extracted; confirm whether it adds entities | [S5 slide 6] | — | — | pending |

## Field detail
(One `### CS-n` block for each add-entity, giving the full field table in erd-format columns. Omit this section if there are none.)

## Not proposed
Bullets for content in the new sources that was deliberately not turned into ops (already modeled, out of scope, or a previously rejected op with no new evidence: name the CS ID and file).
````

**Rules for the contract:**

- **Ops:** `add-entity`, `add-field`, `add-relationship`, `modify-field`, `modify-relationship`,
  `rename`, `deprecate`, `add-citation`, `confirm-assumption`, `resolve-question`,
  `raise-question`.
- **Class:**
  - `additive`: `add-*`, `add-citation`, `raise-question`, `confirm-assumption`.
  - `modifying`: `modify-field` (Type/Req/Description only), `resolve-question`, and
    description-only changes to relationships.
  - `breaking`: `rename`; `deprecate`; any change to Key or FK; any cardinality change.
  - `conflict`: any op whose Evidence contradicts an existing citation. **Conflict overrides the
    other classes.**
- **Target:** existing stable IDs, written as `E-3`, `E-3.fieldName`, `R-5`, `A-2` or `Q-1`. New
  elements get provisional IDs `E-new-<k>`, `R-new-<k>`, `A-new-<k>`, `Q-new-<k>`; `apply` mode
  replaces them with the next free IDs.
- **Supersedes:** the existing citation(s) the change overrides. It is **required** for
  `modifying`, `breaking` and `conflict` ops.
- **Conflict ops** follow the existing rule: the latest stated decision wins, and DHS/state
  stakeholders win over vendor speculation. Every conflict op is paired with a `raise-question`
  op that cites both sides, so the user can choose "ask instead of change".
- **Batching:** many `add-citation` ops may be combined into one row whose Target lists several
  IDs. This keeps the table readable.
- **Decision column:** `pending` | `accepted` | `rejected: <reason>`. Only the orchestrator
  writes it, at Gate C.
- **Re-proposal rule:** before proposing, read every prior file in `<erd_dir>/changes/`. Don't
  re-propose an op that was `rejected` unless the new Evidence comes from a source ID **higher**
  than every ID in the rejected op's Evidence. If you skip one, list it under *Not proposed*.
- **No PII/PHI values**, same as the ERD.

### 2.6 Config additions (`project-terrarium.yaml`)

```yaml
sharepoint:
  deck_folders: []          # optional: folders where slide decks are uploaded (narrows pptx/pdf search)

maintain:
  lookback_days: 3          # overlap before the ledger watermark when searching remote sources
  auto_accept: []           # change-set classes accepted without asking, e.g. [additive]
```

Missing keys use these defaults. Nothing may fail because a key is absent.

### 2.7 Out of scope for this build (don't implement)

- Audio/video transcription.
- OCR of image-only slides.
- Scheduled or automatic triggering.
- Lucid export.
- Any code or scripts committed to the repo.

---

## 3. Tasks

### Task 1: Extend shared contracts ✅ commit "Add source ledger, slide citations and change log to ERD contracts"

**`skills/erd-build/references/erd-format.md`**
- Rules: citations resolve against `sources.md`, not the run manifest. Add the citation-form table
  (2.2).
- Add a rule "Never delete; deprecate" pointing to a new **Deprecation** subsection (copy 2.3).
- Header `Sources` row per 2.4.
- Add the `## Change log` section (2.4) to the document-structure example, after Review responses.
- Intro sentence: "future maintenance runs diff against it" becomes "`erd-maintain` diffs new
  sources against it and edits it only through accepted change sets".

**`skills/erd-build/references/source-gathering.md`**
- §3 SharePoint: add a **Slide decks** paragraph:
  - `sharepoint_search` with `fileType: "pptx"`, then `"pdf"`, using the content queries from
    `doc_queries` plus the project name, narrowed with `folderName` from
    `sharepoint.deck_folders`;
  - read the hits with `read_resource`, following the `startPage` hints.
- §4 Local fallback: `.pptx` files under `local_inputs` are extracted with `python-pptx`, run
  through Bash with `python3 -I`. If it's unavailable, fall back to `markitdown`. If neither
  works, ask the user to export to PDF. Include the extraction snippet inline in the reference;
  don't commit a script:
  - for each slide, print `## Slide <k>: <title placeholder text or "(untitled)">`;
  - then all text frames and table cells;
  - then `**Notes:** <notes text>`.
- §6 Stage: add the slide-deck staged format (one `## Slide <k>: <title>` section per slide, body,
  tables, then speaker notes). A slide whose text is under ~15 words **and** that has a
  picture/graphic shape gets the line `[visual content not extracted]`.
- Replace "Source IDs restart at S1 for each run" with a **Source ledger** section:
  - allocate IDs from `<erd_dir>/sources.md` using the matching rules in 2.1, and paste the 2.1
    ledger format;
  - after staging, append and update the ledger rows;
  - the run manifest lists the same global IDs;
  - if no ledger exists and no `ERD.md` exists, start at S1 and create the ledger.
- Add `slide-deck` to the manifest example.

**`skills/erd-build/references/review-format.md`**
- Add the header row `| Scope | full / delta: <changed IDs> |` after Round.

### Task 2: Update the existing build path ✅ commit "Make erd-build use the global source ledger"

**`skills/erd-build/SKILL.md`**
- Step 2: allocate IDs from the ledger and write the ledger after staging.
- **Migration** (new sub-step), for when `ERD.md` exists but `sources.md` doesn't:
  - find the newest `<staging_dir>/*/sources-manifest.md` and import its rows into the ledger
    (Ingested = that folder's date; compute Fingerprints where possible, otherwise `unknown`);
  - if no manifest exists, warn that the existing citations can't be resolved, and ask the user
    whether to proceed with a full rebuild (citations will be regenerated).
- Step 3: the citation check resolves against the ledger. Pass `ledger_path` to the analyst.
- Step 4: pass `ledger_path` (instead of `manifest_path`) and `scope: full` to the reviewer.
- Step 6: list `sources.md` among the files written.

**`agents/erd-analyst.md`**
- Inputs: add `ledger_path`. Add `maintain` and `apply` to `mode`, with their extra inputs (see
  Task 3).
- Build step 5: on an existing ERD, also add a Change log row (`full build`). Revise step 3: add a
  Change log row.
- Update the frontmatter `description` to mention the maintain and apply modes.

**`agents/appian-erd-reviewer.md`**
- Inputs: `manifest_path` becomes `ledger_path` ("the global `sources.md`; resolve
  `<staging_dir>/<Ingested>/<Staged file>` to read a source"). Pass `staging_dir`.
- Add `scope`: `full` (default) or `delta`, plus `changed_ids` and `change_set_path`.
- How to work, new step: in **delta** scope, walk the checklist only for `changed_ids` and every
  entity linked to them by a relationship. **If the change set has any accepted `breaking` or
  `conflict` op, review in full anyway.** Put the scope in the review's Scope row.

### Task 3: Analyst maintain and apply modes ✅ commit "Add maintain and apply modes to erd-analyst"

In `agents/erd-analyst.md`, add two sections in the same style as the existing build and revise
sections.

**How to work: maintain mode** (extra inputs: `change_set_path` to write, `changeset_spec`, `new_source_ids`, `changes_dir`)
1. Read `format_spec`, `changeset_spec`, the current `ERD.md` in full, and the ledger.
2. Read every prior change set in `changes_dir` and note the rejected ops.
3. Read **only** the staged files for `new_source_ids`, plus glossary/context files for
   vocabulary. Never re-read old sources to look for new requirements; open an old source only to
   check a citation listed in *Supersedes*.
4. For each requirement signal in the new sources, compare it with the current model and classify
   it:
   - already modeled the same way → `add-citation`;
   - new → `add-*`;
   - differs → `modify-*`, `rename` or `deprecate`, with the old citation in *Supersedes*;
   - contradicts → `conflict` plus a paired `raise-question`;
   - answers a `Q-n` → `resolve-question`;
   - supports an `A-n` → `confirm-assumption`;
   - visual content not extracted → `raise-question`.
5. Apply the re-proposal rule.
6. Write the change set exactly per `changeset_spec`, with every Decision `pending`. **Don't edit
   `ERD.md` in this mode.**
7. Self-check:
   - every op has Evidence from `new_source_ids`;
   - every modifying, breaking or conflict op has Supersedes;
   - every Target ID exists in `ERD.md` or is provisional;
   - no PII/PHI.

**How to work: apply mode** (extra inputs: `change_set_path` with Decisions filled)
1. Read `format_spec`, the change set and `ERD.md`.
2. Apply **only** the `accepted` ops, in CS order:
   - replace provisional IDs with the next free IDs, and rewrite them everywhere in the ERD (and in
     the change set's Target cells, as `E-new-1 → E-12`);
   - follow the deprecation rules in 2.3;
   - update the Mermaid diagram so it matches the tables;
   - update Summary only if the core entities changed.
3. Increment Version, set Last updated, update the header Sources range, set Status to `Draft`, and
   add a Change log row.
4. Run the build-mode self-check, plus these extra checks:
   - every ID present before still exists;
   - every accepted op's final Target ID appears in the ERD;
   - no rejected op's change is present.

**Final message:** add one line per mode. For maintain: counts by class, plus the 3 most
consequential ops. For apply: the new version, plus the provisional → final ID map.

### Task 4: The erd-maintain skill ✅ commit "Add erd-maintain skill"

Create `skills/erd-maintain/SKILL.md`. Copy the structure and voice of `erd-build/SKILL.md`.

```yaml
---
name: erd-maintain
description: Incrementally update the project's existing ERD from sources added since the last run — new Teams meeting transcripts, uploaded slide decks, and SharePoint docs. Proposes a change set (additive / modifying / breaking / conflict) for the user to accept or reject, applies only accepted changes with stable IDs, then runs a delta Appian review. Use when the user wants to update, refresh, maintain, or sync the ERD with new meetings or decks.
argument-hint: "[since:<YYYY-MM-DD>] [meeting/topic filter]"
---
```

The skill's steps:

1. **Load configuration.** Do the same as erd-build Step 1, plus `sharepoint.deck_folders` and
   `maintain.*` with defaults.
   - If `<erd_dir>/ERD.md` doesn't exist, stop and tell the user to run `erd-build` first.
   - If the ledger is missing, run the migration from Task 2.
   - Resolve the references to absolute paths: `erd-format.md`, `source-gathering.md`,
     `appian-risk-checklist.md` and `review-format.md` from `../erd-build/references/`;
     `changeset-format.md` and `delta-discovery.md` from this skill's own `references/`.
2. **Discover** per `references/delta-discovery.md`, then **Gate A** with a table of new and
   changed candidates only. Known sources aren't shown; just give a count.
   - If nothing is new: report "ERD v<n> is current as of <watermark>; nothing new found", list any
     "Not included" items (e.g. meetings without transcripts), and **stop without writing
     anything**.
3. **Stage** the confirmed sources per `source-gathering.md` §6 and update the ledger.
4. **Propose:** run `erd-analyst` with `mode: maintain`. Verify that the change set exists, its
   Evidence IDs are all in `new_source_ids`, and every Target exists or is provisional. If any of
   this fails, send it back once.
5. **Gate C:**
   - Summarize by class: one line per op, with conflicts listing both sides.
   - Pre-accept the classes in `maintain.auto_accept`.
   - Suggest accepting additive ops; modifying, breaking and conflict ops need an explicit choice.
   - Accept replies like `accept all`, `accept additive`, `accept CS-1,CS-4`,
     `reject CS-7: <reason>`.
   - For a conflict op, the user can pick its paired `raise-question` instead.
   - Write the Decision column and the `Decided` date into the change set yourself. This, plus the
     Status line, is all the orchestrator itself edits.
   - If nothing is accepted, stop: the change set (all rejected) and the ledger are the only
     outputs.
6. **Apply:** run `erd-analyst` with `mode: apply`. Verify:
   - the required sections are present;
   - all citations resolve against the ledger;
   - the version went up by exactly 1;
   - no pre-existing `E-/R-/A-/Q-` ID has disappeared (diff the ID set from before the run);
   - the Change log row is present.

   If any check fails, send it back once.
7. **Delta review:** run `appian-erd-reviewer` with `scope: delta`, `changed_ids` and
   `change_set_path`. Save the review to `<erd_dir>/reviews/<RUN>-appian-review.md` (if that file
   exists from a same-day build, use `<RUN>-maintain-review.md`). Set Status, then run **Gate B**
   exactly as in erd-build (revise round, max 2 rounds).
8. **Finish:** report the files written (ERD, change set, ledger, review), the staging path, the
   still-open questions, and the "Not included" sources. Don't commit.

Repeat erd-build's guardrails, and add one: **change sets and the ledger are committed files;
they must never contain source text.**

### Task 5: Delta discovery reference ✅ (same commit as Task 4)

Create `skills/erd-maintain/references/delta-discovery.md`, in the style of
`source-gathering.md`. It defers to that file for *how* to read each kind, and defines *what
counts as new*.

- **Watermark:** the newest `Ingested` date in the ledger, minus `maintain.lookback_days`.
  A `since:<date>` argument overrides it.
- **Scope of each search:**
  - **Meetings:** `outlook_calendar_search` per `meeting_series` with
    `afterDateTime = watermark`.
  - **Decks:** `sharepoint_search` with `fileType` `pptx`/`pdf`, narrowed by `deck_folders`.
    Keep a hit if its `lastModifiedDateTime` ≥ watermark.
  - **Docs:** the `doc_queries` searches, filtered by the same date.
  - **Local inputs:** **all** files under `local_inputs`, no date filter (they're classified by
    fingerprint).
  - **Context MDs:** all `context_paths` matches (classified by `git:` fingerprint).
- **Classification:** compare each hit with the ledger using the 2.1 rules, giving *new*,
  *changed* or *known*. Show new and changed hits at Gate A; drop known hits silently.
- **Recordings:**
  - A calendar event with no `meetingTranscriptUrl` goes under "Not included: no transcript;
    enable Teams transcription or drop a `.vtt` in `<local_inputs>`".
  - So do `.mp4`/`.m4a` files found by search or in `local_inputs`.
  - Never try to transcribe audio.
- **Nothing new:** this is a successful run that writes nothing.

### Task 6: Change-set contract ✅ (same commit as Task 4)

Create `skills/erd-maintain/references/changeset-format.md` from 2.5.

### Task 7: Setup, README, manifest ✅ commit "Document erd-maintain; config and version bump"

- **`skills/setup/SKILL.md`:**
  - add question 6b, "Where are slide decks uploaded? (folder names, optional)";
  - add the 2.6 keys to the YAML template;
  - create `<erd_dir>/changes/` alongside `reviews/`;
  - in the final line, mention `/project-terrarium:erd-maintain` for later updates.
- **`README.md`:**
  - module table row: `| ERD maintain | /project-terrarium:erd-maintain | v0.2 |`; set
    ERD build to v0.2 too;
  - add an "ERD maintain workflow" section with a small ASCII flow in the style of the existing
    one (discover → Gate A → stage → analyst maintain → change set → Gate C → analyst apply →
    delta review → Gate B);
  - explain that `sources.md` and `changes/` are committed and that staging is not;
  - add a "Develop / test" bullet for the maintain fixtures (Task 8).
- **`.claude-plugin/plugin.json`:** set version to `0.2.0`, and update the description to
  mention the maintain module.

### Task 8: Fixtures ✅ commit "Add erd-maintain test fixtures"

All data must be **synthetic**. Use the sample project's domain (child care assistance, prefix
`CCA`, Oracle). Read the existing transcript
`examples/sample-project/transcripts/2026-09-15-data-workshop.vtt` first.

1. **`examples/fixtures/baseline/ERD.md`**: a clean, correct v1 ERD built from the three existing
   sample sources. It follows the **new** format (ledger header, Change log row
   `1 | 2026-09-20 | full build | …`). At minimum it has:
   - Household, Household Member, Application, Income, Case, Child, Provider, Authorization (with
     authorizedHoursPerWeek **Integer**), Authorization History, Case Note, and the needed
     reference tables;
   - a Child–Provider authorization relationship that allows **multiple concurrent providers**;
   - `Q-1` asking whether co-payment is per case or per authorization (from @00:10:20).

   It is the "before" state for testing. This path isn't git-ignored; the sample project's
   `erd/ERD.md` is.
2. **`examples/fixtures/baseline/sources.md`**: the ledger for S1–S3 (glossary, program
   overview, 2026-09-15 transcript), Ingested `2026-09-20`, with `git:` fingerprints computed from
   the real files.
3. **`examples/sample-project/transcripts/2026-10-01-provider-followup.vtt`**: a short WebVTT
   file, about 6 cues, in the same speaker style. It must contain:
   - **(a)** authorized hours can be half-hours (→ `modifying` Integer→Decimal);
   - **(b)** the state decides co-payment is **per authorization** (→ `resolve-question` Q-1, plus
     a co-payment field);
   - **(c)** a County Lead saying policy now allows **only one active provider per child at a
     time** (→ `conflict` with @00:05:12);
   - **(d)** something already modeled, restated (→ `add-citation`).
4. **`examples/sample-project/transcripts/2026-10-05-provider-design-review.pptx`**: generate it
   with `python-pptx` through a one-off Bash command. Don't commit the generator. It has 5
   slides:
   1. title;
   2. "Provider capacity": licensed slots per provider per age group (infant / toddler /
      preschool / school-age) → `add-entity` plus a reference table;
   3. "Provider contact": a provider email field → `add-field`;
   4. a slide with only a title "Legacy model (from MEC²)" and a **picture** (any small generated
      PNG) → `[visual content not extracted]` → `raise-question`;
   5. speaker notes stating that provider license number must be unique → `modify-field`
      Key → UK, which is `breaking`.
5. **`examples/fixtures/maintain-expected.md`**: a short checklist of the ops a correct maintain
   run should propose from items 3 and 4 (class + op + target), for manual comparison. Put an
   HTML comment header like `flawed-ERD.md` uses.
6. Update `README.md` Develop / test with a recipe:
   - copy `examples/fixtures/baseline/{ERD.md,sources.md}` into `examples/sample-project/erd/`;
   - run `claude --plugin-dir ../..` from the sample project;
   - run `/project-terrarium:erd-maintain`;
   - compare the result with `maintain-expected.md`.
7. Update the root `.gitignore` so the sample project's `erd/sources.md` and `erd/changes/` are
   ignored too (they're run outputs there, like `erd/ERD.md`).

---

## 4. Verification (do all of these before the final push)

You can't run the plugin end-to-end in an automated way. Verify statically and with the
commands below, then report honestly what you did and didn't verify.

1. `claude plugin validate .` passes. If the `claude` CLI isn't available, say so; don't skip
   silently.
2. **Consistency greps.** Each must return nothing, or only intended hits:
   - `grep -rn "restart at S1" skills agents`: should be gone.
   - `grep -rn "manifest_path" skills agents`: should be replaced by `ledger_path`.
   - `grep -rn "slide <k>" skills`: present in erd-format, source-gathering and
     changeset-format.
   - Every op name and class in `changeset-format.md` matches the ones used in `erd-analyst.md`
     and `erd-maintain/SKILL.md`. Write a one-off grep comparison.
3. **Fixture checks:**
   - Every `[S<n>` citation in `examples/fixtures/baseline/ERD.md` resolves to a row in
     `baseline/sources.md`.
   - Every FK in it points to an existing entity.
   - Its Mermaid entity names equal its table names.
   - No Oracle table or column name is longer than 30 characters.
   - The `.pptx` opens with `python3 -I -c "import pptx; …"` and yields 5 slides, slide 5 has
     notes, and slide 4 contains a picture shape.
   - The `.vtt` is valid WebVTT (header, and cue timings increase).
4. **Read-through.** Read `skills/erd-maintain/SKILL.md` top to bottom as if you were the
   orchestrator on the fixture scenario. Each step must name the exact inputs it passes to each
   agent, and those inputs must match the agent's **Inputs** section.
5. **Self-review the diff:**
   - existing erd-build behaviour is unchanged except for the ledger;
   - no PII-like sample values (realistic SSNs, real names) are in committed files;
   - section order in agent files is preserved.

## 5. Definition of done

- Tasks 1–8 are committed on `dev` and pushed to `origin dev`.
- The verification in §4 was run, and the results are summarized in your final message, including
  anything you couldn't verify.
- Any decision you had to make beyond this spec is listed under "Implementation notes" below.

## Implementation notes

(Builder: record decisions not covered above here.)
