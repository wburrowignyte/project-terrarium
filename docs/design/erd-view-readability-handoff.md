# Handoff: make the ERD diagram readable (hierarchy, groups, elbow connectors, LOOKUP)

You are improving the diagram that `erd-view` renders from `ERD.md`. **This file is the build spec.**
Every decision is made below. If you hit a question it doesn't answer, choose the option most
consistent with the existing `tools/erd-view/` code and record it under "Implementation notes" at
the end of this file.

Work on branch `dev`. Commit in logical steps (suggested points are marked ✅). Push to `origin dev`
when done. Don't open a pull request.

---

## 1. Goal

The user's requirements for the rendered ERD:

1. **Logical hierarchy.** Core records are near the top. Reference and History/Audit records sit nearby or below them.
2. **Grouping.** Tables are grouped where it makes sense, by structure or by function.
3. **Connectors.** Elbow (orthogonal) connectors made of straight segments, **never curves**, and as
   little overlap as possible.
4. **LOOKUP.** The project's single shared lookup table (`<PREFIX>_LOOKUP`) gets **no connector lines**.
   Instead, each field that references it is marked inside its table.

What exists today (read these in full first):

| File | What it does now |
|---|---|
| `tools/erd-view/lib/parse.mjs` | ERD.md to model (entities, fields, relationships, warnings) |
| `tools/erd-view/lib/template.html` | Viewer. `layout()`/`layoutComponent()` run a layered per-component layout and shelf-pack the result, so there is no grouping and Core isn't guaranteed to be on top. `ports()` + `edgePath()` draw **cubic Bézier** connectors. `kindOf()` knows Core/Reference/Junction/History-Audit. |
| `tools/erd-view/erd-view.mjs` | CLI that injects the model into the template |
| `tools/erd-view/test/*.mjs` | `node --test` suite and the `gen-large.mjs` synthetic ERD |
| `skills/erd-build/references/erd-format.md` | ERD contract (gets Group + LOOKUP) |
| `agents/erd-analyst.md`, `agents/appian-erd-reviewer.md`, `skills/erd-build/references/appian-risk-checklist.md` | Producers and consumers of the contract |
| `examples/fixtures/baseline/ERD.md` | 14-entity maintained ERD, no groups (it must keep rendering well) |

Constraints: stay zero-dependency (Node 18+ stdlib, plain browser JS). The HTML output stays
self-contained and offline. Keep every existing viewer feature working: filters, focus, search,
minimap, SVG/PNG export, large-model modes.

---

## 2. Contract changes (`skills/erd-build/references/erd-format.md`)

### 2a. Groups
- New entity bullet after `Kind`: `- **Group:** <group name>`. Every entity except LOOKUP has one.
- New section **`## Groups`** between `## Summary` and `## Diagram`:
  ```
  | Order | Group | Description |
  |---|---|---|
  | 1 | Household | The family unit and its members |
  | 2 | Application & Eligibility | Requests for assistance and their determinations |
  ```
  `Order` is left-to-right placement. Analyst guidance: give the groups with the most
  cross-group relationships adjacent orders. Aim for 3–7 groups of 2–8 tables. Group by function
  (Case, Provider, Payment) and keep a Core table's dedicated children (its notes, history, status table)
  in its group.
- Add to the *Rules* list: Groups are stable. Don't rename or reorder them without a reason in the Change log.

### 2b. Shared LOOKUP table
- Kind list becomes `Core | Reference | Junction | History/Audit | Lookup`. `Lookup` is used only
  for the shared table.
- Naming table row: `Shared lookup | <PREFIX>_LOOKUP (one per application) | DHS_LOOKUP`.
- Fixed columns: `ID` PK, `LOOKUP_TYPE` Text (code-list name, e.g. `CASE_TYPE`), `CODE` Text,
  `LABEL` Text, `SORT_ORDER` Integer, `IS_ACTIVE` Boolean, plus audit fields (`CONVENTION`). No Group.
- Rule: an enumeration with 3+ values goes into LOOKUP under its own `LOOKUP_TYPE`. Use a dedicated
  `<ENTITY>_STATUS`/reference table **only** when the values carry extra attributes or relationships (e.g.
  allowed transitions), and say why in that entity's Purpose.
- An FK to LOOKUP uses the column `<CONCEPT>_ID` and the Key cell **`FK→LOOKUP:<LOOKUP_TYPE>`**
  (e.g. `FK→LOOKUP:CASE_TYPE`). The parser and the reviewer both rely on this exact token.
- Seed values: under the LOOKUP entity, add one small table per `LOOKUP_TYPE`, each preceded by a
  `**<LOOKUP_TYPE>**` line. (The parser reads only the first table in an entity section, so these don't
  merge into the fields. Keep it that way.)
- The **Relationships table still lists** a `many-to-one` row for every LOOKUP FK, because Appian needs one
  relationship per FK. Only the diagram drops the line.
- Optional config override: `project.lookup_table` in `project-terrarium.yaml`. The default is `<PREFIX>_LOOKUP`.

### 2c. Mermaid block (plain-text fallback)
- Emit entity blocks in Group order, then by tier (§4b).
- **Omit relationship lines that target LOOKUP.**
- Mark LOOKUP FK attributes with a comment: `int CASE_TYPE_ID FK "LOOKUP: CASE_TYPE"`. (The
  existing parser already strips quoted comments.)
- The LOOKUP entity block goes last.
- Update the `## Document structure` example to show a Group bullet, the Groups table, a LOOKUP FK
  row, and the Mermaid comment.

✅ Commit: contract.

## 3. Producers and consumers

- `agents/erd-analyst.md`: in build step 4, assign Groups and write `## Groups`, and route enumerations to
  LOOKUP. Self-check: every Group is listed in `## Groups`; every `FK→LOOKUP:<TYPE>` has seed values or
  an open question and a Relationships row; the Mermaid block has no LOOKUP lines. In revise/maintain/apply
  modes, keep Group assignments stable and give a new entity a Group.
- `skills/erd-maintain/references/changeset-format.md`: `add-entity` must include the Group. Add the op
  `modify-entity` for a Group change only if the format has no way to express it already. Record your
  choice in Implementation notes.
- `skills/erd-build/references/appian-risk-checklist.md` §3: replace the "entity-scoped, not a single
  shared STATUS" item with: entity-scoped status tables or the project's `<PREFIX>_LOOKUP` are both
  acceptable, but a bare `STATUS` table never is. Add these probes:
  - The DB can't enforce that a LOOKUP FK points at the right `LOOKUP_TYPE`; is validation planned? (Medium)
  - Values with lifecycle rules or extra attributes are forced into LOOKUP. (Medium)
  - A LOOKUP FK has no Relationships row. (Low)
- `agents/appian-erd-reviewer.md`: one line saying the diagram omits LOOKUP lines **by design**.
- `skills/erd-build/SKILL.md` Step 3 verification: `## Groups` exists and every entity has a Group.
- `skills/setup/SKILL.md` and `examples/sample-project/project-terrarium.yaml`: add the commented-out
  `lookup_table:` setting.

✅ Commit: agents, checklist, config.

## 4. Viewer changes (`tools/erd-view/`)

### 4a. Parser (`lib/parse.mjs`)
- `entity.group` comes from the `Group` bullet (`''` if absent).
- `model.groups = [{ order, name, description }]` comes from `## Groups`, sorted by order.
- Field: if `key` matches `/^FK→LOOKUP:(\S+)/`, set `field.lookupType` to the matched type.
- LOOKUP entity: `kind` starts with `lookup`, **or** `table` ends with `_LOOKUP`. Set `model.lookupId`.
  - Set `rel.lookup = true` on every relationship whose `to` is the LOOKUP entity.
  - If an `FK→LOOKUP:` field exists but no LOOKUP entity does, add a warning.
- Warnings:
  - `entity X: Group "Y" not in ## Groups`
  - `X.COL: FK→LOOKUP has no Relationships row`
  - a Group listed in `## Groups` with no entities
- **Fallback when there's no Group data** (old ERDs, `baseline`, `flawed-ERD`), deterministic:
  1. Each Core entity with no Core parent seeds a group named after it.
  2. Walk from those seeds by BFS over relationships, in entity-ID order. A Core/Junction/History
     entity joins the group of its first-reached parent.
  3. A Reference entity used by tables in 2+ groups goes to a group named `Shared reference`. Otherwise
     it joins its consumer's group.
  4. Anything left goes to `Other`.
  5. Mark `model.groupsDerived = true`. Show `Groups inferred, add ## Groups to ERD.md` in the warnings tab
     (not as a warning on stderr).

### 4b. Layout: new pure module `lib/layout.mjs`
Move layout and routing into a DOM-free module so Node can test them. `erd-view.mjs` inlines it
into the template by replacing a `/*__LAYOUT__*/` placeholder, the same way `/*__MODEL__*/` works today.
Input is the nodes `{id, w, h, kind, group}` (sizes already measured by the template), the edges
`{id, from(child), to(parent), cardinality}`, and the group order. Output is node `x,y`, group rects,
and edge polylines.

**Grid.** Build a global grid of cells, grouped first and then tiered:
- **Columns.** Each group gets a contiguous block of columns, in Group order, left to right. Wrap to a new
  **band** after the cumulative width passes `BAND_BUDGET` (≈ 2600px, same as the current `BUDGET`). A band
  holds whole groups only.
- **Tiers (rows).** They're aligned across every group in a band, so horizontal gutters run straight through:
  1. Core, depth 0…k: depth is the longest path from a Core root over Core→Core edges *inside the group*,
     so a Core child sits one tier below its in-group Core parent.
  2. Junction
  3. Reference
  4. History/Audit
  5. Unspecified

  Empty tiers collapse per band.
- **Order within a group's row.** Run barycentre sweeps (reuse the logic in `layoutComponent`), restricted to
  the group, using all edges to rows above and below. Then do a tree-style pass: place a parent's children in the row below
  side by side under the parent, **never stacked in one column**. Unplaced cells fill left to right.
- **Sizes.** A column is as wide as its widest node and a row as tall as its tallest node. Nodes are centred in their cells.
- **Gutters.** There's a vertical gutter between every pair of adjacent columns (wider between groups) and a horizontal gutter
  between every pair of rows. Each gutter is `BASE (24px) + lanes × LANE (10px)`, where `lanes` comes from routing.
  That means **two passes**: route on the logical grid, count lanes per gutter, then assign pixel coordinates.
- **Group frames.** Draw one rounded rectangle per group around its column block, spanning the band's used height, with the
  group name as a header strip. Draw them behind edges and nodes using the existing theme colours. Add a faint tint
  per group, cycling through 6 neutral tints.
- **LOOKUP and legend.** Put a `Shared lookup` frame below the last band (left), holding only the LOOKUP table. Put a legend
  box beside it with Kind colours, crow's-foot meanings, the LOOKUP field marker, and dashed = many-to-many/deprecated.

### 4c. Routing (orthogonal, channel-based)
Replace `ports()` + `edgePath()` with routing in `layout.mjs`. Every segment runs inside gutters,
so **a connector never crosses a table**.
1. **Ports.** The child connects at its **top** and the parent at its **bottom**. When the parent is in the same row or a
   lower row, connect at its **top** instead. Same row and adjacent columns: use the facing **sides** with one vertical jog in the
   gutter between them. When one side has several ports, spread them evenly (`(i+1)/(n+1)`), sorted by
   the other end's x position. Keep the existing marker code (`markerPath`, `circleAt`); it already takes an
   outward direction.
2. **Path.** port → stub into the adjacent horizontal gutter → along it to the nearest vertical gutter
   toward the target column → along that vertical gutter to the horizontal gutter at the target port →
   along it to the port x → stub into the port. When source and target ports line up vertically
   with nothing between them, collapse it to one straight segment. That's at most 5 segments.
3. **Lanes.** For each gutter, take the intervals routed through it and assign lanes greedily
   (sort by start; take the lowest lane free over the interval). Each segment sits at its gutter's
   `start + BASE/2 + lane × LANE`. **No two connectors share a collinear stretch.** Crossings are allowed.
   Draw a small gap ("line jump") where a horizontal segment crosses a vertical one, so crossings read as crossings.
4. **Self-reference.** A rectangular loop on the right side through the right-hand vertical gutter.
5. **SVG.** Draw a `<path>` of `M…L…` only, with `stroke-linejoin: miter`. **No `C`, `Q`, `A` or rounded
   joins anywhere in edge paths.** The label goes at the midpoint of the longest segment; keep the current show-on-hover/select behaviour.
6. **Large models.** The existing `edgeMode: 'selected'` (over 80 relationships) still applies. Routing must handle
   150 entities (`gen-large.mjs`) in under 300 ms.
7. Keep the current layered layout as a `Layout` dropdown option, `Compact (auto)`. Focus mode on ≤ 6 nodes
   may also use it. The new default is `Grouped`. Re-route with the same algorithm in both modes.

### 4d. LOOKUP rendering
- Never draw `rel.lookup` relationships, in any edge mode. They don't count toward the "over 80 relationships" threshold either.
- Field rows with `lookupType`: the key tag reads `LK` in an amber chip, and the type column shows
  `→ <LOOKUP_TYPE>` in place of `Integer`. Keep them in `Key fields only` mode.
- `Names only` mode: show a small amber badge on the node, `LK ×n`, where n is the number of LOOKUP fields.
- Detail panel: a "Lookup fields" list for the selected entity. When LOOKUP itself is selected, list
  each referencing table with its `LOOKUP_TYPE`s, and **highlight those tables** (the same highlight style as neighbours) instead of drawing lines.
- Kind filter gains `Lookup` (amber `--k-lookup`, defined for light and dark themes). Add a Group filter
  (one checkbox per group) under Kind.
- Search: matching a `LOOKUP_TYPE` name highlights every table that references it.

✅ Commit: parser + layout module + tests. ✅ Commit: template rendering.

## 5. Fixture and tests

- New `examples/fixtures/grouped-ERD.md`: synthetic child care data, prefix `CCA`, about 16 entities in 4 groups, with
  `## Groups`. It must include: a Core parent with 3 children in one group, a Core→Core cross-group relationship, a
  junction, an entity-scoped status table (and why it isn't in LOOKUP), a History/Audit table, a
  self-reference, a one-to-one, an optional FK, a `CCA_LOOKUP` with seed tables and **5+ LOOKUP FKs from 3+ groups**, and
  a PII entity. Mirror the Mermaid rules in §2c.
- Extend `gen-large.mjs` with an option to emit Groups and LOOKUP FKs.
- Add `test/layout.test.mjs` (`node:test`):
  - The parser reads groups, `lookupType`, `rel.lookup`, and the warnings in §4a.
  - Derived groups for `baseline/ERD.md` and `flawed-ERD.md` are deterministic: every entity has a group and two runs give identical output.
  - **Hierarchy:** within each group, every Core node's y is ≤ every Junction/Reference/History node's y.
  - **No curves:** every edge path matches `/^M[\d.,-]+(L[\d.,-]+)+$/`, and so does the rendered template's edge `d`.
  - **Orthogonal:** each segment is horizontal or vertical.
  - **No table crossings:** no segment intersects a node rect other than its own endpoints' (1px tolerance).
  - **No overlaps:** no two edges share a collinear overlapping stretch longer than 1px.
  - LOOKUP: no routed edge touches the LOOKUP node; the count of drawn edges equals relationships minus LOOKUP relationships.
  - Group frames don't overlap and each contains all of its nodes.
  - Performance: 150-entity `genLarge` lays out and routes in under 300 ms.
- Existing `parse.test.mjs` passes unchanged. If an assertion has to change, explain why in Implementation notes.

## 6. Docs and version

- `README.md`, the erd-view section: grouped layout, LOOKUP marking, the Layout dropdown.
- `skills/erd-view/SKILL.md`: viewer tips (Group filter, selecting LOOKUP highlights its users, inferred-groups notice).
- `.claude-plugin/plugin.json`: bump the minor version.

## 7. Verification (do all of it before pushing)

1. `node --test "tools/erd-view/test/*.test.mjs"`: all pass.
2. Render `examples/fixtures/grouped-ERD.md`, `examples/fixtures/baseline/ERD.md`, and a 150-entity
   `genLarge` ERD. Screenshot each with Playwright (Chromium is preinstalled; use
   `executablePath: '/opt/pw-browsers/chromium'` if the pinned version differs) in light and dark themes,
   in `All fields` and `Names only` modes. Check by eye:
   - Core tables are on top and Reference/Audit tables are below.
   - Group frames are labelled and in order.
   - Only straight elbow connectors, none crossing a table, none sharing a run.
   - No lines to LOOKUP, and LOOKUP fields are marked.
   - SVG and PNG export still match the screen.

   Save the screenshots under `docs/design/erd-view-readability/` and reference them in Implementation notes.
3. `claude plugin validate .`
4. Commit and push to `origin dev`.

---

## Implementation notes

Built on `dev`. Everything in sections 2 to 7 is in, with the deviations and choices below.

### Commits
Contract, agents and config went in as the suggested first commit. The parser, layout module, template and tests are one
commit instead of two, because the render tests exercise the template and the layout module together and each half is
red without the other.

### Decisions the spec left open
- **Change sets.** No new op. A Group change on an existing entity is `rename` with Target `E-n.group` (class
  `breaking`); `add-entity` names its Group. Recorded in `changeset-format.md`.
- **Group with no `Group` bullet** when `## Groups` exists: warning `entity X: no Group`, and the entity lands in a
  trailing `Other` group. A `Group` bullet with no `## Groups` section: one warning, and groups are ordered by first
  appearance.
- **Mermaid fallback.** A `"LOOKUP: <TYPE>"` comment on an attribute sets `lookupType` when the field comes from the
  Mermaid block only.
- **Derived groups** use one breadth-first walk from all seeds at once, so a hub does not swallow the model; Core entities
  in a Core-only cycle seed the next group in ID order. On hub-and-spoke models the result is still uneven (the 84-entity
  test ERD gives a 27-table and a 16-table group next to several one-table groups). It is a notice, not a warning.
- **One `kindOf`.** `parse.mjs` imports `kindOf` from `layout.mjs`, which the template inlines, so there is one
  definition (an entity flagged `isLookup` is `Lookup` whatever its Kind says).

### Deviations from the spec
1. **Ports for a lower parent.** The spec says to connect the parent at its top when it is in the same or a lower row.
   Taken literally the child also leaves from its top and the line climbs around to come back down. I used child bottom to
   parent top, which is what every Core-to-Reference line is. Same row and adjacent columns use the facing sides; same row
   and not adjacent use top to top, as specified.
2. **Line jumps are small square bumps, not gaps.** A gap needs a second `M` in the path, and the spec requires
   `^M[\d.,-]+(L[\d.,-]+)+$`. `pts` keeps the clean route (tests run on it); `d` carries the bumps.
3. **`Compact (auto)` goes through the same engine.** Each connected component is one group and the longest-path layer is the
   tier (same layering and barycentre code as before). The old shelf-packed `layout()` is gone, which is what lets both modes
   share the router. Focus on 6 or fewer tables switches to it automatically.
4. **Gutter growth is capped.** The spec grows a gutter by 10 px per lane without limit; on the 84-entity ERD that made the
   diagram about 3,300 by 4,000 px, unreadable when fitted. Gutters grow by `maxLanes` (6) lanes, then lanes squeeze together
   (never closer than 3.5 px). Constants moved into options: `base`, `maxLanes`, `laneMin`, `maxCols`.
5. **Connectors hidden by default means lazy routing.** Above 80 relationships (and when *Only for selected / matched* is
   chosen) the grid is laid out with tight gutters and nothing is routed. Selecting or matching a table routes just its
   lines into the existing gutters (`out.reroute(ids)`), spread evenly inside each gutter. The cost: when one gutter must
   carry more than about 20 selected lines (a hub such as `DHS_CASE` with 51), neighbouring lines can sit under 1 px apart
   and merge. Routing with all connectors visible has no such limit, and a randomized stress run (480 layouts; a trimmed version is in
   `layout.test.mjs`) found no diagonal, no table crossing and no shared stretch there.
6. **Band width adapts.** `BAND_BUDGET` 2600 is only the default; `layoutBest` tries 1600 to 5400 px and keeps whichever
   fits the viewport at the largest scale.
7. **Group headers sit above the connectors** (with a halo), so a stub never strikes through a group name.
8. **Export matches the screen.** The old export un-hid every hidden element, including all edge labels; it now keeps what is
   on screen and only restores field rows hidden by zoom level.
9. **Vertical lane positions.** Ports sit on whole pixels (even for bottom ports, odd for top ports) and vertical lanes sit
   on a per-band fraction (.25/.5/.75). The randomized run found same-x collisions between stubs and between adjacent
   bands without this.

### Fit scale
On the 84-entity test ERD, fitted in a 1250 by 720 window: old layout 0.52, Compact (auto) about 0.47, Grouped about 0.44.
The grouped grid is inherently sparser (aligned tiers, frames, headers). Names-only boxes stay readable by zooming
a little or by the Group filter; Compact (auto) is there for the densest view.

### Tests
`node --test "tools/erd-view/test/*.test.mjs"`: 34 pass. `layout.test.mjs` covers every item in section 5, plus the lazy
`reroute` path and, when Playwright and Chromium are installed, the rendered viewer (edge `d` values are M/L only in both
layouts, four frames, LK markers, no page errors); that test skips itself otherwise. `parse.test.mjs` is unchanged.
`claude plugin validate .` passes. Plugin version is now 0.4.0, and the ERD view module row in the README is v0.2.

### Screenshots (`docs/design/erd-view-readability/`)
Connectors are forced on in all of them so the routing can be checked by eye.

| Model | Light, all fields | Light, names only | Dark, all fields | Dark, names only |
|---|---|---|---|---|
| Grouped fixture (17 tables, 4 groups) | [png](erd-view-readability/grouped-light-all-fields.png) | [png](erd-view-readability/grouped-light-names-only.png) | [png](erd-view-readability/grouped-dark-all-fields.png) | [png](erd-view-readability/grouped-dark-names-only.png) |
| Baseline (14 tables, groups inferred) | [png](erd-view-readability/baseline-light-all-fields.png) | [png](erd-view-readability/baseline-light-names-only.png) | [png](erd-view-readability/baseline-dark-all-fields.png) | [png](erd-view-readability/baseline-dark-names-only.png) |
| Synthetic 150 tables, 13 groups | [png](erd-view-readability/large-150-light-all-fields.png) | [png](erd-view-readability/large-150-light-names-only.png) | [png](erd-view-readability/large-150-dark-all-fields.png) | [png](erd-view-readability/large-150-dark-names-only.png) |

### Known limits
- A connector between groups in different bands can have up to ten segments, and where it crosses a group frame it
  also crosses the frame's border.
- With all connectors on, a 150-table model with 258 relationships is a dense bundle; that is why the default hides them.
- Derived groups on hub-and-spoke models are uneven (see above). Adding `## Groups` fixes it.
