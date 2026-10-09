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

## 2. Meeting transcripts (SharePoint files)

Transcripts are **files in SharePoint/OneDrive**, not calendar events. The expected team practice:
after a Teams meeting, download its transcript (Teams/Stream → Transcript → Download `.docx`, or
`.vtt`) and save it to the configured transcript folder. Teams doesn't store a standalone transcript
file next to the recording. Connector tools used: `sharepoint_search`, `sharepoint_folder_search`,
`read_resource`.

If both `sharepoint.transcript_folders` and `sharepoint.transcript_queries` are empty, skip remote
transcript discovery with a one-line notice. `local_inputs` still works.
If the deprecated `sharepoint.meeting_series` key is present, treat its entries as extra
`transcript_queries` and print once per run: "`sharepoint.meeting_series` is deprecated; rename it
to `transcript_queries`".

1. **Resolve folders.** For each `transcript_folders` entry, `sharepoint_folder_search(name)`. The
   result can include **files** whose names match as well as folders. Keep only folder hits (a hit
   whose `webUrl` has no file extension, or that `read_resource` lists as a folder). If more than one
   folder matches, show them at Gate A with their paths and let the user pick. If none match,
   report it.
2. **Search.** For each `fileType` in `docx`, `vtt`, `txt`:
   - with folders: `sharepoint_search(query = <project name or each transcript_query>, fileType, folderName = <folder>)`
   - with no folders: `sharepoint_search(query = <each transcript_query>, fileType)`
   - add `afterDateTime` / `beforeDateTime` from the run scope or the user's filter argument
   - page with `offset` (`nextOffset`) until it's exhausted
   - de-duplicate hits by URI (search hits and listed files are one pool)

   `folderName` is a partial match on the folder name, so it can return files from other sites or
   libraries. Check each hit's `webUrl` against the resolved folder path and drop hits outside it.
   **Search alone can miss transcripts.** Its results vary between calls and it can omit files that are
   really there. So also run a **listing pass** for every resolved transcript folder:
   - `read_resource` on the folder URI lists its entries. Recurse into each subfolder entry (meetings are
     often saved one subfolder per session), up to 3 levels deep.
   - Keep `.docx`, `.vtt` and `.txt` entries. Ignore everything else, and report `.mp4`/`.m4a` entries
     under Not included (step 5).
   - A listing gives name, size and URI but **no modified date**. Merge by URI with the search hits. For a
     listed file with no search hit, get its `lastModifiedDateTime` with
     `sharepoint_search(query = <file name>, folderName = <its folder>)`. If that finds nothing, show the
     date as unknown at Gate A and leave the `mod:` fingerprint blank until the file is read.
   - With no `transcript_folders` configured there is nothing to list, so discovery rests on the search
     alone. Say so in the Gate A notice.
3. **Classify a hit as a transcript** when it's in a transcript folder, **or** its name or first page
   has transcript shape: speaker-labelled utterances with timestamps (`0:03:12`, `00:03:12.000 -->`).
   Anything else that matched a query is a candidate *document*, not a transcript. Handle it under §3.
   A listed `.docx` in a transcript folder whose name has no transcript marker (`transcript`,
   `transcription`, `Meeting Recording`) can be a supporting document, such as a question guide saved
   in the same meeting subfolder. Show it at Gate A as "unclassified" and let the user choose; don't read it
   to decide.
4. **Meeting date.** Parse it from the filename (`YYYY-MM-DD`, `YYYYMMDD`, `MMDDYYYY` after a
   `_`, or Teams' default `<Meeting title>-<yyyymmdd_hhmmss>-Meeting Transcript.docx`). Otherwise use
   `lastModifiedDateTime` and show the date as `~<date> (modified)` at Gate A.
5. **Recordings.** Don't search for `mp4`/`m4a`. If a folder listing turns them up, list them under
   Not included.
6. **Read** confirmed hits with `read_resource`, following the paging footer (`startPage` hint or
   `[pages a–b of N]`) until the file is complete.
7. **`.vtt` hits.** The connector's plain-text list doesn't include `.vtt`. Try one read; if it
   returns no text, list the hit under "Not included: `.vtt` not readable by the connector; export the
   transcript as .docx or drop the .vtt in `<local_inputs>`". Local `.vtt` files are read from disk and
   always work.

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
from pptx.enum.shapes import MSO_SHAPE_TYPE
VISUAL = (MSO_SHAPE_TYPE.PICTURE, MSO_SHAPE_TYPE.CHART, MSO_SHAPE_TYPE.GROUP)
for k, slide in enumerate(Presentation(sys.argv[1]).slides, 1):
    title = slide.shapes.title.text_frame.text.strip() if slide.shapes.title is not None else ""
    print(f"## Slide {k}: {title or '(untitled)'}")
    words = len(title.split())
    for sh in slide.shapes:
        if sh.has_text_frame and sh != slide.shapes.title:
            print(sh.text_frame.text)
            words += len(sh.text_frame.text.split())
        if getattr(sh, "has_table", False) and sh.has_table:
            for row in sh.table.rows:
                line = " | ".join(c.text for c in row.cells)
                print(line)
                words += len(line.split())
    if words < 15 and any(sh.shape_type in VISUAL for sh in slide.shapes):
        print("[visual content not extracted]")
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

**Transcript normalization.** A `.docx` transcript arrives as converted text, and the connector
flattens it: utterances run together as `<Speaker>  <H:MM:SS or M:SS>  <text>`, with no reliable line
breaks. Split on each speaker/timestamp marker and normalize to one line per utterance,
`[HH:MM:SS] Speaker: text` (zero-pad the timestamp). A `.vtt` normalizes the same way, using the cue
start time. If a transcript has no timestamps, stage it as is and add `no timestamps; cite by §<speaker
turn n>` to its header. The analyst then cites `[S<n> §turn <k>]`.

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
| S2 | transcript | Eligibility data workshop | 2026-09-30 | file:///…/Eligibility%20Data%20Workshop-20260930_140000-Meeting%20Transcript.docx | S2-eligibility-data-workshop.md |
| S3 | sharepoint-doc | MAXIS data dictionary v4 | 2026-08-12 | file:///… | S3-maxis-data-dictionary.md |
| S4 | slide-deck | Provider design review | 2026-10-05 | file:///…/Provider%20review.pptx | S4-provider-design-review.md |

## Not included
- <title>: recording without a transcript file / `.vtt` not readable by the connector / user excluded / unreadable
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
| S2 | transcript | Data workshop | 2026-09-15 | file:///…/Data%20Workshop-20260915_140000-Meeting%20Transcript.docx | mod:2026-09-15T16:05Z | 2026-10-01 | S2-data-workshop.md | active |
| S4 | slide-deck | Provider design review v1 | 2026-10-02 | file:///…/Provider%20review.pptx | mod:2026-10-02T09:10Z | 2026-10-03 | S4-provider-design-review.md | superseded by S5 |
| S5 | slide-deck | Provider design review v2 | 2026-10-05 | file:///…/Provider%20review.pptx | mod:2026-10-05T16:22Z | 2026-10-08 | S5-provider-design-review.md | active |
```

- **Kind:** `context-md` | `transcript` | `slide-deck` | `sharepoint-doc` | `local-file`.
- **Fingerprint** (the prefix tells you how it was computed). The scheme depends on **how the
  source was found**, not where the file lives:
  - `git:<blob>` for every `context_paths` match: `git hash-object <path>`, first 7 characters.
  - `sha256:<first 12 hex>` for **anything under `local_inputs`**, even if git tracks it: `sha256sum`.
  - `mod:<lastModifiedDateTime>` for SharePoint items, transcripts included (from the search hit or `read_resource`).
- **Ingested:** the run date that first staged this version of the source.
- **Staged file:** relative to `<staging_dir>/<Ingested>/`, or `(in repo)` for context MDs.
- **Status:** `active` | `superseded by S<m>`.
- **Rows are sorted strictly by ID.**
- **Legacy rows.** Rows with a `meeting-transcript:///` Location and an `event:` fingerprint stay valid;
  IDs and citations never change. Discovery never re-reads a `meeting-transcript:///` Location. When a
  SharePoint transcript hit's title and meeting date match such a row, show it at Gate A as "probably
  already ingested as S<n>". If the user confirms, **relocate** the row: replace its Location and
  Fingerprint with the file's, keep its ID, Ingested date and Status, and don't stage or re-analyse
  it. If the user declines, the hit is a new source.
- **Matching:** a source is *known* if its **Location** is already in the ledger. If its
  Fingerprint matches the active row, it is unchanged. If the Fingerprint differs, it is *changed*:
  it gets a new ID, and the old row becomes `superseded by S<new>`.
- **IDs are never reused**, even when superseded. Old citations to a superseded ID keep resolving.
- **Staged text may be missing.** Staging is git-ignored and local, so `<staging_dir>/<Ingested>/<Staged file>`
  won't exist on another machine or a fresh clone. Treat a missing staged file as a normal case: don't
  fail and don't re-fetch. The citation stays recorded, and the agent notes `staged text unavailable for S<n>`.
- **Re-staging a known source** (e.g. a full rebuild): leave its ledger row unchanged and stage into
  the new run directory under the same `S<n>-<slug>.md` name.
- **Never** put attendee names, content excerpts or staged text in the ledger.

To allocate: take the next ID after the highest in the ledger. After staging, append the new rows
and update any superseded rows. If no ledger exists and no `ERD.md` exists, start at S1 and create
the ledger. If `ERD.md` exists without a ledger, migrate first (see the `erd-build` skill).

## Data handling

These sources can contain client PII/PHI (names, case numbers, SSNs, medical details).
- Staged text stays in the gitignored staging directory. **Never** copy it into `erd/`.
- Don't echo transcript passages into chat beyond what's needed to confirm sources.
- The ERD describes *fields*, never *values*.
