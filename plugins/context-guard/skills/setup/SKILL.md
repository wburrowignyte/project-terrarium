---
name: setup
description: Configure context-guard for this project or for the user — add an auto-compaction backstop to settings.json, optionally set the CONTEXT_GUARD_* thresholds, git-ignore the guard's working files, offer a CLAUDE.md note, and check for duplicate guards that would make the plugin stand down.
disable-model-invocation: true
---

# context-guard setup

context-guard's hooks run as soon as the plugin is installed. This skill adds the settings
that make it work well. Explore first, list every change you plan, and confirm before you
write. Never replace a file wholesale: merge into what is there.

## 1. Scope

Ask: **project** (`.claude/settings.json` in this repo, shared with the team) or **user**
(`~/.claude/settings.json`, every project on this machine). Name the exact file. Read it if it
exists, then list the changes from steps 2–4 before you make any of them.

## 2. Settings

Merge into the chosen settings.json:

```json
{ "autoCompactWindow": 300000 }
```

Why: auto-compaction measures against the model's context window, so on a 1M-token model it
practically never fires. 300K makes a runaway session compact itself. Shortly before that
point (`CONTEXT_GUARD_COMPACT_AT`, default 280000) the guard asks the model to save a handover
note, so the compaction loses less.

- If `autoCompactWindow` already has a value, show it and ask before changing it.
- If the user keeps a value other than 300000, suggest setting `CONTEXT_GUARD_COMPACT_AT` to about
  20K below it.

Optionally, ask whether to set thresholds under `env` (show the defaults, and write only the ones
the user changes):

| Variable | Default | Meaning |
|---|---|---|
| `CONTEXT_GUARD_SOFT` | 120000 | first stopping point |
| `CONTEXT_GUARD_HARD` | 200000 | second stopping point |
| `CONTEXT_GUARD_STEP` | 50000 | repeat every this many tokens past HARD |
| `CONTEXT_GUARD_COMPACT_AT` | 280000 | save a handover unasked (0 turns it off) |
| `CONTEXT_GUARD_COMMIT_PATTERN` | empty (off) | regex; a commit whose message matches is a stopping point |
| `CONTEXT_GUARD_HANDOVER_MAX_AGE` | 24 | hours a handover note stays loadable |

For `CONTEXT_GUARD_COMMIT_PATTERN`, look at `git log --oneline -30` and suggest a pattern that
matches the team's milestone commits, if any (e.g. `release|milestone`). Keep it empty if
nothing stands out.

## 3. Git-ignore

The guard writes per-session state and handover notes. Neither belongs in git.

- Project scope: add `.claude/compact-memory/` and `.claude/context-guard/` to the repo's
  `.gitignore` if they are not already ignored.
- User scope: offer to add both to the global excludes file
  (`git config --global core.excludesFile`; if unset, offer `~/.config/git/ignore`).

## 4. CLAUDE.md (optional)

Offer to add this block to the project's (or user's) CLAUDE.md:

```markdown
## Context guard
The context-guard plugin may point out stopping points (context size, an idle session, a
milestone commit) and suggest a handover to a fresh session. Whether to hand over is the
user's call: mention it when asked to, and never write a handover or clear the session
unasked.
```

## 5. Duplicate guards

Check for, and report:
- a project-local `.claude/hooks/context_guard.py`. If it exists, the plugin's guard stands down
  and that file runs instead.
- hooks in `.claude/settings.json` that mention `compact-memory`. If any exist, the plugin's
  compaction handling stands down.
- the same plugin installed from another marketplace (`claude plugin list`). Two copies would
  ask twice.

Explain what each one means. Offer to remove the duplicate, but don't remove anything unless the
user asks.

## 6. Report

Summarise what changed (file by file) and what was left alone.
