<!-- TEST FIXTURE: Technical Decisions log for erd-assist and erd-maintain testing. Synthetic data only.
     Written against examples/fixtures/baseline/ERD.md (IDs are real). Pair it with decisions/ERD-with-decs.md.
     DEC-2 is superseded, so it is not binding and is not cited in the ERD. -->

# Technical decisions

Binding design decisions for this ERD. Build, maintain and review runs must respect every **Active** row.
IDs are permanent and never reused. No PII/PHI, no source text.

| | |
|---|---|
| Last ID | DEC-4 |
| Active | 3 |
| Last updated | 2026-09-24 |

## Index
| ID | Date | Status | Affects | Rule |
|---|---|---|---|---|
| DEC-4 | 2026-09-24 | Active | E-2 R-2 | A household member belongs to exactly one household; never share members across households |
| DEC-3 | 2026-09-23 | Active | global | No free-text fields on reference tables; reference tables hold only ID and NAME |
| DEC-2 | 2026-09-22 | Superseded by DEC-4 | E-9.address | Keep provider contact details on the provider row, not in a separate table |
| DEC-1 | 2026-09-21 | Active | E-11.authorizedHoursPerWeek | Store authorized hours as whole-hour Integer |

## Decisions

### DEC-1 Authorized hours are whole hours
- **Status:** Active
- **Date:** 2026-09-21
- **Affects:** E-11.authorizedHoursPerWeek
- **Supersedes:** —
- **Origin:** assist session
- **ERD version:** 2
- **Decision:** Store authorized hours as whole-hour Integer.
- **Rationale:** The eligibility rules in the program overview authorize whole hours only.
- **Alternatives rejected:** Decimal hours (no current business need).

### DEC-2 Provider contact details stay on the provider
- **Status:** Superseded by DEC-4
- **Date:** 2026-09-22
- **Affects:** E-9.address
- **Supersedes:** —
- **Origin:** assist session
- **ERD version:** 2
- **Decision:** Keep provider contact details on the provider row, not in a separate table.
- **Rationale:** One address per provider in this release.
- **Alternatives rejected:** A provider location table (extra joins, no source asks for it).

### DEC-3 No free text on reference tables
- **Status:** Active
- **Date:** 2026-09-23
- **Affects:** global
- **Supersedes:** —
- **Origin:** assist session
- **ERD version:** 2
- **Decision:** No free-text fields on reference tables; reference tables hold only ID and NAME.
- **Rationale:** Free text on shared reference data invites PII and is hard to secure.
- **Alternatives rejected:** A DESCRIPTION column on every reference table.

### DEC-4 A household member belongs to one household
- **Status:** Active
- **Date:** 2026-09-24
- **Affects:** E-2 R-2
- **Supersedes:** DEC-2
- **Origin:** assist session
- **ERD version:** 2
- **Decision:** A household member belongs to exactly one household; never share members across households.
- **Rationale:** Record-level security is evaluated per household, and shared members would break it. This round also retires DEC-2, which no longer applies.
- **Alternatives rejected:** A household-membership junction table (many-to-many).
