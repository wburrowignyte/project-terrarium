# Change-set format (the contract)

A change set is the proposal `erd-analyst` (maintain mode) writes when new sources arrive. It lives
at `<erd_dir>/changes/<RUN>-changeset.md` and is committed. `erd-maintain` shows it to the user at
Gate C, records the decisions in it, and then `erd-analyst` (apply mode) applies only the accepted
ops to `ERD.md`. Follow this structure exactly: column order and heading text are what later runs parse.

## Rules

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
  - Any op that targets an element in an **Active** decision's Affects (in `DECISIONS.md`), or falls under a
    `global` decision, is `conflict`.
- **Target:** existing stable IDs, written as `E-3`, `E-3.fieldName`, `R-5`, `A-2` or `Q-1`. New
  elements get provisional IDs `E-new-<k>`, `R-new-<k>`, `A-new-<k>`, `Q-new-<k>`; apply mode
  replaces them with the next free IDs.
- **Evidence:** citations from the new sources only, in the forms from `erd-format.md`
  (`[S<n> @HH:MM:SS]`, `[S<n> §Section]`, `[S<n> slide <k>]`).
- **Supersedes:** the existing citation(s) the change overrides. It is **required** for
  `modifying`, `breaking` and `conflict` ops. `[DEC-<n>]` is a valid entry: it marks an op that reverses a
  Technical Decision, and apply mode sets that decision's Status when the op is accepted.
- **Conflict ops** follow the existing rule: the latest stated decision wins, and DHS/state
  stakeholders win over vendor speculation. Every conflict op is paired with a `raise-question`
  op that cites both sides, so the user can choose "ask instead of change". Write
  `Pairs with CS-<n>` in the question's Change cell (and `Pairs with CS-<m>` in the conflict's).
  **A conflict-paired question is never auto-accepted** and is decided together with its conflict
  op: accept one or the other, not both.
- **Batching:** many `add-citation` ops may be combined into one row whose Target lists several
  IDs. This keeps the table readable.
- **Decision column:** `pending` | `accepted` | `rejected: <reason>`. Only the orchestrator
  writes it, at Gate C.
- **Re-proposal rule:** before proposing, read every prior file in `<erd_dir>/changes/`. Don't
  re-propose an op that was `rejected` unless the new Evidence comes from a source ID **higher**
  than every ID in the rejected op's Evidence. If you skip one, list it under *Not proposed*.
- **Rejected ops stay in the file** with their reason. Nothing is deleted.
- **No PII/PHI values**, same as the ERD. No source text beyond a short paraphrase of the change.

- **Group:** every `add-entity` op names the entity's Group (an existing one from `ERD.md`'s
  `## Groups`, or a new one with a description). A Group change on an existing entity is a
  `rename` op with Target `E-n.group` (breaking class), so no new op is needed.

## Document structure

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
| CS-1 | additive | add-entity | E-new-1 CCA Provider Capacity (`CCA_PROVIDER_CAPACITY`) | Group: Provider. Licensed slots per provider per age group; fields: providerId FK→E-6, ageGroupId FK→E-new-2, licensedSlots Integer | [S5 slide 4] | — | High | pending |
| CS-2 | modifying | modify-field | E-8.authorizedHoursPerWeek | Type Integer → Decimal(5,2) | [S4 @00:03:10] | [S3 @00:06:30] | High | pending |
| CS-3 | conflict | modify-relationship | R-7 | … Pairs with CS-4 | [S4 @00:05:02] | [S3 @00:05:12] | Medium | pending |
| CS-4 | additive | raise-question | Q-new-1 | Ask instead of change: R-7 cardinality, citing both sides. Pairs with CS-3 | [S4 @00:05:02] [S3 @00:05:12] | — | — | pending |
| CS-5 | additive | raise-question | Q-new-2 | Slide 6 shows a legacy data model image not extracted; confirm whether it adds entities | [S5 slide 6] | — | — | pending |

## Field detail
(One `### CS-n` block for each add-entity, giving the full field table in erd-format columns. Omit this section if there are none.)

## Not proposed
Bullets for content in the new sources that was deliberately not turned into ops (already modeled, out of scope, or a previously rejected op with no new evidence: name the CS ID and file).
````
