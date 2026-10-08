# context-guard

A Claude Code plugin that keeps a session from paying to re-read a huge context.

Every API call re-sends the whole conversation, so each call costs more as the session grows.
context-guard watches the context size and notes natural stopping points. Once the current task is
done, it asks whether to hand over to a fresh session. It also carries the handover note across a
`/clear` or a compaction.

Stopping points never interrupt a task. They are only recorded while work is in progress. The
question comes when Claude stops, and nothing is written or cleared until you answer. The one
exception is that just before an auto-compaction, Claude saves a handover note without asking
(see below).

## Install

```bash
claude plugin marketplace add <path-or-git-url-of-this-repo>
claude plugin install context-guard@project-terrarium-dev
```

Then run `/context-guard:setup` in Claude Code. It does four things:
- asks which context window you run and sets the thresholds to match;
- on 1M-token models, offers an auto-compaction backstop;
- git-ignores `.context-guard/`;
- checks for duplicate guards.

Requires bash (Git Bash on Windows) and Python 3. If no Python is found, the guard does
nothing and never fails the session.

## What it does

| When | What |
|---|---|
| Context crosses `SOFT` | stopping point |
| Context crosses `HARD`, then every `STEP` | stopping point |
| A `git commit` whose message matches `COMMIT_PATTERN`, at ≥ 50K | stopping point (off by default) |
| A prompt after > 60 min idle, at ≥ `SOFT` | stopping point: that prompt re-read the whole context at full price, and the next long break will too |
| Claude stops with stopping points recorded | asks: (1) handover + fresh session, (2) handover only, (3) keep going |
| Context reaches `COMPACT_AT` | Claude saves a handover note without asking, mid-task if needed, then carries on |
| Compaction | if no recent note exists, writes a thin fallback (the last few prompts you typed) |
| After a compaction or `/clear`, or the first prompt of a new session | loads `.context-guard/latest.md` once, if it's under 24 h old, then moves it to `previous.md` |

Context size comes from the last main-thread `usage` record in the transcript
(input + cache read + cache creation tokens). Subagents are ignored. After a compaction, the
size-based stopping points re-arm and stale ones are dropped.

Fresh session: if a tool that clears the session is available, Claude uses it, and any message you
send picks up the handover. The Claude desktop app has offered one named
`mcp__ccd_session_mgmt__clear_session`. That name comes from observed use, not public docs, and
may change. Otherwise Claude asks you to run `/clear` and send a message.

## Configuration

Set these in the environment or under `env` in settings.json. `CONTEXT_GUARD_WINDOW` is the one
to get right; the rest default from it.

| Variable | Default | 200K window | 300K window |
|---|---|---|---|
| `CONTEXT_GUARD_WINDOW` | `200000` | `200000` | `300000` |
| `CONTEXT_GUARD_SOFT` | min(120K, window/2) | 100K | 120K |
| `CONTEXT_GUARD_HARD` | min(200K, COMPACT_AT − 15K) | 122K | 200K |
| `CONTEXT_GUARD_STEP` | `50000` | 50K | 50K |
| `CONTEXT_GUARD_COMPACT_AT` | window − 63K (`0` turns it off) | 137K | 237K |
| `CONTEXT_GUARD_COMMIT_PATTERN` | empty (off), e.g. `release\|milestone` | | |
| `CONTEXT_GUARD_HANDOVER_MAX_AGE` | `24` (hours) | | |

`CONTEXT_GUARD_WINDOW` is the window that auto-compaction measures against: the smaller of your
model's context window and `autoCompactWindow`. On a 1M-token model without `autoCompactWindow`,
auto-compaction practically never fires. Setup offers `autoCompactWindow: 300000` with
`CONTEXT_GUARD_WINDOW=300000` as a backstop.

The commit pattern matches git's own summary line (`[main 9301ab5] message`), not the command
text, so an `echo` that mentions the phrase doesn't count.

## Why the handover is saved at `COMPACT_AT`

A `PreCompact` hook can't put text in front of the model, so the note has to be asked for
earlier. These results come from headless Claude Code 2.1.294 runs with `autoCompactWindow` set
to 100K and 150K, while reading ~24K-token files one per tool call:

- Auto-compaction fires **between tool calls**, not only between turns. So the request goes out on
  `PostToolUse` and `UserPromptSubmit` as well as at `Stop`.
- It fires when the next request would pass roughly **window − 33K** tokens: between 58K and 81K
  for a 100K window, and between 105K and 129K for a 150K window. A fixed percentage doesn't fit
  both.
- The transcript's usage lags by the tool result that has just come back. The guard adds an
  estimate of that result (characters ÷ 3), and asks 30K ahead of the compaction point. That
  leaves room for one large tool result.
- In the 150K run, the request went out at ~99K estimated. The model wrote a full handover as
  its next action, auto-compaction fired one call later, and `SessionStart:compact` loaded the
  note.

## Files it writes (git-ignore them)

All of them are in `.context-guard/` at the project root. They are kept out of `.claude/` because
Claude Code treats that folder as sensitive and asks permission for every write there, even
mid-task.

- `.context-guard/latest.md`, `previous.md`: the handover notes.
- `.context-guard/state/<session>.json`: per-session state. Pruned after 7 days.

## Standing down

- A project-local `.claude/hooks/context_guard.py` replaces the plugin's guard.
- A hook in `.claude/settings.json` whose command mentions `compact-memory` replaces the plugin's
  compaction handling: the pre-compaction note, the fallback, and the `SessionStart` pick-up.
  Other mentions, such as a permission rule, don't count.
- Installing the plugin from two marketplaces makes it ask twice. Keep one copy.

## Known limits

- The handover note is shared by every session in the project. A second session started
  within 24 h picks it up on its first prompt.

## Cost

The guard starts on every prompt, after every tool call, and at every stop. Each run reads at
most the last 4 MB of the transcript, which takes tens of milliseconds.

## Develop

```bash
python -m pytest tests/context-guard
claude plugin validate plugins/context-guard
```
