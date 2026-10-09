---
name: setup
description: Configure the project-terrarium plugin for this project repo — write project-terrarium.yaml (project prefix, target DB, context MD locations, SharePoint/Teams source hints, output and staging paths), git-ignore the staging area, and verify the Microsoft 365 connector and Appian docs tools are reachable. Run once per project repo before /project-terrarium:erd-build.
disable-model-invocation: true
---

# Setup

Materialize this plugin's per-project configuration in the **current repo** (the project repo,
not the plugin). The plugin itself ships no per-project values.

Work one question at a time. Explore first, propose values, and confirm before you write.

## 1. Explore

- Look for an existing `project-terrarium.yaml`. If one exists, show it and ask what to change.
- Find likely context MD files: Glob `**/*.md`, excluding `node_modules`, `.git`, and the staging dir. Look for
  `CONTEXT.md`, `glossary*`, `domain*`, `docs/context/**`, `outputs/CONTEXT.md`. Propose `context_paths` globs.
- Check that the Microsoft 365 connector tools are available (`outlook_calendar_search`,
  `sharepoint_search`, `read_resource`). If they aren't, tell the user to connect the Microsoft 365 connector
  in their Claude connector settings. `local_inputs` still works without it.
- Check for `search_appian_knowledge_sources` (Appian docs MCP). It's optional; the reviewer falls back to its checklist.

## 2. Ask (one at a time)

1. Project name and **Appian application prefix** (e.g. `DHS`).
2. **Target database** (Oracle / MySQL / SQL Server / PostgreSQL / unknown). Oracle enables the 30-char rule.
3. **Appian capability tier** if known (Standard / Advanced / Premium / unknown). This drives sync-volume findings.
4. Confirm the `context_paths` globs.
5. **Teams meeting series** to pull transcripts from (subject keywords, e.g. "DHS Data Workshop").
6. **SharePoint**: pinned folder name(s) to narrow searches, and doc topics to search
   (e.g. "data dictionary", "requirements", "business rules").
   6b. **Slide decks**: where are they uploaded? (folder names, optional; narrows the pptx/pdf search)
7. Output dir (default `erd`).

## 3. Write

`project-terrarium.yaml`:

```yaml
# project-terrarium configuration — safe to commit (no secrets, no source content)
project:
  name: "MN DHS <program>"
  prefix: "DHS"
  database: "Oracle"        # Oracle | MySQL | SQL Server | PostgreSQL | unknown
  appian_tier: "unknown"    # Standard | Advanced | Premium | unknown
  # lookup_table: "DHS_LOOKUP"   # name for the shared lookup table (default <prefix>_LOOKUP); its Kind must be Lookup

context_paths:
  - "docs/context/**/*.md"

sharepoint:
  meeting_series:           # calendar subject keywords used to find meetings and their transcripts
    - "Data Workshop"
  transcript_folders: []    # optional: folders holding exported .vtt/.docx transcripts
  folders: []               # optional: pinned folders for doc search
  deck_folders: []          # optional: folders where slide decks are uploaded (narrows pptx/pdf search)
  doc_queries:              # content searches for supporting documents
    - "data dictionary"
    - "business requirements"

local_inputs: ".project-terrarium/inputs"   # manually downloaded transcripts/docs (git-ignored)
staging_dir: ".project-terrarium/staging"   # extracted source text per run (git-ignored)

outputs:
  erd_dir: "erd"

maintain:
  lookback_days: 3          # overlap before the ledger watermark when searching remote sources
  auto_accept: []           # change-set classes accepted without asking, e.g. [additive]
```

Add to `.gitignore` (create it if absent, and don't duplicate existing lines):

```
# project-terrarium: raw source material may contain PII/PHI
.project-terrarium/staging/
.project-terrarium/inputs/
```

Create `.project-terrarium/inputs/`, `<erd_dir>/reviews/` and `<erd_dir>/changes/` if they're missing.

## 4. Verify

- `git check-ignore .project-terrarium/staging/x` succeeds.
- If the M365 connector is available, run one `outlook_calendar_search` for the first meeting series
  (limit 3) and report how many events were found and whether they have `meetingTranscriptUrl`.
  Don't read transcript content during setup.
- Finish by telling the user to run `/project-terrarium:erd-build`, and `/project-terrarium:erd-maintain` for later updates.
