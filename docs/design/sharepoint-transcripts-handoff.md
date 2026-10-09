# Handoff: source meeting transcripts from SharePoint, not Teams meetings

Resolves [wburrowignyte/project-terrarium#5](https://github.com/wburrowignyte/project-terrarium/issues/5)
(TD-1). **This file is the build spec.** If you hit a question it doesn't answer, choose the option most
consistent with the existing `erd-build` / `erd-maintain` prompts and record it under "Implementation
notes" at the end.

Work on branch `dev`. Commit in logical steps (suggested points are marked ✅). Push to `origin dev`.
Don't open a pull request unless the user asks.

---

## 1. Problem and decision

The Microsoft 365 connector can't reliably reach Teams meeting transcripts. The current primary path is
calendar event → `meetingTranscriptUrl` → `meeting-transcript:///events/…`, driven by
`sharepoint.meeting_series` and `outlook_calendar_search`, and it fails in practice.

**Decision:** treat transcripts as **files in SharePoint/OneDrive**, found with `sharepoint_search`
(and `sharepoint_folder_search` to resolve folders) and read with `read_resource` on `file:///…` URIs.
`local_inputs` stays as the manual fallback. Remove the calendar/meeting path entirely. Keep reading the
old config keys for one version as a deprecated alias (see §3).

This repo is prompts only (Markdown + YAML frontmatter, JSON manifests). Don't add code.

## 2. Facts about the connector the spec relies on

Verify these against the live tool descriptions before you write, and note any difference in
Implementation notes:

- `sharepoint_search(query, fileType?, folderName?, afterDateTime?, beforeDateTime?, author?, limit≤50, offset)`.
  The filters are ANDed. Results are paginated with `nextOffset`, and hits carry a `file:///…` URI and
  `lastModifiedDateTime`.
- `sharepoint_folder_search(name)` returns folder URIs. `read_resource` on a folder lists its contents.
- `read_resource` on `file:///…`:
  - **`.docx`** is read via PDF conversion and paginated, so follow the `startPage` footer hints.
  - **Plain text** is read for `.txt .csv .json .md .xml .html .log`. **`.vtt` is not on that list.**
    The builder must test whether a `.vtt` read returns text (see §7). If it doesn't, `.vtt` hits are listed under
    "Not included: `.vtt` not readable by the connector; export the transcript as .docx or drop the .vtt in
    `<local_inputs>`". Local `.vtt` files keep working because they're read from disk.
- Teams doesn't store a transcript as a standalone file next to the recording. A team gets a transcript
  file into SharePoint by **downloading it from the meeting (Teams/Stream → Transcript → Download .docx or
  .vtt) and saving it to a designated folder**. Document this as the expected team practice. Recording
  `.mp4` files in a `Recordings` folder are **never** transcribed. They're reported under Not included.

## 3. Config changes

New `sharepoint` block (setup template, sample config, README):

```yaml
sharepoint:
  transcript_folders:        # folders where meeting transcripts (.docx / .vtt / .txt) are saved
    - "Meeting Transcripts"
  transcript_queries:        # content/name keywords that identify project meetings, e.g. series titles
    - "Data Workshop"
  folders: []
  deck_folders: []
  doc_queries: [...]
```

- At least one of `transcript_folders` or `transcript_queries` is needed to find remote transcripts.
  If both are empty, remote transcript discovery is skipped with a one-line notice. `local_inputs` still works.
- **Deprecated `meeting_series`:** if it's present, treat its entries as extra `transcript_queries` and
  print once per run: "`sharepoint.meeting_series` is deprecated; rename it to `transcript_queries`". Remove
  the alias in the next minor version. Record that as a follow-up in Implementation notes.
- `examples/sample-project/project-terrarium.yaml`: rename to `transcript_queries: []` and keep
  `transcript_folders: []` with an updated comment. The sample still uses local transcripts only.

✅ Commit: config.

## 4. Discovery and staging (`skills/erd-build/references/source-gathering.md`)

Rewrite §2 as **"Meeting transcripts (SharePoint files)"**:

1. **Resolve folders.** For each `transcript_folders` entry, `sharepoint_folder_search(name)`. If more than one folder
   matches, show them at Gate A with their paths and let the user pick. If none match, report it.
2. **Search.** For each `fileType` in `docx`, `vtt`, `txt`:
   - with folders: `sharepoint_search(query = <project name or each transcript_query>, fileType, folderName = <folder>)`
   - with no folders: `sharepoint_search(query = <each transcript_query>, fileType)`
   - add `afterDateTime` / `beforeDateTime` from the run scope or the user's filter argument
   - page with `offset` until it's exhausted
   - de-duplicate hits by URI
3. **Classify a hit as a transcript** when it's in a transcript folder, **or** its name or first page has transcript
   shape: speaker-labelled lines with timestamps (`0:03:12`, `00:03:12.000 -->`). Anything else that
   matched a query is a candidate *document*, not a transcript, and the doc rules in §3 apply.
4. **Meeting date.** Parse the date from the filename (`YYYY-MM-DD`, `YYYYMMDD`, or Teams' default
   `<Meeting title>-<yyyymmdd_hhmmss>-Meeting Transcript.docx`). Otherwise use `lastModifiedDateTime`, and show the
   date as `~<date> (modified)` at Gate A.
5. **Recordings.** Don't search for `mp4`/`m4a`. If a folder listing turns them up, list them under Not included.
6. **Read** confirmed hits with `read_resource`, following `startPage` hints until the file is complete.

Delete the "Fallback: transcript files in SharePoint/OneDrive" paragraph, since that path is now the primary one.

**Staging (§6).** A `.docx` transcript arrives as converted text. Normalize it to one line per utterance,
`[HH:MM:SS] Speaker: text`, so citations still use `@HH:MM:SS`. Keep the existing rule: no attendee
names in the stage header unless the user asks. If a transcript has no timestamps, stage it as is and
note `no timestamps; cite by §<speaker turn n>` in its header. The analyst then cites `[S<n> §turn <k>]`.
Add that form to the citation table in `erd-format.md` as "transcript without timestamps".

**Manifest and ledger examples.** Replace the `meeting-transcript:///events/…` Location with
`file:///…/Data%20Workshop-20260915_140000-Meeting%20Transcript.docx` and the `event:` fingerprint
with `mod:<lastModifiedDateTime>`.

**Fingerprint rules.** Remove `event:<eventId>@<occurrenceStart>`. SharePoint transcripts use the existing
`mod:` scheme. Remove the "Location of a transcript must include the occurrence window" bullet: each
meeting is now its own file, so recurring series no longer collide.

**Legacy ledger rows.** Existing rows with a `meeting-transcript:///` Location and an `event:` fingerprint stay
valid. IDs and citations never change. Add a bullet:
- When a SharePoint transcript hit's title and meeting date match an existing `event:` row, show it at
  Gate A as "probably already ingested as S<n>". If the user confirms, **relocate** the row: replace its
  Location and Fingerprint with the file's, keep the ID, Ingested date and Status, and don't stage or
  re-analyse it. If the user declines, it's a new source.
- Discovery never re-reads `meeting-transcript:///` Locations.

Update the intro paragraph: there are no calendar tools. Connector tools used:
`sharepoint_search`, `sharepoint_folder_search`, `read_resource`.

✅ Commit: source gathering.

## 5. Delta discovery (`skills/erd-maintain/references/delta-discovery.md`)

- §2 **Meetings** becomes **Transcripts**: the §4 searches above with
  `afterDateTime = watermark`. Classification is by Location (`file:///…`) + `mod:` fingerprint, like any
  SharePoint item. Remove the occurrence-window sentence.
- An edited transcript file (new `mod:`) is **changed**, so it supersedes the old row as usual.
- §4 Recordings: replace the `meetingTranscriptUrl` bullet with: "A recording (`.mp4`/`.m4a`) with no
  transcript file: Not included; download the transcript from Teams to `<transcript folder>` or drop it in
  `<local_inputs>`."
- Add the legacy-row relocation check from §4 to Classify.

## 6. Everything else that mentions the meeting path

| File | Change |
|---|---|
| `skills/setup/SKILL.md` | §1: required tools become `sharepoint_search`, `sharepoint_folder_search`, `read_resource` (drop `outlook_calendar_search`). §2 Q5: "Where are meeting transcripts saved in SharePoint (folder names)? And what keywords identify the project's meetings?" Mention the download-to-folder practice. §3 YAML per §3 above. §4 Verify: replace the calendar check with one `sharepoint_folder_search` per transcript folder plus one `sharepoint_search` (`fileType: docx`, limit 3). Report the folder and hit counts; don't read content. Frontmatter description: "SharePoint source hints" (drop "Teams"). |
| `skills/erd-build/SKILL.md` | Frontmatter: "meeting transcripts saved in SharePoint". Keep the argument hint. |
| `skills/erd-maintain/SKILL.md` | Frontmatter: "new meeting transcripts in SharePoint". Line ~42's "meetings without transcripts" becomes "recordings without a transcript file". |
| `agents/erd-analyst.md` | Description: "meeting transcripts (from SharePoint)". Add a note on `[S<n> §turn <k>]` for untimed transcripts. |
| `.claude-plugin/plugin.json` | Description: "meeting transcripts in SharePoint". Bump the minor version. |
| `README.md` | Pipeline diagram label "Meeting transcripts (SharePoint)". The Sources bullet becomes: transcripts are read as files from SharePoint/OneDrive folders. The team downloads each meeting's transcript (.docx preferred) to the configured folder. Calendar/Teams meeting access isn't used. Prerequisites: SharePoint/OneDrive access via the Microsoft 365 connector. |
| `docs/design/erd-maintain.md`, `docs/design/erd-maintain-handoff.md` | Historical design docs: **don't rewrite them**. Add a dated note at the top of each: "Transcript sourcing superseded by `sharepoint-transcripts-handoff.md` (issue #5): the calendar/`meetingTranscriptUrl` path and `event:` fingerprints were removed." |
| `docs/TECH_DEBT.md` | The issue says TD-1 is tracked here, but the file isn't on `dev`. If it exists when you build, mark TD-1 resolved with the commit. Otherwise skip it and note that. |

Final check: `grep -rn -i "meeting_series\|meetingTranscriptUrl\|meeting-transcript:\|outlook_calendar\|event:<"`
should only hit the deprecation alias text, the legacy-row rule, the superseded notes in the design docs,
and this handoff.

✅ Commit: skills, agents, docs.

## 7. Verification

1. **Connector smoke test** (needs the Microsoft 365 connector; read-only):
   - `sharepoint_folder_search` for a real transcript folder name
   - `sharepoint_search` with `fileType: docx` in it
   - `read_resource` on one `.docx` transcript: confirm that speaker labels and timestamps survive the PDF
     conversion, and record the exact line format seen
   - `read_resource` on one `.vtt`, if any exist: record whether text comes back, and set the `.vtt` rule in §2 accordingly

   Don't paste transcript content into commits or notes; record formats only.
2. **Sample project** (`examples/sample-project/`, local transcripts only): `/project-terrarium:erd-build`
   still runs end to end and cites `[S3 @HH:MM:SS]`. There's no calendar call and no deprecation warning.
3. **Deprecation:** temporarily add `meeting_series: ["Data Workshop"]` to the sample config. The run warns once
   and uses it as a query. Revert the change.
4. **Maintain:** follow `examples/fixtures/maintain-expected.md`. The results are unchanged (the fixtures use local transcripts).
5. **Legacy ledger:** in a scratch copy of `baseline/sources.md`, add a row with a `meeting-transcript:///` Location and an
   `event:` fingerprint, then run maintain. The row is kept, isn't re-read, and a matching SharePoint hit (if available)
   is offered for relocation.
6. `claude plugin validate .` and the final grep from §6.
7. Push to `origin dev`. If the user asks for a PR, link it with "Closes #5".

---

## Implementation notes
(Builder: record decisions, connector findings from §7.1, and deviations here.)

**Connector findings (§7.1), 2026-10-09.** Run against `Client Work/MN DHS Appeals Case Management`
only; formats recorded, no content kept.
- `sharepoint_search` / `sharepoint_folder_search` / `read_resource` match the §2 signatures.
- `sharepoint_folder_search` **returns files as well as folders** when names match, so step 1 of
  discovery now keeps only folder hits. `sharepoint_search(folderName=…)` is a **partial name match
  and leaked a hit from another library** (`Ignyte Proposals`); discovery now checks each hit's `webUrl`
  against the resolved folder path.
- Real transcripts are `.docx`, saved in per-meeting subfolders (e.g. `Discovery and Design/<n>. <Topic>_<MMDDYYYY>/`),
  named like `…_Transcript_10072026.docx`. That is not Teams' default name, so date parsing also accepts `MMDDYYYY` after `_`.
- A `.docx` read returns **flattened text** with no usable line breaks: a title/duration header, then
  `<Speaker>   <H:MM:SS or M:SS>  <text>` runs. Timestamps are unpadded (`0:09`, `1:02:07`). The footer was
  `[pages 1–1 of 53]` with `endPage` set (a 1.5 h meeting is about 53 pages). Staging therefore splits on speaker/timestamp
  markers and zero-pads to `[HH:MM:SS]`; checked on a synthetic string only.
- **No `.vtt` or `.txt` exists in the folder, so the `.vtt` read behaviour is unverified.** The spec's
  conservative rule (try one read, else list under Not included) is in place. The `Recordings` folder listing was empty.

**Verification.** `claude plugin validate .` passes. Final grep hits only the alias text, the legacy-row
rule, the superseded notes and the historical design docs. An end-to-end `/project-terrarium:erd-build` on a
copy of the sample project completed with local transcripts only: 66 `[S3/S4 @HH:MM:SS]` citations, no
calendar call, no deprecation warning. **Not run:** §7.3 (deprecation alias), §7.4 (maintain fixtures),
§7.5 (legacy ledger row), and a live build against the SharePoint folder.

**Deviations / follow-ups.**
- `docs/TECH_DEBT.md` is not on `dev`; TD-1 not updated.
- Remove the `meeting_series` alias in the next minor version.
- Plugin version bumped 0.4.0 → 0.5.0.
