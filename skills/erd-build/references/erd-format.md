# ERD.md format (the contract)

`ERD.md` is the canonical, git-tracked data model for the project. The `erd-analyst` writes it,
the `appian-erd-reviewer` reads it, and `erd-maintain` diffs new sources against it and edits it only through accepted change sets. Follow this
structure exactly: section order, heading text, and table columns are what later runs parse.

## Rules

- **Logical model, Appian-shaped.** Model entities as they will become Appian record types
  backed by database tables. Follow the naming conventions below.
- **Every entity, field, and relationship carries a citation.** A citation is a source id from
  the source ledger (`sources.md`, next to `ERD.md`) plus a locator. Citations resolve against the
  ledger, never against a per-run manifest. Multiple citations are space-separated. Source IDs are
  permanent: a superseded source keeps its ID, so old citations stay valid.
- **No citation means it's an assumption.** If you add something the sources don't support
  (audit fields, a reference table implied by "status"), cite `ASSUMPTION` and list it under
  *Assumptions*. Standard platform fields (`id`, audit fields) may cite `CONVENTION`.
- **Never put PII/PHI values in the ERD.** Describe fields (e.g. "client SSN"), never example
  data from transcripts.
- **Never delete; deprecate.** Retired entities, fields, relationships, assumptions and questions
  stay in the document and are marked per *Deprecation* below.
- **Groups are stable.** Every entity except the shared lookup belongs to one Group, listed in
  `## Groups`. Don't rename or reorder Groups without a reason recorded in the Change log.
- **Shared lookup.** One table per application, `<PREFIX>_LOOKUP`, holds every enumeration with
  3+ values, each under its own `LOOKUP_TYPE`. Use a dedicated `<ENTITY>_STATUS` or reference table
  **only** when the values carry extra attributes or relationships (for example allowed
  transitions), and say why in that entity's Purpose.
- **Stable IDs.** Each entity has an ID `E-<n>`, each relationship `R-<n>`, each question
  `Q-<n>`, each assumption `A-<n>`. Never renumber existing IDs; append new ones.

## Citation forms

| Form | Used for |
|---|---|
| `[S<n> @HH:MM:SS]` | transcript, by timestamp |
| `[S<n> §turn <k>]` | transcript without timestamps, by speaker turn (`k` is the 1-based turn in the staged file; consecutive lines by the same speaker are one turn) |
| `[S<n> §Section]` | document, by section |
| `[S<n> slide <k>]` | slide deck, by 1-based slide number |
| `ASSUMPTION` / `CONVENTION` | no source (see above) |

## Deprecation

Nothing is ever deleted.

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

## Naming conventions

Use these unless the project config or a context MD file says otherwise. If they conflict, follow the project and note it.

| Thing | Convention | Example |
|---|---|---|
| Table | `<PREFIX>_<ENTITY>`, UPPER_SNAKE, singular, ≤30 chars if DB is Oracle | `DHS_CASE` |
| Column | UPPER_SNAKE; PK `ID`; FK `<REFERENCED_ENTITY>_ID`; boolean `IS_<X>` | `CASE_STATUS_ID` |
| Record type | `<PREFIX> <Entity Name>` (Title Case) | `DHS Case` |
| Record field | camelCase; PK `id`; FK `<entity>Id`; boolean `is<X>`; `<x>Date` / `<x>At` | `caseStatusId` |
| Status/ref table | `<ENTITY>_STATUS`, never a bare `STATUS` | `DHS_CASE_STATUS` |
| Shared lookup | `<PREFIX>_LOOKUP` (one per application) | `DHS_LOOKUP` |

Field types: use Appian types: `Integer`, `Decimal`, `Text`, `Extra Long Text`, `Boolean`,
`Date`, `Date and Time`, `User`, `Group`, `Document`.

## Shared lookup table

`<PREFIX>_LOOKUP` has Kind `Lookup` and no Group. Its columns are fixed:

| Column | Type | Notes |
|---|---|---|
| `ID` | Integer | PK |
| `LOOKUP_TYPE` | Text | code-list name, for example `CASE_TYPE` |
| `CODE` | Text | |
| `LABEL` | Text | |
| `SORT_ORDER` | Integer | |
| `IS_ACTIVE` | Boolean | |

plus the audit fields (cite `CONVENTION`).

- An FK to it uses the column `<CONCEPT>_ID` and the Key cell **`FK→LOOKUP:<LOOKUP_TYPE>`**
  (for example `FK→LOOKUP:CASE_TYPE`). The viewer and the reviewer both rely on this exact token.
- Under the LOOKUP entity, add one small seed table per `LOOKUP_TYPE`, each preceded by a
  `**<LOOKUP_TYPE>**` line. They come after the field table, because only the first table in an
  entity section is read as its fields.
- The Relationships table **still lists** a `many-to-one` row for every LOOKUP FK, because Appian
  needs one relationship per FK. Only the diagram drops the line: the viewer marks the referencing
  field inside its table instead.
- The project config can override the name with `project.lookup_table` in `project-terrarium.yaml`. This tells the
  analyst what to call the table; the viewer and reviewer recognise it by Kind `Lookup` (or a name ending `_LOOKUP`), so
  give a renamed table Kind `Lookup`.

## Document structure

````markdown
# <Project name>: Entity Relationship Diagram

| | |
|---|---|
| Version | <n> (increment on every write) |
| Last updated | <YYYY-MM-DD> |
| Application prefix | <PREFIX> |
| Target database | <Oracle / MySQL / SQL Server / PostgreSQL / unknown> |
| Sources | See `sources.md` (S1–S<n>) |
| Status | Draft / Reviewed: <verdict> |

## Summary
2–5 sentences: the business domain covered, the core entities, and what's still unsettled.

## Groups

| Order | Group | Description |
|---|---|---|
| 1 | Household | The family unit and its members |
| 2 | Application & Eligibility | Requests for assistance and their determinations |

(`Order` is left-to-right placement in the diagram. Give groups with the most cross-group
relationships adjacent orders. Aim for 3–7 groups of 2–8 tables. Group by function (Case,
Provider, Payment) and keep a Core table's dedicated children (its notes, history, status table) in
its group.)

## Diagram

```mermaid
erDiagram
    DHS_CASE ||--o{ DHS_CASE_PARTICIPANT : "has"
    DHS_CASE {
        int ID PK
        int CASE_TYPE_ID FK "LOOKUP: CASE_TYPE"
        string CASE_NUMBER UK
    }
```
(Use table names as Mermaid entity names. List every field with its type, plus PK, FK, or UK
markers. Use crow's-foot cardinality matching the Relationships table. Emit entity blocks in
Group order, then Core, Junction, Reference, History/Audit within a group. **Omit relationship
lines that target the LOOKUP table**, and mark each LOOKUP FK attribute with a quoted comment as
shown. The LOOKUP entity block goes last.)

## Entities

### E-1 DHS Case (`DHS_CASE`)
- **Purpose:** <one sentence>
- **Kind:** Core | Reference | Junction | History/Audit | Lookup (only the shared lookup table)
- **Group:** <group name from ## Groups>
- **Est. volume:** <rows / growth if sources say; else "unknown">
- **Sensitivity:** None | PII | PHI | FTI | CJI (mark the highest present)
- **Sources:** [S2 @00:05:10] [S1 §Case lifecycle]

| Field | Column | Type | Req | Key | Description | Sources |
|---|---|---|---|---|---|---|
| id | ID | Integer | Y | PK | Surrogate key | CONVENTION |
| caseNumber | CASE_NUMBER | Text(20) | Y | UK | Human-facing case number | [S2 @00:06:02] |
| caseTypeId | CASE_TYPE_ID | Integer | Y | FK→LOOKUP:CASE_TYPE | Type of case | [S2 @00:07:40] |
| householdId | HOUSEHOLD_ID | Integer | Y | FK→E-2 | Owning household | [S2 @00:07:55] |

(Repeat for every entity. For reference tables, list the seed values below the table when the sources give them.)

## Relationships

| ID | From (many/child side) | To (one/parent side) | Cardinality | FK field | Description | Sources |
|---|---|---|---|---|---|---|
| R-1 | E-3 DHS Case Participant | E-1 DHS Case | many-to-one | caseId | A case has many participants | [S2 @00:09:15] |

(Cardinality is one of `many-to-one`, `one-to-one`. Each row implies the inverse
`one-to-many` relationship on the parent record type. Express many-to-many as a junction entity with two `many-to-one` rows.)

## Assumptions
| ID | Assumption | Affects | Why |
|---|---|---|---|

## Open questions
| ID | Question for stakeholders | Affects | Raised by |
|---|---|---|---|

## Out of scope / deferred
Bullets for concepts heard in the sources but deliberately not modeled, with the reason.

## Review responses
(Added only after an Appian architecture review. One row per finding sent back.)
| Finding | Response | Change made |
|---|---|---|

## Change log
| Version | Date | Change set | Summary |
|---|---|---|---|
| 3 | 2026-10-08 | changes/2026-10-08-changeset.md (CS-1–CS-9; 7 accepted) | +E-12 Provider Capacity; authorizedHours → Decimal; Q-2 resolved |

(Every write adds one row. `erd-build` writes Change set `full build`; revise mode writes
`review <file>`; `erd-maintain` apply writes the change set path and accepted count.)
````
