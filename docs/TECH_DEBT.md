# Tech Debt

Known shortcomings to be addressed. Add new items at the bottom using the template.

## TD-1: Source meeting transcripts from SharePoint, not Teams meeting sessions

**Status:** Open · **Added:** 2026-10-08

**Problem.** The Microsoft Graph connector does not have access to Teams meeting transcripts. The current
approach (calendar event → `meetingTranscriptUrl` → transcript, via `outlook_calendar_search` over
`meeting_series`) therefore cannot reliably retrieve transcript content.

**Recommendation.** Going forward, take transcripts only from SharePoint (where Teams saves meeting
recordings/transcripts, or a designated transcript folder) rather than pulling them from the meeting sessions.

**Affected areas (to update when addressed).**
- `skills/setup/SKILL.md`: `meeting_series` prompt/config, and the `meetingTranscriptUrl` check during setup.
- `skills/erd-maintain/` (and its `references/delta-discovery.md`): the "Meetings" discovery path and the
  "no `meetingTranscriptUrl`" handling.
- `skills/erd-build/references/source-gathering.md`: Teams transcript gathering.
- `docs/design/erd-maintain.md` and `docs/design/erd-maintain-handoff.md`: design assumptions, the
  `meeting-transcript:///events/…` source location format, and `event:<eventId>@<occurrenceStart>` source IDs.
- `README.md`: "Teams transcripts come through the Microsoft 365 connector" description.
- `examples/sample-project/project-terrarium.yaml`: `meeting_series` / `transcript_folders` config.

**Done when.** Transcript discovery uses SharePoint search (`sharepoint_search` / `sharepoint_folder_search`)
only, `meeting_series` and `meetingTranscriptUrl` handling are removed or deprecated, and the docs and
sample config reflect that.
