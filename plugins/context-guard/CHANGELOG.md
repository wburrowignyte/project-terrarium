# Changelog

## 0.3.0

Rewritten from a written spec as a standalone, generic plugin in this repo. It continues the
behaviour of the earlier 0.2.0 build.

- Stopping points (soft, hard + step, milestone commit, idle) are recorded during a task and
  asked about at `Stop`. After a compaction, stale size-based reasons are dropped and the
  thresholds re-arm.
- The handover note is picked up on the first prompt of a new session, and after a compaction
  or `/clear`. Every pick-up applies the `CONTEXT_GUARD_HANDOVER_MAX_AGE` check, and
  `SessionStart` now runs through the Python guard instead of a separate bash script.
- New: Claude saves a handover note before auto-compaction, at `CONTEXT_GUARD_COMPACT_AT`.
  - It's needed because a `PreCompact` hook's output never reaches the model, so the old
    "please write a note" message there never took effect.
  - Compaction fires between tool calls, so the request also goes out on `PostToolUse` and
    `UserPromptSubmit`, and the guard counts the tool result that has just come back.
  - The timing is based on measured runs; see the README.
- New: `CONTEXT_GUARD_WINDOW` (default 200000), the window that auto-compaction measures against.
  `SOFT`, `HARD` and `COMPACT_AT` default from it, so the guard works on 200K models as well as
  on 1M models with a 300K backstop.
- New: `PreCompact` writes a thin fallback note (the last few prompts you typed) when no recent
  note exists.
- Changed: files move to `.context-guard/` at the project root. They were in
  `.claude/compact-memory/` and `.claude/context-guard/`, and Claude Code asks permission for
  every write under `.claude/`.
- Changed: the guard now stands down only for hooks whose command mentions `compact-memory`,
  not for any mention of it in settings.json.
- Changed: `CONTEXT_GUARD_COMMIT_PATTERN` is empty (off) by default.
- New: per-session state files are pruned after 7 days.
- Changed: usage records with all-zero tokens (synthetic messages) are skipped when measuring
  context.
