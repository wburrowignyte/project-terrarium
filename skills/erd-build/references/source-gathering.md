# Source gathering

Gather the inputs for an ERD run into the **gitignored staging directory**, along with a
manifest. The `erd-analyst` reads only what's staged, so the run is reproducible and every
citation resolves.

Use the **Microsoft 365 connector** for everything remote, and only its read tools. Never
send, upload, edit, move, or delete anything. If the connector tools are missing, tell the user to
connect the Microsoft 365 connector and fall back to local files (step 4).

## 1. Context MD files (consumer repo)

Glob each pattern in `context_paths` from `project-terrarium.yaml`. Stage the matches **by
reference**: record their repo-relative paths in the manifest and don't copy them, because they're
already under git. Glossary or domain files (`CONTEXT.md`, `glossary.md`, `domain*.md`) go first,
since they define the vocabulary the ERD should use.

## 2. Teams meeting transcripts (primary path)

Transcripts are reached through the meeting's **calendar event**, not as files:

1. `outlook_calendar_search` with `query` = each entry in `sharepoint.meeting_series` (or the
   user's filter argument), `afterDateTime` / `beforeDateTime` from the run scope, and
   `order: "newest"`. Page with `offset` until it's exhausted or you hit the scope limit.
2. `read_resource` each event's URI. Take the `meetingTranscriptUrl` field **verbatim**.
3. `read_resource` that `meeting-transcript:///events/...` URI. For a **recurring series**,
   append `?start=<iso>&end=<iso>` for that occurrence's window. Otherwise the connector returns
   only the most recent transcripts of the series.
4. If an event has no `meetingTranscriptUrl`, transcription wasn't on. Note it in the manifest as
   "no transcript" and move on.

**Fallback: transcript files in SharePoint/OneDrive.** Some teams save `.vtt`/`.docx` exports.
Run `sharepoint_search` with a **content** query (meeting title or project name) and
`fileType: "vtt"`, then `"docx"`. Narrow with `folderName` when the config pins
`sharepoint.transcript_folders`. Read the hits with `read_resource` (follow its
`startPage` footer hints until the file is complete).

## 3. SharePoint / OneDrive documents

For each entry in `sharepoint.doc_queries` (requirements, data dictionaries, policy manuals,
existing data models, legacy system specs), run `sharepoint_search` with a **content** query.
Narrow with `folderName` to the pinned `sharepoint.folders`. Prefer content search over
`sharepoint_folder_search` by name: folder names rarely match the project.
Spreadsheets that are data dictionaries are high-value: read them.

**Slide decks.** Run `sharepoint_search` with `fileType: "pptx"`, then `"pdf"`, using the content
queries from `doc_queries` plus the project name. Narrow with `folderName` from
`sharepoint.deck_folders`. Read the hits with `read_resource`, following the `startPage` hints.

## 4. Local fallback

Also include any files under `local_inputs` from the config (default
`.project-terrarium/inputs/`). This covers transcripts the user downloaded manually.

`.pptx` files here are extracted with `python-pptx`, run through Bash with `python3 -I`. If it's
unavailable, fall back to `markitdown`. If neither works, ask the user to export the deck to PDF.
Don't commit a script; run the extraction inline:

```bash
python3 -I - "<deck.pptx>" <<'PY'
import sys
from pptx import Presentation
for k, slide in enumerate(Presentation(sys.argv[1]).slides, 1):
    title = slide.shapes.title.text_frame.text.strip() if slide.shapes.title is not None else ""
    print(f"## Slide {k}: {title or '(untitled)'}")
    for sh in slide.shapes:
        if sh.has_text_frame and sh != slide.shapes.title:
            print(sh.text_frame.text)
        if getattr(sh, "has_table", False) and sh.has_table:
            for row in sh.table.rows:
                print(" | ".join(c.text for c in row.cells))
    if slide.has_notes_slide:
        print(f"**Notes:** {slide.notes_slide.notes_text_frame.text}")
    print()
PY
```

## 5. Confirm before staging

Show the user one compact candidate table (id, kind, title, date, location) and ask them
to confirm or prune it **before** reading full content. Don't read everything and then ask.

## 6. Stage

Write each remote source's extracted text to `<staging_dir>/<run-date>/S<n>-<slug>.md`, with a
header of title, URI, date, and attendee count (**not** names unless the user asks). For
transcripts, keep the speaker labels and timestamps, because citations point to `@HH:MM:SS`.

**Slide decks** stage as one `## Slide <k>: <title>` section per slide (1-based), then the body
text, tables, and the speaker notes as `**Notes:** <text>`. A slide with under ~15 words **and** a
picture/graphic shape gets the line `[visual content not extracted]`. Citations to a slide use
`[S<n> slide <k>]`. The analyst turns those into
open questions.

Write `<staging_dir>/<run-date>/sources-manifest.md`. It lists what was staged **this run**, using
the **global** IDs from the source ledger:

```markdown
# Sources: <run-date>
| ID | Kind | Title | Date | Location | Staged file |
|---|---|---|---|---|---|
| S1 | context-md | Domain glossary | — | docs/context/glossary.md | (in repo) |
| S2 | transcript | Eligibility data workshop | 2026-09-30 | meeting-transcript:///events/… | S2-eligibility-data-workshop.md |
| S3 | sharepoint-doc | MAXIS data dictionary v4 | 2026-08-12 | file:///… | S3-maxis-data-dictionary.md |
| S4 | slide-deck | Provider design review | 2026-10-05 | file:///…/Provider%20review.pptx | S4-provider-design-review.md |

## Not included
- <title>: no transcript recorded / user excluded / unreadable
```

## Source ledger

`<erd_dir>/sources.md` is the **global, append-only** source registry. It is committed and holds
metadata only. IDs are permanent and never reused. `erd-build` and `erd-maintain` both read and
write it. Citations in `ERD.md` resolve against it.

```markdown
# Source ledger

Global source registry for this ERD. IDs are permanent and never reused. Metadata only — no source content.

| ID | Kind | Title | Date | Location | Fingerprint | Ingested | Staged file | Status |
|---|---|---|---|---|---|---|---|---|
| S1 | context-md | Glossary | — | docs/context/glossary.md | git:3f2a9c1 | 2026-10-01 | (in repo) | active |
| S2 | transcript | Data workshop | 2026-09-15 | meeting-transcript:///events/… | event:AAMk…@2026-09-15T14:00Z | 2026-10-01 | S2-data-workshop.md | active |
| S4 | slide-deck | Provider design review v1 | 2026-10-02 | file:///…/Provider%20review.pptx | mod:2026-10-02T09:10Z | 2026-10-03 | S4-provider-design-review.md | superseded by S5 |
| S5 | slide-deck | Provider design review v2 | 2026-10-05 | file:///…/Provider%20review.pptx | mod:2026-10-05T16:22Z | 2026-10-08 | S5-provider-design-review.md | active |
```

- **Kind:** `context-md` | `transcript` | `slide-deck` | `sharepoint-doc` | `local-file`.
- **Fingerprint** (the prefix tells you how it was computed):
  - `git:<blob>` for in-repo files: `git hash-object <path>`, first 7 characters.
  - `event:<eventId>@<occurrenceStart>` for Teams transcripts.
  - `mod:<lastModifiedDateTime>` for SharePoint items (from the search hit or `read_resource`).
  - `sha256:<first 12 hex>` for local files: `sha256sum`.
- **Ingested:** the run date that first staged this version of the source.
- **Staged file:** relative to `<staging_dir>/<Ingested>/`, or `(in repo)` for context MDs.
- **Status:** `active` | `superseded by S<m>`.
- **Rows are sorted strictly by ID.**
- **Matching:** a source is *known* if its **Location** is already in the ledger. If its
  Fingerprint matches the active row, it is unchanged. If the Fingerprint differs, it is *changed*:
  it gets a new ID, and the old row becomes `superseded by S<new>`.
- **IDs are never reused**, even when superseded. Old citations to a superseded ID keep resolving.
- **Never** put attendee names, content excerpts or staged text in the ledger.

To allocate: take the next ID after the highest in the ledger. After staging, append the new rows
and update any superseded rows. If no ledger exists and no `ERD.md` exists, start at S1 and create
the ledger. If `ERD.md` exists without a ledger, migrate first (see the `erd-build` skill).

## Data handling

These sources can contain client PII/PHI (names, case numbers, SSNs, medical details).
- Staged text stays in the gitignored staging directory. **Never** copy it into `erd/`.
- Don't echo transcript passages into chat beyond what's needed to confirm sources.
- The ERD describes *fields*, never *values*.
