# Handoff: build the ERD assist module and the Technical Decisions log

You are implementing the **ERD assist** module of the `project-terrarium` Claude Code plugin. It adds an
interactive assistant for iterating on the ERD after a build or maintain run, plus a committed, binding
**Technical Decisions** log. **This handoff is the build spec.** Every decision you need is made below. If you hit a
question this file doesn't answer, choose the option most consistent with the existing `erd-build` /
`erd-maintain` modules and record it under "Implementation notes" at the end of this file.

Work on branch `dev`. First run `git pull origin dev`. The base must include `erd-maintain`, `erd-view` and the
SharePoint transcript change (`c27c0d8` or later). Commit in logical steps (suggested commit points are marked ✅).
Push to `origin dev` when done. Do not open a pull request.

---

## 1. Problem and goal

The flow is: `erd-build` or `erd-maintain` updates `erd/ERD.md`, then `erd-view` renders the readable view
(`ERD.html`). After that, the user wants to **iterate with an assistant** that:

1. **discusses recent changes** to the ERD: what the last run changed, why, what's open;
2. **makes a change when told to**, editing `ERD.md` correctly per the contract;
3. **records Technical Decisions** in an MD file that build and maintain read and **must not overwrite**.

**Performance and context management are first-class requirements.** The ERD and the decisions log grow without
bound. The assistant must not read the whole ERD, every change set, or the whole decisions log when a slice
answers the question. Other agents must be able to honour every active decision by reading about one line per decision.

### Decisions made with the user (don't revisit)

| Topic | Decision |
|---|---|
| Where decisions live | **One file**, `<erd_dir>/DECISIONS.md`, with a compact **Index** table at the top and full blocks below |
| Who edits `ERD.md` in assist | **The assistant itself**, with targeted `Edit` calls, running in the user's main session. No delegation to `erd-analyst` |
| Relation to build/maintain | Build, revise, maintain and apply all **read and respect** active decisions. A contradicting source never silently overrides one |
| Decision ID prefix | **`DEC-<n>`**. Not `TD-`: the repo already uses `TD-1` for tech-debt items, and the ERD uses `E-`/`R-`/`A-`/`Q-`, change sets `CS-`, reviews `F-` |

---

## 2. What this repo is (read before writing anything)

- A Claude Code plugin made mostly of prompts. **Skills** (`skills/<name>/SKILL.md`) are user-invoked commands that
  run in the main session. **Agents** (`agents/<role>.md`) are subagents whose sections come in order: Inputs, How to work
  (per `mode`), Principles, Final message. **References** (`skills/<name>/references/*.md`) are contracts passed as
  absolute paths.
- Since `erd-view`, the repo also has **zero-dependency Node 18+ tools** under `tools/` with `node:test` tests. You add
  one small tool in the same style. No package manager, no dependencies.

Read these in full before you start, and match their tone, density and structure:

| File | Why |
|---|---|
| `skills/erd-maintain/SKILL.md` | Orchestrator style, gates, verification checks |
| `skills/erd-view/SKILL.md` | How a skill resolves the plugin root and runs a Node tool |
| `skills/erd-build/SKILL.md` | Gets the decisions input and a verification check |
| `skills/erd-build/references/erd-format.md` | The ERD contract you extend (citations, rules, Change log) |
| `skills/erd-maintain/references/changeset-format.md` | Op vocabulary the assistant reuses; gets a DEC conflict rule |
| `agents/erd-analyst.md` | Gets a `decisions_path` input and constraints in every mode |
| `agents/appian-erd-reviewer.md` | Gets a `decisions_path` input |
| `tools/erd-view/lib/parse.mjs`, `tools/erd-view/erd-view.mjs`, `tools/erd-view/test/*` | Parser to reuse; CLI and test style to copy |
| `skills/setup/SKILL.md`, `README.md`, `.claude-plugin/plugin.json` | Docs and version |
| `examples/fixtures/baseline/*`, `examples/fixtures/maintain-expected.md` | Fixtures you extend |

### House style
Plain, imperative English; short sentences; **bold** for key rules; tools in backticks. All existing guardrails carry
over: no PII/PHI values anywhere, staged text stays git-ignored, Microsoft 365 is read-only, nothing commits.

---

## 3. Locked design

### 3.1 The decisions log: `<erd_dir>/DECISIONS.md` (committed)

The contract lives in **`skills/erd-assist/references/decisions-format.md`** (new). Write it with this exact structure:

````markdown
# Technical decisions

Binding design decisions for this ERD. Build, maintain and review runs must respect every **Active** row.
IDs are permanent and never reused. No PII/PHI, no source text.

| | |
|---|---|
| Last ID | DEC-4 |
| Active | 3 |
| Last updated | 2026-10-09 |

## Index
| ID | Date | Status | Affects | Rule |
|---|---|---|---|---|
| DEC-4 | 2026-10-09 | Active | E-11.authorizedHoursPerWeek | Store authorized hours as Decimal(5,2), never Integer |
| DEC-3 | 2026-10-06 | Active | global | Don't model provider payment history in this release; defer to the payments ERD |
| DEC-2 | 2026-10-04 | Superseded by DEC-4 | E-11.authorizedHoursPerWeek | Store authorized hours as Integer |
| DEC-1 | 2026-10-02 | Active | E-3 R-4 | A case participant belongs to exactly one case; no shared participants |

## Decisions

### DEC-4 Authorized hours are decimal
- **Status:** Active
- **Date:** 2026-10-09
- **Affects:** E-11.authorizedHoursPerWeek
- **Supersedes:** DEC-2
- **Origin:** assist session (resolves Q-3)
- **ERD version:** 5
- **Decision:** Store authorized hours as Decimal(5,2), never Integer.
- **Rationale:** Half-hour authorizations are common; the eligibility worksheet uses quarter hours.
- **Alternatives rejected:** Integer minutes (unreadable in reports).
````

Rules for the contract (write them into `decisions-format.md`):

- **The Index Rule cell is the binding text.** One line, imperative, self-contained. Other agents read **only the
  Index**. The block holds the rationale and is read only when needed.
- **Index rows are newest first**, so `head_limit` keeps the most recent.
- **Status** is one of: `Active`, `Superseded by DEC-<m>`, `Superseded by CS-<n> (<changeset file>)`, `Revoked: <reason>`.
  The Index Status is authoritative. Keep the block's Status line in sync.
- **Affects** holds space-separated exact stable IDs: `E-n`, `E-n.fieldName`, `R-n`, `A-n`, `Q-n`, `Group:<name>`,
  `LOOKUP:<TYPE>`, or `global` (a modelling policy with no single target). Provisional IDs are never used.
- **Append-only. Never delete, never renumber, never rewrite a Rule.** To change a decision, add a new DEC that
  supersedes it, and set the old row's Status.
- **One DEC per distinct decision**, not per edit. A decision may change nothing in the ERD (for example "don't model X").
- **Origin** is one of `assist session`, `Q-n`, `F-n (<review file>)`, `CS-n (<changeset file>)`, optionally with a
  short parenthetical.
- **Size management:** when the Index passes 300 rows, move the blocks of non-Active decisions to
  `<erd_dir>/decisions/archive-<YYYY>.md` (same block format). Their Index rows stay, so every ID still resolves.
- **No PII/PHI values. No source text** beyond a short paraphrase.

**Canonical reads.** Put these in the contract, and use them verbatim in every skill and agent:

| Need | Read |
|---|---|
| All active rules | `Grep` pattern `^\| DEC-[0-9]+ \|[^|]*\| Active \|` on `DECISIONS.md` |
| Decisions touching an element | `Grep` pattern `^\| DEC-.*\bE-11\b` (the ID, word-bounded) |
| One decision in full | `Grep` pattern `^### DEC-4 ` with `-A 12` |
| Next free ID | the header's `Last ID` row |

If `DECISIONS.md` doesn't exist, every reader treats it as empty. **A missing file never fails a run.**

### 3.2 ERD contract changes (`skills/erd-build/references/erd-format.md`)

1. **Citation forms table:** add a row: `` `[DEC-<n>]` `` → "an element set by a Technical Decision in `DECISIONS.md`".
   It is a real citation, not an `ASSUMPTION`. An element may carry both source and DEC citations.
2. **Rules:** add a bullet after *Stable IDs*:
   > **Technical Decisions bind.** An **Active** decision in `DECISIONS.md` (next to `ERD.md`) overrides sources and
   > conventions for the elements in its Affects (and, for `global`, for the modelling policy it states). Never revert
   > or drop a `[DEC-n]`-cited element. A newer source that contradicts an active decision becomes an open question
   > (build, revise) or a `conflict` op with `Supersedes [DEC-n]` (maintain), never a silent change.
3. **Change log note:** add `erd-assist` writes Change set `assist DEC-<a>–DEC-<b>` (or `assist (no decision)` for
   pure corrections such as a typo or a Mermaid sync).
4. Update the opening paragraph's list of writers to include `erd-assist` (targeted edits) and mention `DECISIONS.md`.

### 3.3 The assistant: `skills/erd-assist/SKILL.md` (new)

Frontmatter:
```yaml
name: erd-assist
description: Iterate on the project's ERD after a build or maintain run. Briefs you on recent changes, discusses entities and relationships, makes the changes you ask for directly in ERD.md, and records each design decision in the binding Technical Decisions log (DECISIONS.md) that later build and maintain runs respect. Use when the user wants to discuss, question, tweak, correct, or decide something about the existing ERD, or asks what changed.
argument-hint: "[topic or ID, e.g. E-11 or 'provider capacity']"
```

**It runs in the main session; there is no new agent.** A subagent can't hold a conversation, and delegating every edit
was rejected as too slow. The skill gives the session the `erd-analyst` persona (one sentence: senior developer and
business analyst, public-sector human services, Appian data modelling) plus the rules below.

The skill has these sections, in this order:

**Context budget (put this near the top, in bold, as rules)**
- **Never `Read` `ERD.md` in full.** Use `erd-slice` (§3.4) for outlines and slices, `Grep` for single rows, and
  `Read` with `offset`/`limit` only on line ranges `erd-slice` reported.
- **Never read the whole `DECISIONS.md`.** Use the canonical reads (§3.1).
- **Never read staged source text** unless the user asks to check a specific citation. Then read only around that
  locator.
- **Change sets and reviews:** read the header and the rows you need (`Grep`), not the file.
- **Re-slice after each edit** instead of re-reading. Don't re-load what's still current in the conversation.

**Step 1: Load (at most about 6 tool calls)**
1. Read `project-terrarium.yaml` and resolve `outputs.erd_dir` (default `erd`). If `<erd_dir>/ERD.md` is missing, stop and
   point to `/project-terrarium:erd-build`. Resolve the plugin root as `erd-view` does.
2. `node <plugin-root>/tools/erd-assist/erd-slice.mjs <erd_dir>/ERD.md --outline --log 3`
3. The active-rules read on `DECISIONS.md` (if present).
4. **Recent changes**, from the latest Change log row:
   - if it names a change set: `Grep` its header table and the `accepted` rows of *Proposed changes*;
   - if it names a review (`review <file>`) or is a full build: `Grep` the latest `<erd_dir>/reviews/*` for the
     verdict line and `High` findings;
   - `git diff --stat HEAD -- <erd_dir>` (the workflows never commit, so uncommitted changes are the freshest
     signal). Show the full diff for `ERD.md` only if the user asks.
5. If `$ARGUMENTS` names an ID or topic, slice it now (`--ids … --neighbors`, or `--find <text>`).

**Step 2: Brief** (no more than 6 lines): ERD version and Status; what the last run changed (counts and the 3 most
consequential IDs); open questions count; active decisions count; uncommitted ERD changes yes/no. Then ask what to
discuss or change.

**Step 3: Discuss.** Loop:
- Load only the elements in play (`--ids`, `--neighbors` for relationship questions) and the decisions touching them
  (the per-element read). Read a full DEC block only when its rationale matters.
- Answer with IDs and citations. When an active decision bears on the topic, say so (`per DEC-4`).
- When the user is weighing options, give a recommendation, grounded in the format spec's Appian conventions and the
  sources already cited. Don't fetch new sources.
- If the user states a decision without asking for an ERD change, record it (Step 4.3) and confirm in one line.

**Step 4: Change** (only on an explicit instruction: "make it", "change X to Y", "go ahead", "apply that")
1. **Plan the ops** with the change-set vocabulary from `changeset-format.md` (`add-entity`, `add-field`,
   `modify-field`, `rename`, `deprecate`, `add-relationship`, `modify-relationship`, `resolve-question`,
   `confirm-assumption`, `raise-question`) and its classes. Use `erd-slice --next-ids` for new IDs.
2. **Check decisions.** Run the per-element read for every target.
   - If the change contradicts an **Active** DEC, ask once: "This reverses DEC-n (<rule>). Supersede it?" On yes, the new DEC
     supersedes it.
   - If the instruction is ambiguous (which entity, which type), ask one question.
   - For **breaking** ops (Key, FK, cardinality, rename, deprecate), state the effect on related elements in one line
     (FKs, relationships, Mermaid) and proceed; the explicit instruction is the approval.
3. **Record the decision first:** append the Index row at the top of the Index, append the block at the end of
   *Decisions*, update `Last ID`, `Active` and `Last updated`, and set the superseded row's Status (Index and block). Create
   `DECISIONS.md` from the contract template on first use. Skip this only for pure corrections (typo, Mermaid out of
   sync with tables, a broken citation format) that decide nothing.
4. **Edit `ERD.md` surgically** with `Edit`, touching only:
   - the entity's bullets and field-table rows; Relationships / Assumptions / Open questions rows;
   - that entity's Mermaid block and its relationship lines (no lines to the LOOKUP table; LOOKUP FKs keep their
     `"LOOKUP: <TYPE>"` comment);
   - `## Groups` when adding a group; `## Summary` only if the core entities changed;
   - the *Deprecation* rules for any removal (**never delete**); *Resolved* / *confirmed* rules for Q-n / A-n.
   - Changed or added elements cite `[DEC-n]` (append to existing citations, don't replace source citations).
5. **One version per session.** On the first `ERD.md` write of the session: Version +1, Last updated = today, Status
   `Draft`, and add a Change log row `| <v> | <date> | assist DEC-<n> | <summary> |`. Later writes in the same session
   **update that row** (extend the DEC range, append to Summary) and don't bump again. Track "this session's version"
   in the conversation, and confirm it with `--outline` (header Version equals the last Change log row with `assist`).
6. **Validate** before replying:
   `node <plugin-root>/tools/erd-assist/erd-slice.mjs <ERD.md> --check <touched IDs> --decisions <DECISIONS.md>`.
   Then re-render the readable view: `node <plugin-root>/tools/erd-view/erd-view.mjs <ERD.md>`. Fix every error and
   every new `warning:` line yourself (they are your edits), then re-run both.
7. **Reply in at most 4 lines:** the IDs changed, the DEC recorded, the new or unchanged version, and the `ERD.html` path.

**Step 5: Wrap up** (when the user is done, or asks): list the files changed as clickable links. If any breaking op was
applied this session, offer to run `appian-erd-reviewer` with `scope: delta` and `changed_ids` = the touched IDs (as
`erd-maintain` Step 7 does), and save the review as `<erd_dir>/reviews/<RUN>-assist-review.md`. Remind the user that
nothing was committed.

**Guardrails**
- No PII/PHI values in `ERD.md` or `DECISIONS.md`.
- Never edit `sources.md`, change sets, or reviews. Never renumber or delete IDs, in either file.
- Never invent source citations. User-directed changes cite `[DEC-n]`. Anything else unsupported is `ASSUMPTION` with an
  `A-n` row.
- Microsoft 365 is not used by this skill.
- Never commit.

### 3.4 Context helper: `tools/erd-assist/erd-slice.mjs` (new)

Zero dependencies, Node 18+, same CLI style as `erd-view.mjs`. **Reuse `parseErd` from `../erd-view/lib/parse.mjs`**
for entities and relationships. Do a line scan only for line ranges and for rows of non-entity tables. Don't change
`parse.mjs` unless you must; if you do, keep its existing tests green.

```
Usage: node erd-slice.mjs <ERD.md> [--outline] [--log N] [--ids E-3,R-5,Q-2] [--neighbors] [--find text]
                                   [--next-ids] [--check [ids]] [--decisions DECISIONS.md]
```

| Flag | Output (plain Markdown, compact) |
|---|---|
| `--outline` | Header table; one line per `## ` section with `[lines a–b]`; one line per entity: `E-n Name (TABLE) · Kind · Group · Sensitivity · [lines a–b]`; counts of R/A/Q (open Q count separately). |
| `--log N` | The last N Change log rows (default 3 with `--outline`). |
| `--ids …` | For each `E-n`: its full `### E-n` section. For `R-n`/`A-n`/`Q-n`: that row with its table header. Plus every Relationships row that references a requested entity, and the Mermaid block(s) of the requested entities. `E-n.field` prints the entity header line plus that field row only. |
| `--neighbors` | With `--ids`: adds the `--outline` line for every entity one relationship hop away (not their full sections). |
| `--find text` | Case-insensitive match against entity names, tables, record types, field names and columns. Prints matching `--outline` lines and field rows with their `E-n`. |
| `--next-ids` | `E-<n> R-<n> A-<n> Q-<n>`: the next free IDs (max + 1, counting deprecated). |
| `--check [ids]` | Errors (exit 1): an FK→E-n target is missing; a Relationships FK field is missing from its child entity; a Mermaid entity has no matching table, or vice versa (deprecated excluded); a `[DEC-n]` citation is missing from the decisions Index (when `--decisions` is given, or if `DECISIONS.md` sits beside the ERD); a `[DEC-n]` cites a decision whose Status is not Active (warning, not error); a duplicate ID. Plus `parseErd` warnings. With ids, report only issues touching those IDs and their 1-hop neighbours. Exit 0 with `ok` when clean. |

Several flags may be combined in one call. Output goes to stdout, problems to stderr, and the exit code is 2 on usage errors.

**Budget target:** on `examples/fixtures/baseline/ERD.md`, `--outline` output must be **under 15%** of the ERD's
size, and `--ids E-11 --neighbors` under 25%. Assert both in the tests.

Tests: `tools/erd-assist/test/slice.test.mjs` (`node:test`) cover each flag on the baseline fixture, plus:
- `--check` catches a seeded dangling FK, a Mermaid/table mismatch and an unknown `[DEC-9]` (build these as in-memory
  strings, as the `erd-view` tests do);
- `--next-ids` counts deprecated IDs;
- the budget assertions.

### 3.5 Make build, revise, maintain, apply and review respect decisions

**`agents/erd-analyst.md`**
- Inputs: add `decisions_path`: `DECISIONS.md` beside `ERD.md` (may not exist; then treat it as empty).
- **Every mode, first step:** run the active-rules read (exact pattern from `decisions-format.md`). Keep the list in mind.
  Before changing any element, check whether an active rule's Affects lists it, or a `global` rule covers it.
- Build mode, step 5 (existing ERD): **keep every `[DEC-n]`-cited element exactly as decided**, and keep the citation. A
  staged source that contradicts an active DEC → leave the element, and raise a `Q-n` citing both the source and `[DEC-n]`.
- Revise mode: a finding whose fix would contradict an active DEC → **Reject** with "per DEC-n", unless the finding is High.
  Then answer *Accept, partial* and raise a Q for the user. Never silently override.
- Maintain mode, step 4: any op whose Target is in an active DEC's Affects (or that falls under a `global` rule)
  is class **`conflict`** with `Supersedes [DEC-n]` and a paired `raise-question`. An op that agrees with the DEC is
  `add-citation`.
- Apply mode: when an **accepted** op's Supersedes lists `[DEC-n]`, set that decision's Index Status (and block
  Status) to `Superseded by CS-<n> (<changeset file>)`, and update the header `Active` count. **This is the only edit any
  analyst mode makes to `DECISIONS.md`.**
- Self-check (build and apply): add "no active DEC is violated, and every `[DEC-n]` citation from before the run is still present
  unless an accepted op superseded it".
- Principles: add **"Technical Decisions are constraints, not suggestions."**

**`skills/erd-maintain/references/changeset-format.md`**
- Class rules: add "Any op that targets an element in an **Active** decision's Affects, or falls under a `global` decision,
  is `conflict`."
- Supersedes: `[DEC-n]` is a valid entry.

**`skills/erd-build/SKILL.md`**
- Step 1: resolve `decisions_path = <erd_dir>/DECISIONS.md`. Before Step 3, if `ERD.md` exists, record
  `DEC_CITES_BEFORE` (`Grep -o "\[DEC-[0-9]+\]"` with the element IDs; a simple list of `E-n`/`R-n` ↔ DEC pairs is enough).
- Step 3 and Step 5 (revise): pass `decisions_path` to the analyst. Verify that every `[DEC-` citation resolves to the
  Index, and that every pair in `DEC_CITES_BEFORE` is still present. Send the agent back once if not.
- Step 4: pass `decisions_path` to the reviewer.

**`skills/erd-maintain/SKILL.md`**
- Step 1: resolve `decisions_path`. Record `DEC_CITES_BEFORE` as above.
- Steps 4, 6, 7 and Gate B revise: pass `decisions_path`.
- Step 4 verification: every op whose Target is in an active DEC's Affects is class `conflict` with `[DEC-n]` in
  Supersedes.
- Step 5 (Gate C): list DEC conflicts first, as `CS-n reverses DEC-m (<rule>)`. Always require an explicit choice.
- Step 6 verification: every pair in `DEC_CITES_BEFORE` is still present unless an accepted op superseded that DEC,
  and every superseded DEC's Status was updated.
- Step 8: list any decisions superseded this run.

**`agents/appian-erd-reviewer.md`**
- Inputs: `decisions_path` (optional). How to work: read the active rules. **Don't raise a finding that only
  re-argues an active decision.** If a decision leaves a real High-severity risk, raise it, naming `DEC-n` in the finding,
  so the user can supersede it.

### 3.6 Config, docs, version
- **No new config key.** The path is always `<erd_dir>/DECISIONS.md`.
- `skills/setup/SKILL.md`: in the outputs note, mention that `<erd_dir>/DECISIONS.md` is committed, created by
  `erd-assist` on the first decision, and binding on later runs.
- `README.md`:
  - add the module row `| ERD assist | /project-terrarium:erd-assist | v0.1 |`;
  - add an "ERD assist" section: a 4-line flow (brief → discuss → change + DEC → validate + re-render);
  - add the Technical Decisions log: committed, binding, newest first, append-only;
  - add the context-budget point (slices, never whole files);
  - add the `erd-slice` usage line;
  - extend the test command to `node --test "tools/*/test/*.test.mjs"`.
- `.claude-plugin/plugin.json`: version `0.5.0` → `0.6.0`; append "Iterate on the ERD with an assistant that applies
  requested changes and keeps a binding Technical Decisions log." to the description.
- `docs/design/erd-assist.md`: a short design note (Context, Design overview, Why one file with an index, Why
  in-session edits, Interaction with build/maintain), matching `erd-maintain.md`. **This handoff wins** where they differ.

### 3.7 Out of scope (don't implement)
- A separate assistant subagent, or delegating assist edits to `erd-analyst`.
- Auto-committing, or any Microsoft 365 access from `erd-assist`.
- Editing `sources.md`, change sets or reviews from `erd-assist`.
- A per-decision file layout, or a database/JSON index. The Markdown Index is the index.
- Changes to the `erd-view` HTML (it already ignores unknown citation forms; just confirm in Task 1).

---

## 4. Tasks

### Task 1: Contracts ✅ commit "Add Technical Decisions contract and DEC citations to the ERD contract"
- Create `skills/erd-assist/references/decisions-format.md` per §3.1, with the rules, template and canonical-reads table.
- Edit `erd-format.md` per §3.2, and `changeset-format.md` per §3.5.
- Confirm `parse.mjs` and the viewer tolerate `[DEC-n]` in Sources cells: run
  `node tools/erd-view/erd-view.mjs` on a copy of the baseline with one `[DEC-1]` citation added. Note the result in
  Implementation notes.

### Task 2: `erd-slice` tool ✅ commit "Add erd-slice context helper"
- `tools/erd-assist/erd-slice.mjs` and `tools/erd-assist/test/slice.test.mjs` per §3.4.
- `node --test "tools/*/test/*.test.mjs"` is green, including the existing `erd-view` tests.

### Task 3: `erd-assist` skill ✅ commit "Add erd-assist skill"
- `skills/erd-assist/SKILL.md` per §3.3. Resolve `decisions-format.md` and `changeset-format.md` as absolute paths, as
  `erd-maintain` does for its references.

### Task 4: Wire decisions into build, maintain and review ✅ commit "Make build, maintain and review respect Technical Decisions"
- `agents/erd-analyst.md`, `agents/appian-erd-reviewer.md`, `skills/erd-build/SKILL.md`,
  `skills/erd-maintain/SKILL.md` per §3.5.

### Task 5: Docs and version ✅ commit "Document erd-assist; bump to 0.6.0"
- `README.md`, `skills/setup/SKILL.md`, `.claude-plugin/plugin.json`, `docs/design/erd-assist.md` per §3.6.

### Task 6: Fixtures ✅ commit "Add erd-assist fixtures"
- `examples/fixtures/decisions/DECISIONS.md`: 4 decisions against `examples/fixtures/baseline/ERD.md`, using real IDs
  from it:
  - DEC-1 (Active, Affects `E-11.authorizedHoursPerWeek`): "Store authorized hours as whole-hour Integer". The
    maintain fixture's S4 transcript proposes Integer → Decimal for this field (`maintain-expected.md`), so it must
    become a `conflict` op;
  - DEC-2 (Superseded by DEC-4), on any E-9 field;
  - DEC-3 (Active, `global`): for example "No PII free-text fields on reference tables";
  - DEC-4 (Active, Affects `E-2 R-<n>`, the household-member relationship): a relationship rule.
  Index rows are newest first, as the contract says.
- `examples/fixtures/decisions/ERD-with-decs.md`: the baseline with `[DEC-n]` citations added for the active rules (built
  by hand per §3.3 Step 4). `erd-slice --check` on it with the decisions fixture must exit 0.
- `examples/fixtures/assist-expected.md`: a scripted session (below) with the expected outcome for each step, plus the
  expected maintain outcome: the op touching the DEC-governed field becomes `conflict` with `Supersedes [DEC-n]` and a
  paired question, and the decided value is unchanged after apply if that op is rejected.

---

## 5. Verification (do all of these before the final push)

1. `node --test "tools/*/test/*.test.mjs"` passes.
2. `claude plugin validate .` passes.
3. Budget: `erd-slice --outline` and `--ids <entity> --neighbors` on the baseline meet the §3.4 targets (asserted by the tests).
4. **Scripted assist session** in `examples/sample-project` (copy `baseline/ERD.md`, `baseline/sources.md` and
   `decisions/DECISIONS.md` into `erd/`; run `claude --plugin-dir ../..`; `/project-terrarium:erd-assist`):
   1. The brief appears. The transcript shows **no full `Read` of `ERD.md` or `DECISIONS.md`**.
   2. "What does E-<n> relate to?" → the answer comes from a `--ids --neighbors` slice.
   3. "Make <field> required." → DEC-5 is appended (Index top row, block at end, header updated); `ERD.md` has targeted edits with
      `[DEC-5]`; Version +1; Change log row `assist DEC-5`; `--check` ok; `ERD.html` re-rendered with no new warnings.
   4. "Also rename <field> to <name>." → DEC-6; **no second Version bump**; the Change log row now reads `assist DEC-5–DEC-6`.
   5. "Change E-11.authorizedHoursPerWeek to Decimal." → the assistant asks whether to supersede DEC-1. On yes, DEC-7 is added
      and DEC-1 is marked `Superseded by DEC-7` in the Index and the block.
   6. "We decided not to model provider ratings." → a decision-only DEC, with no ERD edit.
5. **Maintain respects decisions:** reset `erd/` to the fixture copies (use `ERD-with-decs.md` as `ERD.md`) and run
   `/project-terrarium:erd-maintain`. The S4 op on `E-11.authorizedHoursPerWeek` (DEC-1) is `conflict` with `Supersedes [DEC-n]`, listed first at Gate C. Reject it: after apply, the
   field and its `[DEC-n]` citation are unchanged. Run it again and accept: DEC-n becomes `Superseded by CS-<n> (…)`.
6. Record the results, deviations and anything not run under Implementation notes. Then push `dev`.

## 6. Definition of done
- [ ] All tasks committed on `dev` and pushed; no PR opened.
- [ ] The tests are green; the plugin validates.
- [ ] The scripted session and the maintain check behave as in §5, or the deviations are recorded below.
- [ ] No file reads `ERD.md` or `DECISIONS.md` in full where §3.3's context budget applies.
- [ ] Implementation notes are filled in.

## Implementation notes
### Decisions made while building
- **`erd-slice` is one file** (`tools/erd-assist/erd-slice.mjs`) that exports `run`, `load`, `check` and `parseDecisions` for the tests, like `erd-view.mjs` exports `render`. `parse.mjs` is unchanged.
- **Group in outline lines** shows `—` when the ERD has no Group bullets (the viewer derives groups, but the outline reports what the file says).
- **`--check` output:** errors and warnings go to stderr as `error:` / `warning:`; stdout ends with `ok`, `ok (N warning(s))` or `N error(s)`. Exit 1 only for errors. A non-Active `[DEC-n]` citation, a header `Active` count that disagrees with the Index, and `parseErd` warnings are warnings; duplicate Index rows are errors.
- **`--check <ids>` scope:** the given IDs, their 1-hop entity neighbours, and the relationships touching them. `parseErd` warnings are matched by ID or table name.
- **`--decisions` given but the file is missing** is treated as an empty log, so every `[DEC-n]` citation is then an error. With no `--decisions` and no `DECISIONS.md` beside the ERD, citations aren't checked.
- **`E-n.field` slice** prints the entity heading with the field tag, the table header and the one row.
- **Analyst agent:** the active-rules read is a "First step, every mode" section rather than a bullet in each mode. It points at `decisions-format.md` by repo path.
- **Fixture deviation:** the handoff puts DEC-2 on an E-9 field but says DEC-4 (on `E-2 R-2`) supersedes it, which made no sense and the assistant flagged it. DEC-2 is instead the earlier rule on `E-2.householdId` ("a member may belong to several households") that DEC-4 reverses. `ERD-with-decs.md` is Version 2 with a Change log row `assist DEC-1–DEC-4`.
- **DEC-1 Affects only `E-11.authorizedHoursPerWeek`**, as specified. The S4 op on `E-12.authorizedHoursPerWeek` is therefore not forced to `conflict` (see `assist-expected.md`).

### Task 1: viewer check
`erd-view` on a copy of the baseline with `[DEC-1]` added to the E-11 `authorizedHoursPerWeek` Sources cell renders the same 14 entities and 18 relationships, with no new warnings, and the citation survives in the parsed model. No viewer change was needed.

### Verification results
1. `node --test "tools/*/test/*.test.mjs"`: 52 pass (the existing `erd-view` tests plus 17 new `erd-slice` tests).
2. `claude plugin validate .` and `claude plugin validate .claude-plugin/plugin.json`: both pass.
3. Budget on the baseline (19,474 bytes): `--outline` 1,964 bytes (10%), `--ids E-11 --neighbors` about 2.5 KB (13%). Asserted in the tests.
4. **Scripted assist session** (scratch copy of `sample-project`, run headlessly as `claude -p … --continue` with `--permission-mode acceptEdits`): all six steps behaved as in `assist-expected.md`. No full `Read` of `ERD.md` or `DECISIONS.md` appears in any turn: only `erd-slice` calls, the active-rules `Grep`, `git diff --stat` and short `sed` ranges. Results: DEC-5 (`E-11.endDate` required, Version 1 to 2), DEC-6 (rename, no second bump), DEC-7 (asked "Supersede DEC-1?", then DEC-1 became `Superseded by DEC-7` in the Index and block), DEC-8 (decision-only, no ERD edit). `erd-slice --check` was ok at the end.
5. **Maintain respects decisions** (scratch copies, `ERD-with-decs.md` as `ERD.md`):
   - The S4 op on `E-11.authorizedHoursPerWeek` was a `conflict` with `Supersedes [DEC-1]`, paired with a question, and listed first at Gate C as `CS-n reverses DEC-1 (…)`.
   - **Reject run:** the field and `[DEC-1]` were unchanged after apply, DEC-1 stayed Active, `--check` ok, and the reviewer named DEC-1 in a Medium finding instead of re-arguing it.
   - **Accept run:** DEC-1 became `Superseded by CS-1 (2026-10-09-changeset.md)` in the Index and the block, header `Active` went 3 to 2, the field became `Decimal(4,1)`, and `--check` was ok.

### Deviations and things not run
- Sessions were run headlessly, one prompt per turn, not interactively.
- In the assist session the model made its edits with short Python scripts through Bash rather than `Edit` calls. The result is the same targeted change, but the skill text says `Edit`.
- The assist session wrote the Change log row as `assist DEC-5, DEC-6, DEC-7`. `SKILL.md` now says to write a contiguous range as `assist DEC-5–DEC-7`; that wording change was not re-run.
- I did not diff `ERD.html` warnings before and after each assist edit; `erd-view` ran and the `--check` result was clean.
- In the maintain runs the analyst numbered the ops differently on each run, so a scripted reply written from run 1 left two ops undecided in run 2. The orchestrator asked instead of guessing, and a follow-up reply finished the run.
- Maintain Gate B (review rounds) was reached in both runs but not worked through; the reviews were produced and the run was stopped there.
- The baseline has no `## Groups`, so maintain adds a Groups section when it adds entities.
- Not run: `erd-build` against decisions (the `DEC_CITES_BEFORE` and `[DEC-` resolution checks are specified in the skill but not exercised), and the 300-row archive rule.

