# project-terrarium

A Claude Code plugin for maintaining software delivery projects. You install it into a
project-specific repo (e.g. the MN DHS engagement repo). That repo holds the context MD files
and receives the outputs.

## Modules

| Module | Command | Status |
|---|---|---|
| ERD build | `/project-terrarium:erd-build` | v0.2 |
| ERD maintain | `/project-terrarium:erd-maintain` | v0.2 |
| ERD view (ERD.md to interactive HTML) | `/project-terrarium:erd-view` | v0.1 |

Status is the module's own version; the plugin version is in `.claude-plugin/plugin.json`.

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
(`[S2 @00:14:32]`, `[S5 slide 4]`), which is what makes incremental maintenance possible.

## ERD maintain workflow

```
discover new/changed ─► Gate A ─► stage ─► erd-analyst ─► change set ─► Gate C ─► erd-analyst ─► appian-erd-reviewer ─► Gate B
(since the ledger       confirm   (new     (maintain)    erd/changes/   accept/   (apply,        (scope: delta)          (as in build)
 watermark)             sources   S-IDs)                 <RUN>-…        reject    Version+1)
```

New and changed sources (meeting transcripts, `.pptx`/`.pdf` slide decks, SharePoint docs) are
found by comparing against the source ledger. The analyst proposes a **change set** (additive /
modifying / breaking / conflict ops); only the ops you accept are applied, IDs stay stable, and
nothing is deleted (retired items are marked deprecated). If nothing is new, the run writes nothing.

- **Committed:** `erd/sources.md` (the global source ledger, metadata only) and `erd/changes/`
  (change sets). Neither may contain source text.
- **Not committed:** `.project-terrarium/staging/`, which holds raw source text.
- Not supported yet: audio/video transcription (drop a `.vtt` in `local_inputs`), OCR of image-only slides.

## ERD viewer

Large ERDs don't render well as a Mermaid block. `tools/erd-view/` turns `ERD.md` into one self-contained
HTML file (no network, no dependencies, Node 18+) with pan/zoom, minimap, search by entity or column,
filters by kind and sensitivity, an N-hop focus mode, a detail panel with fields and citations, and SVG/PNG export.

```bash
node tools/erd-view/erd-view.mjs path/to/erd/ERD.md        # writes path/to/erd/ERD.html
node tools/erd-view/erd-view.mjs ERD.md -o out.html --open
```

Or run `/project-terrarium:erd-view`. `ERD.html` is git-ignored because it embeds the ERD text.
Tests: `node --test "tools/erd-view/test/*.test.mjs"`.

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
- **Maintain fixtures:** `examples/fixtures/baseline/` holds a clean v1 `ERD.md` and its `sources.md`.
  `examples/sample-project/transcripts/` has a follow-up transcript and a 5-slide deck that should
  produce the ops listed in `examples/fixtures/maintain-expected.md`. To test:
  1. copy `examples/fixtures/baseline/{ERD.md,sources.md}` into `examples/sample-project/erd/`
  2. from `examples/sample-project`, run `claude --plugin-dir ../..`
  3. run `/project-terrarium:erd-maintain`
  4. compare the change set with `maintain-expected.md`
