# Changelog

## 0.3.0

Rewritten from a written spec as a standalone, generic plugin in this repo. It continues the
behaviour of the earlier 0.2.0 build.

- Stopping points (soft, hard + step, milestone commit, idle) are recorded during a task and
  asked about at `Stop`.
- The handover note is picked up on the first prompt of a new session, and after a compaction
  or `/clear`.
- New: `CONTEXT_GUARD_COMPACT_AT` (default 280000) saves a handover note before auto-compaction.
  A `PreCompact` hook's output never reaches the model, so the old "please write a note"
  message there never took effect.
- New: `PreCompact` writes a thin fallback note (the last few prompts you typed) when no recent
  note exists.
- Changed: `CONTEXT_GUARD_COMMIT_PATTERN` is empty (off) by default.
- New: per-session state files are pruned after 7 days.
- Changed: usage records with all-zero tokens (synthetic messages) are skipped when measuring
  context.
