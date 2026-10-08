# project-terrarium

A Claude Code plugin for maintaining software delivery projects. You install it into a
project-specific repo (e.g. the MN DHS engagement repo). That repo holds the context MD files
and receives the outputs.

## Modules

| Module | Command | Status |
|---|---|---|
| ERD build | `/project-terrarium:erd-build` | v0.1 |
| ERD maintain (diff new meetings against the ERD) | — | planned |

## ERD build workflow

```
Teams transcripts ─┐
SharePoint docs  ──┼─► stage (git-ignored) ─► erd-analyst ─► ERD.md ─► appian-erd-reviewer ─► review
Context MD files ──┘        ▲ Gate A: confirm sources                     ▼ Gate B: send findings back?
                                                       erd-analyst (revise) ◄┘ (max 2 review rounds)
```

| Agent | Role | Writes |
|---|---|---|
| `erd-analyst` | Senior developer + business analyst. Turns the sources into a cited, Appian-shaped ERD. | `erd/ERD.md` |
| `appian-erd-reviewer` | Principal Appian architect. Reviews keys, relationships, normalization, Oracle and platform limits, sync volume, and security/PII. | nothing (read-only); the orchestrator saves its report to `erd/reviews/` |

The contract between the agents is [erd-format.md](skills/erd-build/references/erd-format.md).
The reviewer works from [appian-risk-checklist.md](skills/erd-build/references/appian-risk-checklist.md).

### Sources
- **Teams transcripts** come through the Microsoft 365 connector: calendar event → `meetingTranscriptUrl` → transcript.
  Exported `.vtt`/`.docx` files in SharePoint, or dropped into `.project-terrarium/inputs/`, also work.
- **SharePoint/OneDrive docs** (data dictionaries, requirements) come from content search, optionally narrowed to pinned folders.
- **Context MD files** come from globs in the consumer repo. Glossary terms set the ERD vocabulary.

All Microsoft 365 access is read-only. Raw source text is staged under `.project-terrarium/staging/`,
which is git-ignored because DHS transcripts may contain PII/PHI. Every ERD element cites its source
(`[S2 @00:14:32]`), which is what makes the planned maintenance module possible.

## Install (in the project repo)

```bash
claude plugin marketplace add <path-to-this-repo>
```
```bash
claude plugin install project-terrarium@project-terrarium-dev
```

Then, inside Claude Code in the project repo:
1. `/project-terrarium:setup` writes `project-terrarium.yaml` and the `.gitignore` entries.
2. `/project-terrarium:erd-build [topic] [since <date>]`

Prerequisites: the Microsoft 365 connector (for Teams/SharePoint). The Appian docs MCP
(`search_appian_knowledge_sources`) is optional; with it, the reviewer cites Appian docs.

## Develop / test

- `claude plugin validate .`
- `examples/sample-project/` is a synthetic consumer repo (child care assistance, no real data).
  Run `claude --plugin-dir <this repo>` from inside it, then `/project-terrarium:erd-build`.
- `examples/fixtures/flawed-ERD.md` is an ERD with 6 seeded defects (listed in its header comment) for
  testing the reviewer on its own.
