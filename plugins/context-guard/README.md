# context-guard

A Claude Code plugin that keeps a session from paying to re-read a huge context.

Every API call re-sends the whole conversation, so each call costs more as the session grows.
context-guard watches the context size and notes natural stopping points. Once the current task is
done, it asks whether to hand over to a fresh session. It also carries the handover note across a
`/clear` or a compaction.

It never interrupts a task. Stopping points are only recorded while work is in progress. The
question comes when Claude stops, and nothing is written or cleared until you answer.

## Install

```bash
claude plugin marketplace add <path-or-git-url-of-this-repo>
claude plugin install context-guard@project-terrarium-dev
```

Then run `/context-guard:setup` in Claude Code. It adds the auto-compaction backstop
(`autoCompactWindow: 300000`), git-ignores the guard's files, and checks for duplicate guards.

Requires bash (Git Bash on Windows) and Python 3. If no Python is found, the guard does
nothing and never fails the session.

## What it does

| When | What |
|---|---|
| Context crosses `SOFT` (120K) | stopping point |
| Context crosses `HARD` (200K), then every `STEP` (50K) | stopping point |
| A `git commit` whose message matches `COMMIT_PATTERN`, at ≥ 50K | stopping point (off by default) |
| Prompt after > 60 min idle, at ≥ `SOFT` | stopping point (the prompt cache has expired) |
| Claude stops with stopping points recorded | asks: (1) handover + fresh session, (2) handover only, (3) keep going |
| Context reaches `COMPACT_AT` (280K) | at the next stop, saves a handover note without asking |
| Compaction | if no recent note exists, writes a thin fallback (the last few prompts you typed) |
| After a compaction or `/clear`, or the first prompt of a new session | loads `.claude/compact-memory/latest.md` once, then moves it to `previous.md` |

Context size comes from the last main-thread `usage` record in the transcript
(input + cache read + cache creation tokens). Subagents are ignored.

Fresh session: in the desktop app the guard clears the session itself, and any message you send
picks up the handover. In the terminal, run `/clear` and send a message.

### Why the pre-compaction handover

A `PreCompact` hook can't put text in front of the model. So the guard saves the note early, at
`COMPACT_AT`, just below the `autoCompactWindow` backstop. The compaction hook only writes a
fallback when that didn't happen.

## Configuration

Set these in the environment or under `env` in settings.json:

| Variable | Default |
|---|---|
| `CONTEXT_GUARD_SOFT` | `120000` |
| `CONTEXT_GUARD_HARD` | `200000` |
| `CONTEXT_GUARD_STEP` | `50000` |
| `CONTEXT_GUARD_COMPACT_AT` | `280000` (`0` turns it off) |
| `CONTEXT_GUARD_COMMIT_PATTERN` | empty (off), e.g. `release\|milestone` |
| `CONTEXT_GUARD_HANDOVER_MAX_AGE` | `24` (hours) |

The commit pattern matches git's own summary line (`[main 9301ab5] message`), not the command
text, so an `echo` that mentions the phrase doesn't count.

## Files it writes (git-ignore them)

- `.claude/context-guard/<session>.json`: per-session state. Pruned after 7 days.
- `.claude/compact-memory/latest.md`, `previous.md`: the handover notes.

## Standing down

- A project-local `.claude/hooks/context_guard.py` replaces the plugin's guard.
- Hooks in `.claude/settings.json` that mention `compact-memory` replace its compaction
  handling.
- Installing the plugin from two marketplaces makes it ask twice. Keep one copy.

## Cost

The guard starts on every prompt, after every tool call, and at every stop. Each run reads at
most the last 4 MB of the transcript, which takes tens of milliseconds.

## Develop

```bash
pytest tests/context-guard
claude plugin validate plugins/context-guard
```
