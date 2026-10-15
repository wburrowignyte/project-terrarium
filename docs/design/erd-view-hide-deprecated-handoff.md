# Handoff: hide deprecated items in the ERD viewer by default

You are changing the diagram that `erd-view` renders from `ERD.md`. **This file is the build spec.**
Every decision is made below. If a question comes up that this file doesn't answer, choose the option
most consistent with the existing `tools/erd-view/` code, and record it under "Implementation notes" at
the end of this file.

Work on branch `claude/bold-davinci-6atrer`. Commit in logical steps (suggested points are marked ✅).
Push with `git push -u origin claude/bold-davinci-6atrer` when done. Don't open a pull request.

---

## 1. Goal

`erd-assist` and `erd-maintain` never delete anything from an ERD. They mark retired tables and
relationships as deprecated, so the deprecated set grows with every session. The viewer has a
**Show deprecated** checkbox, but it is **checked** by default, so every open shows retired tables.

The user's requirements:

1. **Show deprecated starts unchecked.** A new view shows only the current model.
2. **Deprecated relationships are covered too.** While the box is unchecked, a deprecated relationship
   is hidden even when both of its tables are live. Today the checkbox only hides tables.
3. **No persistence.** Every open starts unchecked, like the other filters. Don't use `localStorage`.
4. **No CLI flag.** `erd-view.mjs` is unchanged. Anyone who wants deprecated items ticks the box.

The current code. Read the line ranges given, not the whole file (`template.html` is 581 lines):

| File | Where | What it does now |
|---|---|---|
| `tools/erd-view/lib/template.html` | line 81 | `<input type="checkbox" id="deprecated" checked>` plus the `#depn` count |
| | line 116–117 | `drawnRels` (non-LOOKUP relationships) and `dnbrs` (neighbours through drawn relationships) |
| | line 125 | `state` initialiser: `showDeprecated: true` |
| | line 170–172 | `depCount` counts deprecated **entities** only. The row is hidden when that count is 0. The change handler sets `state.showDeprecated` |
| | line 177–194 | `visibleSet()`. Line 190 hides deprecated entities unless they are selected. Line 191 is the "isolated" test, which uses `dnbrs` |
| | line 242–256 | `rebuild()`. Line 246 filters edges to those with both ends visible. Line 256 is the status line |
| | line 283, 318, 348 | Dashed styling for deprecated relationships and entities, and the legend entry. **Leave these unchanged.** |
| | line 511–513 | `goTo()` resets kind/group/sensitivity filters to reveal a hidden target. It does not touch `showDeprecated`. It doesn't need to, because a selected entity bypasses the deprecated filter |
| `tools/erd-view/lib/parse.mjs` | line 119, 123, 143 | Entity `deprecated` is the Status text (`''` when live). Relationship `deprecated` is a boolean (description starts with "Deprecated") |

The model data is already correct. **Change only `template.html`**, plus the docs and version in §4.

Constraints: no new dependencies (Node 18+ stdlib, plain browser JS). The HTML output must stay
self-contained and work offline. Every existing viewer feature must keep working: filters, focus,
search, minimap, SVG/PNG export, large-model modes, and the dashed styling for deprecated items.

---

## 2. Behaviour spec

### 2a. Default

- Line 81: remove `checked` from `#deprecated`.
- Line 125: `showDeprecated: false`.

The markup and the state must agree. Use the state as the source of truth: after building the filters
UI, set `$('#deprecated').checked = state.showDeprecated`, the same way `#fieldmode` and `#edgemode` are
synced at line 129.

### 2b. Which relationships are hidden

While `state.showDeprecated` is false, hide a drawn relationship `r` when either of these holds:

- `r.deprecated` is true, **unless** `r.from` or `r.to` is `state.selected`. A selected entity always
  shows its own lines. This matches the entity rule at line 190.
- either endpoint is a hidden deprecated entity. This already happens through `visibleSet()`.

Apply this in `rebuild()` at line 246. Add a predicate beside `visibleSet()`, for example
`relVisible(r, vis)`, and use it there. Don't inline the rule.

### 2c. "Isolated" must use live neighbours

Line 191 hides "entities with no relationships" using `dnbrs`, which counts deprecated relationships and
deprecated neighbours. With deprecated items hidden, a live table whose only links are deprecated would
render with no lines but still count as connected.

Precompute a second map next to `dnbrs` (line 116–117). Call it `liveNbrs`, built only from drawn
relationships where `!r.deprecated` and both endpoint entities have an empty `deprecated`. At line 191,
use `(state.showDeprecated ? dnbrs : liveNbrs)`. Don't change `nbrs`, which focus and `goTo` use.

### 2d. Count and row visibility

- `depCount` (line 170) becomes the deprecated entities plus the deprecated **drawn** relationships.
  Hide `#deprow` only when both are 0.
- `#depn` shows what will be hidden. Use `3 tables · 2 relationships`, drop whichever part is 0, and
  use the singular form for 1.

### 2e. Things that must keep working

- **Search / jump to a deprecated table** (`goTo`, the `data-go` links in the detail panel, Enter in
  search). The table appears because it is selected. Its own deprecated relationships draw (§2b), still
  dashed. Deselecting it hides it again. Don't change the checkbox state in `goTo`.
- **Focus** (`Focus selected`, hops). Deprecated neighbours stay hidden unless the box is ticked. The
  focus root is visible even when it is deprecated: when `state.focus.id` is deprecated, treat it like
  `state.selected` in the line 190 test.
- **Status line** (line 256). "x of y relationships" already reflects hidden edges, so no change is
  needed.
- **Ticking the box** restores today's exact behaviour: every deprecated table and relationship shows,
  dashed.

✅ Commit: `erd-view: hide deprecated tables and relationships by default`

---

## 3. Tests

The `node --test` suites cover `parse.mjs` and `layout.mjs` only. The template has no unit tests, so this
change is verified in the browser (§5). Don't add a test framework.

- `tools/erd-view/test/parse.test.mjs`: add one assertion to the existing
  `'deprecation and change log are parsed'` test. A relationship whose description starts with
  `Deprecated` parses with `deprecated === true`. Line 143 already does this, but nothing tests it.
- Run `node --test "tools/*/test/*.test.mjs"`. It must pass.

✅ Commit: `erd-view: test relationship deprecation parse`

---

## 4. Docs and version

- `README.md`, erd-view section (around line 67–87): add one sentence. Deprecated tables and
  relationships are hidden by default, and **Show deprecated** in the side panel reveals them, dashed.
- `skills/erd-view/SKILL.md` (if it exists): if it describes the filters, add the same sentence.
  Otherwise leave it.
- `.claude-plugin/plugin.json`: bump `0.6.0` to `0.6.1`. If the README keeps a per-feature version table
  (line 13 shows `v0.2` for ERD view), follow its convention and record what you did in the notes.
- `skills/erd-build/references/erd-format.md`: **no change.** The contract for marking deprecation is
  unchanged.

✅ Commit: `Document deprecated-hidden default; bump to 0.6.1`

---

## 5. Verification (do all of it before pushing)

No fixture has deprecated items. Make a temporary one in your scratch directory, **not** in the repo.
Copy `examples/fixtures/baseline/ERD.md` and add these three deprecations:

1. Entity A gets `- **Status:** Deprecated in v2: merged into <other> [S1]`. Choose one with live
   neighbours.
2. Relationship R between two **live** entities gets a description beginning `Deprecated in v2: …`.
3. Entity B gets only deprecated links: deprecate the only relationship(s) of a leaf table.

Generate it: `node tools/erd-view/erd-view.mjs <scratch>/ERD.md -o <scratch>/ERD.html`.

Drive it with Playwright. Chromium is at `/opt/pw-browsers`, so don't run `playwright install`. Check
and record each result:

| # | Check | Expected |
|---|---|---|
| 1 | Load the page | `#deprecated` is unchecked. A and its edges are absent. R is absent. `#depn` reads `1 table · 2 relationships` (or whatever your fixture's counts are, in that format) |
| 2 | Untick "Show entities with no relationships" | B disappears (it has only deprecated links) |
| 3 | Tick "Show deprecated" | A, R and B's links appear, all dashed. The status line counts match today's build of the same file |
| 4 | Untick, search A's table name, press Enter | A appears, selected, with its deprecated edges dashed. Click empty canvas: A disappears |
| 5 | Select a live neighbour of A, Focus selected (1 hop) | A is not shown. Tick the box: A is shown |
| 6 | Generate `examples/fixtures/baseline/ERD.md` unchanged | `#deprow` is hidden. The diagram is identical to before (compare the status line and node count) |
| 7 | `node tools/erd-view/test/gen-large.mjs` output | Renders. No console errors |

Save before/after screenshots of check 1 and check 3 to `docs/design/erd-view-hide-deprecated/`. Run
the tests again. Then push.

---

## Implementation notes

_Build agent: fill in below. Record commits, any decisions this spec left open, deviations from it, the
verification results table, and any known limits._

### Commits
1. `erd-view: hide deprecated tables and relationships by default` (template.html)
2. `erd-view: test relationship deprecation parse`
3. `Document deprecated-hidden default; bump to 0.6.1`
4. `erd-view: re-render on selection change when it affects deprecated items` (deviation, below)

### Decisions and deviations
- **Deviation (bug found in verification):** `select()` only restyled, so deselecting a deprecated table left it on
  screen (check 4 failed). `select()` now calls `rebuild(false)` when deprecated items are hidden and the old or
  new selection is a deprecated table or has a deprecated drawn relationship. Cost: a relayout on those
  selections only.
- `relVisible(r, vis)` also requires both endpoints in `vis`, so it fully replaces the old filter at `rebuild()`.
- Focus root is exempt from the deprecated-entity filter (spec 2e).
- `liveNbrs` is built after `byId` exists (needed to test endpoint deprecation).
- README per-feature version table (`v0.2` for ERD view) left unchanged; only `plugin.json` bumped to 0.6.1.
  `skills/erd-view/SKILL.md` has a filter tips list, so the same sentence was added there.
- `#deprecated` is synced from `state.showDeprecated` next to `#fieldmode`/`#edgemode`.

### Verification (fixture in scratch: E-10 deprecated; R-17 and R-10 deprecated; E-12's only link is R-10)
| # | Result |
|---|---|
| 1 | Pass. Unchecked; `#depn` = `1 table · 2 relationships`; 13 of 14 entities, 15 of 18 relationships |
| 2 | Pass. Unticking "no relationships" hides E-12 (12 of 14) |
| 3 | Pass. 14 of 14, 18 of 18, dashed edges drawn; same as the old build of the same file |
| 4 | Pass after fix. Search selects E-10 (14 / 16 relationships, dashed); clicking empty canvas returns to 13 / 15 |
| 5 | Pass. Focus on CCA_PROVIDER, 1 hop: 3 entities (license type hidden); ticking the box gives 4 |
| 6 | Pass. Baseline fixture: `#deprow` hidden, 14 of 14, 18 of 18 |
| 7 | Pass. `gen-large.mjs` output renders 150 of 150, 258 of 258, no console errors |

Screenshots: `docs/design/erd-view-hide-deprecated/` (`before.png` = old build, `after-unchecked.png`, `after-checked.png`).
`node --test "tools/*/test/*.test.mjs"`: 55 pass.

### Known limits
- Selecting or deselecting a deprecated table triggers a relayout, so nodes may shift slightly.
