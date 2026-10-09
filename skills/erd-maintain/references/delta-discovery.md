# Delta discovery

Find the sources that are **new or changed** since the last run. This file defines *what counts as
new*. `skills/erd-build/references/source-gathering.md` defines *how* to read each kind of source
and how to stage it; follow it for those steps. All Microsoft 365 access is read-only.

## 1. Watermark

Watermark = the newest `Ingested` date in `<erd_dir>/sources.md`, minus `maintain.lookback_days`
(default 3). A `since:<date>` argument overrides it.

## 2. Scope of each search

- **Transcripts:** the `source-gathering.md` §2 searches, with `afterDateTime = watermark`, **plus its
  listing pass** over each transcript folder. A listing can't be date-filtered, so apply the watermark
  after merging: keep a listed file if it's not in the ledger, or if its `lastModifiedDateTime` ≥ watermark.
  Classification is by Location (`file:///…`) and `mod:` fingerprint, like any SharePoint item. An
  edited transcript file (new `mod:`) is **changed** and supersedes the old row as usual.
- **Slide decks:** `sharepoint_search` with `fileType` `pptx`, then `pdf`, narrowed by
  `sharepoint.deck_folders`. Keep a hit if its `lastModifiedDateTime` ≥ watermark.
- **Docs:** the `sharepoint.doc_queries` searches, filtered by the same date.
- **Local inputs:** **all** files under `local_inputs`, with no date filter. They are classified
  by `sha256:` fingerprint, even if git tracks them.
- **Context MDs:** all `context_paths` matches, classified by `git:` fingerprint (always, for `context_paths`).

## 3. Classify

Compare each hit with the ledger using the matching rules in `source-gathering.md`
(*Source ledger*). Compute a fingerprint for each hit, then label it:

- **new:** its Location isn't in the ledger.
- **changed:** its Location is in the ledger and the Fingerprint differs from the active row.
- **known:** same Location, same Fingerprint.
- **Legacy-row relocation:** a transcript hit whose title and meeting date match a legacy
  `meeting-transcript:///` / `event:` row is offered at Gate A as "probably already ingested as
  S<n>". See *Legacy rows* in `source-gathering.md`. Never re-read a `meeting-transcript:///` Location.

Show **new** and **changed** hits at Gate A. Drop **known** hits silently; report only a count.

## 4. Recordings

Never try to transcribe audio or video.
- A recording (`.mp4`/`.m4a`) with no transcript file goes under "Not included: download the
  transcript from Teams to `<transcript folder>` or drop it in `<local_inputs>`".
- So do `.mp4` and `.m4a` files found in a folder listing or in `local_inputs`.

## 5. Nothing new

If no hit is new or changed, the run succeeds and **writes nothing**. Report
"ERD v<n> is current as of <watermark>; nothing new found", plus any "Not included" items.
