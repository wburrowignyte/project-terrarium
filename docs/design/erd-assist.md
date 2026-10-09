# ERD assist module: design

> **Note:** `erd-assist-handoff.md` is the build spec. Where this note and the handoff differ, the handoff wins.

## Context
After `erd-build` or `erd-maintain` updates `erd/ERD.md` and `erd-view` renders it, the user wants to iterate: ask what
the last run changed and why, tweak the model, and settle design questions. Today every change has to go through a new
source and a maintain run, and nothing records a decision that came from the user rather than a transcript. A later run
can quietly undo it.

Goal: an interactive assistant that **discusses recent changes**, **makes a change when told to** (editing `ERD.md`
correctly per the contract), and **records Technical Decisions** in a committed log that build and maintain read and must
not overwrite. The ERD and the log grow without bound, so cost has to stay flat: the assistant reads slices, never whole files.

## Design overview

```
/project-terrarium:erd-assist [ID or topic]
  1. Load: config, erd-slice --outline, active DEC rules, recent changes (change set / review / git diff --stat)
  2. Brief (6 lines), then ask what to discuss
  3. Discuss: slice only the elements in play + the decisions touching them
  4. Change (explicit instruction only): check DECs ─► record DEC ─► Edit ERD.md ─► erd-slice --check ─► erd-view
  5. Wrap up: links, optional delta review for breaking ops; no commit
```

- **`skills/erd-assist/SKILL.md`**: the assistant. It runs in the main session with the `erd-analyst` persona.
- **`skills/erd-assist/references/decisions-format.md`**: the `DECISIONS.md` contract.
- **`tools/erd-assist/erd-slice.mjs`**: zero-dependency Node helper (outline, slices, next IDs, integrity check). It reuses
  `parseErd` from `erd-view`.
- **Decision IDs are `DEC-<n>`.** `TD-` is already used for tech-debt items, and the ERD uses `E-`/`R-`/`A-`/`Q-`, change sets `CS-`, reviews `F-`.
- **`[DEC-n]` is a real citation form.** An element set by a decision cites it, next to any source citations.

## Why one file with an index
Other agents must honour every active decision by reading about one line per decision. `DECISIONS.md` has a compact Index
table (newest first, one binding Rule line per row) above the full blocks. Readers `Grep` the Index only: all active rules,
the rules touching one ID, or one block on demand. One file keeps IDs, ordering and supersession in a single place, and the
Index is the index: no JSON or database. When the Index passes 300 rows, blocks of non-Active decisions move to
`decisions/archive-<YYYY>.md`, and their Index rows stay, so every ID still resolves. The log is append-only: a change is a
new DEC that supersedes the old one.

## Why in-session edits
A subagent can't hold a conversation, and delegating every edit to `erd-analyst` was rejected as too slow. The assistant
makes targeted `Edit` calls to the entity, its rows and its Mermaid block, then validates with `erd-slice --check` and
re-renders with `erd-view`. An explicit user instruction is the approval, including for breaking ops. One ERD version
is used per session: the first write bumps Version and adds a Change log row `assist DEC-a–DEC-b`, later writes extend that row.

## Interaction with build and maintain
- **Build / revise:** read the active rules; keep every `[DEC-n]`-cited element as decided. A contradicting source becomes a
  `Q-n` citing both sides. A finding that would contradict a DEC is rejected "per DEC-n" unless it is High.
- **Maintain:** any op that targets an element in an active DEC's Affects (or falls under a `global` DEC) is class `conflict`
  with `Supersedes [DEC-n]` and a paired question. Gate C lists these first and always needs an explicit choice.
- **Apply:** an accepted op that supersedes a DEC sets its Status to `Superseded by CS-<n> (<file>)`. This is the only
  edit an analyst mode makes to `DECISIONS.md`.
- **Review:** the reviewer reads the active rules, doesn't re-argue them, and raises a High risk a decision leaves open,
  naming the DEC so the user can supersede it.
- A missing `DECISIONS.md` is an empty log and never fails a run.

## Out of scope
A separate assistant subagent; auto-commit; Microsoft 365 access from `erd-assist`; editing `sources.md`, change sets or
reviews from `erd-assist`; a per-decision file layout or JSON index; changes to the `erd-view` HTML.
