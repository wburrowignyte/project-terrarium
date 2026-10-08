# Delta discovery

Find the sources that are **new or changed** since the last run. This file defines *what counts as
new*. `skills/erd-build/references/source-gathering.md` defines *how* to read each kind of source
and how to stage it; follow it for those steps. All Microsoft 365 access is read-only.

## 1. Watermark

Watermark = the newest `Ingested` date in `<erd_dir>/sources.md`, minus `maintain.lookback_days`
(default 3). A `since:<date>` argument overrides it.

## 2. Scope of each search

- **Meetings:** `outlook_calendar_search` per entry in `sharepoint.meeting_series`, with
  `afterDateTime = watermark`. Read each event's transcript as in `source-gathering.md` §2.
- **Slide decks:** `sharepoint_search` with `fileType` `pptx`, then `pdf`, narrowed by
  `sharepoint.deck_folders`. Keep a hit if its `lastModifiedDateTime` ≥ watermark.
- **Docs:** the `sharepoint.doc_queries` searches, filtered by the same date.
- **Local inputs:** **all** files under `local_inputs`, with no date filter. They are classified
  by fingerprint.
- **Context MDs:** all `context_paths` matches, classified by `git:` fingerprint.

## 3. Classify

Compare each hit with the ledger using the matching rules in `source-gathering.md`
(*Source ledger*). Compute a fingerprint for each hit, then label it:

- **new:** its Location isn't in the ledger.
- **changed:** its Location is in the ledger and the Fingerprint differs from the active row.
- **known:** same Location, same Fingerprint.

Show **new** and **changed** hits at Gate A. Drop **known** hits silently; report only a count.

## 4. Recordings

Never try to transcribe audio or video.
- A calendar event with no `meetingTranscriptUrl` goes under "Not included: no transcript; enable
  Teams transcription or drop a `.vtt` in `<local_inputs>`".
- So do `.mp4` and `.m4a` files found by search or in `local_inputs`.

## 5. Nothing new

If no hit is new or changed, the run succeeds and **writes nothing**. Report
"ERD v<n> is current as of <watermark>; nothing new found", plus any "Not included" items.
