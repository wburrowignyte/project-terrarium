# Appian ERD review format

The `appian-erd-reviewer` returns exactly this document as its final message. The orchestrator
saves it verbatim to `<erd_dir>/reviews/<YYYY-MM-DD>-appian-review[-r<round>].md`.

````markdown
# Appian architecture review: <Project> ERD v<version>

| | |
|---|---|
| Reviewed | <YYYY-MM-DD> |
| ERD version | <n> |
| Round | <1 or 2> |
| Verdict | **Approve** / **Approve with changes** / **Rework** |
| Findings | <n> High · <n> Medium · <n> Low |

## Verdict rationale
2–4 sentences. "Rework" means at least one High finding undermines the core structure.
"Approve with changes" means the findings are fixable without restructuring.
"Approve" means no High findings and Medium findings are optional or deferred.

## Risk register
| ID | Sev | Category | Entities | Risk | Recommendation | Reference |
|---|---|---|---|---|---|---|
| F-1 | High | Relationships | E-3, E-5 | <what is wrong and why it matters in Appian> | <specific, actionable change> | <Appian doc URL or checklist §> |

(Categories: Keys, Relationships, Normalization, Naming/Limits, Volume/Sync, Security,
Traceability. Order by severity, then entity. IDs restart at F-1 for each review.)

## Round-2 only: disposition of prior findings
| Prior ID | Analyst response | Resolved? | Note |
|---|---|---|---|

## Strengths
Up to 3 bullets: what is sound and should be preserved.

## Questions for the architect/lead
Decisions the reviewer can't settle from the sources (capability tier, DB vendor, integration pattern).
````
