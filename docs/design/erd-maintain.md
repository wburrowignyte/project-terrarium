# ERD maintain module — design

## Context
`project-terrarium` is a Claude Code plugin made only of prompts. Module 1 (`/project-terrarium:erd-build`) gathers sources (Teams transcripts, SharePoint docs, context MD) into a git-ignored staging dir and has `erd-analyst` write a cited `erd/ERD.md` per `skills/erd-build/references/erd-format.md`. Then `appian-erd-reviewer` reviews it. The README lists "ERD maintain (diff new meetings against the ERD)" as planned. Today the only incremental behaviour is "preserve IDs, increment Version" on a full rebuild.

Goal: when new slide decks or meeting recordings appear, update the existing ERD **incrementally**. Only new sources are read. Changes are proposed as a reviewable change set, applied with IDs kept stable, and every change can be traced to its source.

Three gaps in the current design block this:
1. **Source IDs restart at S1 each run**, so after a second run the old citations in `ERD.md` no longer resolve.
2. **There is no notion of "already ingested"**, so the pipeline can't tell which sources are new.
3. **There is no `.pptx` handling**, and recordings are reached only through Teams transcripts.

**Status:** proposed (not yet implemented)

## Design overview

```
/project-terrarium:erd-maintain [since:<date>] [filter]
  1. Load config + ERD.md + source ledger (erd/sources.md)
  2. Discover NEW/CHANGED sources since watermark ──► Gate A (confirm list)
  3. Stage only those (new global S-IDs)
  4. erd-analyst mode: maintain ──► erd/changes/<RUN>-changeset.md   (proposal only)
  5. Gate C: user accepts/rejects change-set ops
  6. erd-analyst mode: apply ──► ERD.md (Version+1, Change log row)
  7. appian-erd-reviewer scope: delta ──► reviews/<RUN>-appian-review.md ──► Gate B (as in build)
  8. Report; no commit
```

### 1. Persistent source ledger: `erd/sources.md` (committed, metadata only)
- Replaces "S-IDs restart per run". IDs are **global and append-only**: `S1…Sn` continue across runs.
- Columns: `ID | Kind | Title | Date | Location (URI/path) | Fingerprint | Ingested (run) | Status`
  - Fingerprint: SharePoint `lastModified`/etag, the calendar event id + occurrence start, or a local file hash.
  - Status: `active` or `superseded by S<m>`. A re-uploaded deck version gets a new ID and the old one is marked superseded.
- Holds no titles of individuals and no content. It's safe to commit. Staged text stays in the git-ignored `staging/<RUN>/`.
- The per-run `sources-manifest.md` stays, as the list of what was staged *this run*.
- **erd-build change:** allocate IDs from the ledger and write it too. **Migration:** the first maintain run on an ERD that has no ledger imports the latest staging manifest as S1…Sn. If that manifest is gone, it asks the user to run `erd-build` once.

### 2. Delta discovery (new reference `skills/erd-maintain/references/delta-discovery.md`)
- Watermark = the newest `Ingested` run date in the ledger, minus a configurable overlap (`maintain.lookback_days`, default 3). An explicit `since:` argument overrides it.
- Discovery uses the same M365 read-only paths as `source-gathering.md`, filtered by date:
  - **Meetings:** `outlook_calendar_search` over `meeting_series` with `afterDateTime = watermark`, then the transcript via `meetingTranscriptUrl` (with occurrence window).
  - **Slide decks (new):** `sharepoint_search` with `fileType: "pptx"` (and `"pdf"` for exported decks), content queries from `sharepoint.doc_queries`, narrowed by the new `sharepoint.deck_folders`. Also checks `local_inputs/*.pptx`.
  - Other SharePoint docs: same as build.
- Classify each hit against the ledger: **new** (URI not in ledger), **changed** (URI present, fingerprint differs), or **known** (skip silently).
- Recordings with no transcript (a meeting with transcription off, or an uploaded `.mp4`) go under "Not included". The note tells the user to enable transcription or drop a `.vtt` into `local_inputs`. **v1 does no audio transcription.**
- If nothing is new, say "ERD is current as of <watermark>" and exit. Nothing gets written.

### 3. Slide-deck staging (extend shared `skills/erd-build/references/source-gathering.md`)
- New kind `slide-deck`. Stage it as `S<n>-<slug>.md` with one section per slide: `## Slide <k>: <title>`, then the body text, tables and **speaker notes**.
- Remote decks: `read_resource` on the SharePoint item, following the `startPage` hints. Local `.pptx`: text extraction (the pptx skill / `python-pptx` if available). If neither works, ask the user to export the deck to PDF.
- Slides that are mostly images (screenshots of legacy data models or diagrams) are flagged in the staged file as `[visual content not extracted]`. The analyst turns them into an open question rather than guessing.
- New citation form in `erd-format.md`: `[S<n> slide <k>]` (alongside `@HH:MM:SS` and `§Section`).

### 4. Change set: `erd/changes/<RUN>-changeset.md` (new contract `skills/erd-maintain/references/changeset-format.md`)
`erd-analyst` in **mode: maintain** reads the current `ERD.md`, the ledger, the new staged sources and the prior change sets' *rejected* ops. It writes **only** the change set and never touches `ERD.md`.

`| CS-n | Class | Op | Target | Change | Evidence | Supersedes | Confidence |`

- **Ops:** `add-entity`, `add-field`, `modify-field` (type/req/key/description), `rename`, `add-relationship`, `modify-relationship`, `deprecate` (never delete: moves the item to *Out of scope / deferred* with a reason), `add-citation` (a new source confirms an existing element), `confirm-assumption` (an `A-n` becomes source-backed), `resolve-question` (a `Q-n` is answered), `raise-question`.
- **Class**, which drives the gate defaults:
  - `additive`: new entities/fields/relationships, citations, questions.
  - `modifying`: type, required-ness or description changes; resolved questions.
  - `breaking`: key/cardinality changes, renames, deprecations, anything that alters an existing FK.
  - `conflict`: the new source contradicts an element cited to an earlier source. It follows the existing "latest stated decision wins, DHS over vendor" rule, but **always** shows both citations and adds a `raise-question` alternative.
- **Target** uses existing stable IDs (`E-3.caseStatus`, `R-5`, `Q-2`). New elements get provisional IDs (`E-new-1`) that are resolved to the next free ID at apply time.
- **Header:** sources covered, ERD version the change set is based on, and counts by class.
- **Rejected ops** stay in the file with a reason. Later maintain runs don't re-propose them unless a *newer* source brings them up again.

### 5. Gate C (change-set approval)
The orchestrator shows a compact summary grouped by class. The user can type `accept all`, `accept additive`, `accept CS-1,CS-4`, or `reject CS-7: <reason>`.
- Default suggestion: accept `additive` + `add-citation`. Ops in the `modifying`, `breaking` or `conflict` classes need an explicit choice.
- Config `maintain.auto_accept: [additive]` can skip the prompt for those classes.
- Each decision is written back into the change set (a `Decision` column).

### 6. Apply
`erd-analyst` in **mode: apply** applies only the accepted CS ops:
- Assigns real IDs, increments Version, updates the Mermaid diagram, and replaces `ASSUMPTION` citations with source citations where an assumption was confirmed.
- Appends to a new `ERD.md` section, **Change log**: `Version | Date | Change set | Summary`.

The orchestrator then runs its existing checks, plus:
- every citation resolves against **the ledger** (not the run manifest);
- every accepted CS op is reflected in the ERD (grep its target ID);
- no ID that existed before has disappeared.

On failure it sends the agent back once (the existing pattern).

### 7. Delta review
`appian-erd-reviewer` gets `scope: delta` plus the list of changed IDs:
- It runs the checklist on the changed elements and their FK neighbours.
- It runs the full checklist if any `breaking` op was applied.

The output contract (`review-format.md`) and Gate B / revise round 2 are reused unchanged.

## Files

**New**
- `skills/erd-maintain/SKILL.md`: orchestrator, following the `erd-build/SKILL.md` pattern (resolve references to absolute paths, gates, verify, never commit).
- `skills/erd-maintain/references/changeset-format.md`
- `skills/erd-maintain/references/delta-discovery.md`
- `examples/sample-project/` additions: a second transcript dated after the first; a slide deck (`.pptx` + its text twin) with one additive change, one type change, one contradiction and one image-only slide; a pre-built `erd/sources.md`.

**Modified**
- `agents/erd-analyst.md`: add the `maintain` and `apply` modes; make the "If ERD.md exists" step in build mode use the ledger.
- `agents/appian-erd-reviewer.md`: add `scope: delta`.
- `skills/erd-build/SKILL.md`: allocate S-IDs from the ledger and write `erd/sources.md`.
- `skills/erd-build/references/source-gathering.md`: add the `slide-deck` kind, `pptx` search and ledger allocation; drop the "restart at S1" rule.
- `skills/erd-build/references/erd-format.md`: add the `slide` citation form, the **Change log** section, `Sources: see sources.md` in the header, and the deprecated-element convention.
- `skills/setup/SKILL.md` and its config template: add `sharepoint.deck_folders`, `maintain.lookback_days` and `maintain.auto_accept`.
- `README.md`: mark the module available and document the commands.
- `.gitignore`: no change needed. `erd/sources.md` and `erd/changes/` are committed; staging stays ignored.

## Deliberately out of v1
- Audio/video transcription of recordings that have no Teams transcript.
- Automatic triggering. v1 is a manual command. A later Routine can run discovery on a schedule (weekly, say) and post "N new sources" without applying anything.
- OCR of image-only slides.
- Pushing the ERD to Lucid.

## Verification
1. Run `claude plugin validate .`
2. In `examples/sample-project`, run `claude --plugin-dir ../..` and then `/project-terrarium:erd-build`. Confirm that `erd/sources.md` is written with S1…Sn.
3. Add the new transcript and deck to `transcripts/` / `local_inputs`, then run `/project-terrarium:erd-maintain`. Check that:
   - only the new files are discovered and they get IDs Sn+1…;
   - the change set contains the expected additive, modifying and conflict ops, plus a question for the image-only slide.
4. Accept a subset at Gate C. Check that:
   - Version increments;
   - the Change log row is added;
   - pre-existing IDs are unchanged;
   - all citations, old and new, resolve against the ledger;
   - rejected ops are absent from the ERD and recorded in the change set.
5. Re-run `erd-maintain` with no new inputs. It should exit with "ERD is current" and write nothing.
6. Re-run after touching the deck (new fingerprint). It should be classified as changed, the old ID marked superseded, and previously rejected ops not re-proposed.
7. Use the delta review on a breaking change (a cardinality flip) to confirm the full checklist runs.
