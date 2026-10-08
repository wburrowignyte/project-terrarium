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

## 4. Local fallback

Also include any files under `local_inputs` from the config (default
`.project-terrarium/inputs/`). This covers transcripts the user downloaded manually.

## 5. Confirm before staging

Show the user one compact candidate table (id, kind, title, date, location) and ask them
to confirm or prune it **before** reading full content. Don't read everything and then ask.

## 6. Stage

Write each remote source's extracted text to `<staging_dir>/<run-date>/S<n>-<slug>.md`, with a
header of title, URI, date, and attendee count (**not** names unless the user asks). For
transcripts, keep the speaker labels and timestamps, because citations point to `@HH:MM:SS`.

Write `<staging_dir>/<run-date>/sources-manifest.md`:

```markdown
# Sources: <run-date>
| ID | Kind | Title | Date | Location | Staged file |
|---|---|---|---|---|---|
| S1 | context-md | Domain glossary | — | docs/context/glossary.md | (in repo) |
| S2 | transcript | Eligibility data workshop | 2026-09-30 | meeting-transcript:///events/… | S2-eligibility-data-workshop.md |
| S3 | sharepoint-doc | MAXIS data dictionary v4 | 2026-08-12 | file:///… | S3-maxis-data-dictionary.md |

## Not included
- <title>: no transcript recorded / user excluded / unreadable
```

Source IDs restart at S1 for each run. The manifest is the key the ERD's citations resolve against.

## Data handling

These sources can contain client PII/PHI (names, case numbers, SSNs, medical details).
- Staged text stays in the gitignored staging directory. **Never** copy it into `erd/`.
- Don't echo transcript passages into chat beyond what's needed to confirm sources.
- The ERD describes *fields*, never *values*.
