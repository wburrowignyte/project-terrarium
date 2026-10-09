# DECISIONS.md format (the contract)

`<erd_dir>/DECISIONS.md` is the committed log of binding Technical Decisions for this ERD. `erd-assist` writes it.
`erd-build`, `erd-maintain` and the `appian-erd-reviewer` **read and respect** every Active decision.
The only other edit anyone makes to it is `erd-analyst` apply mode setting a Status when an accepted change-set op
supersedes a decision. Follow this structure exactly: the Index columns and the block bullets are what later runs parse.

## Rules

- **The Index Rule cell is the binding text.** One line, imperative, self-contained. Other agents read **only the
  Index**. The block holds the rationale and is read only when needed.
- **Index rows are newest first**, so `head_limit` keeps the most recent.
- **Status** is one of: `Active`, `Superseded by DEC-<m>`, `Superseded by CS-<n> (<changeset file>)`,
  `Revoked: <reason>`. The Index Status is authoritative. Keep the block's Status line in sync.
- **Affects** holds space-separated exact stable IDs: `E-n`, `E-n.fieldName`, `R-n`, `A-n`, `Q-n`, `Group:<name>`,
  `LOOKUP:<TYPE>`, or `global` (a modelling policy with no single target). Provisional IDs are never used.
- **Append-only. Never delete, never renumber, never rewrite a Rule.** To change a decision, add a new DEC that
  supersedes it, and set the old row's Status.
- **IDs are `DEC-<n>`**, permanent, never reused. The header's `Last ID` row holds the highest ID issued.
- **One DEC per distinct decision**, not per edit. A decision may change nothing in the ERD (for example "don't model X").
- **Origin** is one of `assist session`, `Q-n`, `F-n (<review file>)`, `CS-n (<changeset file>)`, optionally with a
  short parenthetical.
- **Header counts:** `Active` is the number of Index rows whose Status is `Active`. `Last updated` is the date of the
  last write.
- **Size management:** when the Index passes 300 rows, move the blocks of non-Active decisions to
  `<erd_dir>/decisions/archive-<YYYY>.md` (same block format). Their Index rows stay, so every ID still resolves.
- **No PII/PHI values. No source text** beyond a short paraphrase.
- **A missing `DECISIONS.md` is an empty log.** A missing file never fails a run.

## Canonical reads

Use these verbatim. Never read the whole file when one of them answers the question.

| Need | Read |
|---|---|
| All active rules | `Grep` pattern `^\| DEC-[0-9]+ \|[^|]*\| Active \|` on `DECISIONS.md` |
| Decisions touching an element | `Grep` pattern `^\| DEC-.*\bE-11\b` (the ID, word-bounded) |
| One decision in full | `Grep` pattern `^### DEC-4 ` with `-A 12` |
| Next free ID | the header's `Last ID` row |

## Using a decision in the ERD

- An element set by a decision cites `[DEC-<n>]` in its Sources cell or bullet (see `erd-format.md`). It may carry
  both source and DEC citations.
- A decision that changes nothing in the ERD has no citation to place. It is still binding through its Affects
  (or `global`).
- An **Active** decision overrides sources and conventions for its Affects. A newer source that contradicts it
  never silently wins: it becomes an open question (build, revise) or a `conflict` op with `Supersedes [DEC-n]`
  (maintain).

## Document structure

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

(Blocks follow the Index in ID order, oldest first, so a new block is appended at the end. `Supersedes` is `—` when
the decision replaces nothing. Block headings are `### DEC-<n> <short title>`, with a space after the number, which the
"one decision in full" read relies on.)
