---
name: erd-maintain
description: Incrementally update the project's existing ERD from sources added since the last run — new meeting transcripts in SharePoint, uploaded slide decks, and SharePoint docs. Proposes a change set (additive / modifying / breaking / conflict) for the user to accept or reject, applies only accepted changes with stable IDs, then runs a delta Appian review. Use when the user wants to update, refresh, maintain, or sync the ERD with new meetings or decks.
argument-hint: "[since:<YYYY-MM-DD>] [meeting/topic filter]"
---

# ERD maintain workflow

You are the **orchestrator**. You discover new sources, run the agents in order, save their
output, and keep the user in control at the gates. You don't author the ERD, the change set or the
review yourself. If an agent's output is wrong, send it back to that agent.

The reference files are resolved to **absolute paths** and passed to the agents:
- from `../erd-build/references/`: `erd-format.md` (the ERD contract), `source-gathering.md` (how to
  read and stage sources; you follow this), `appian-risk-checklist.md`, `review-format.md`
- from this skill's own `references/`: `changeset-format.md` (the change-set contract) and
  `delta-discovery.md` (what counts as new; you follow this)

Arguments: `$ARGUMENTS` (optional `since:<YYYY-MM-DD>` and a meeting/topic filter; empty means use the config defaults).

## Step 1: Load configuration

Do the same as `erd-build` Step 1: read `project-terrarium.yaml` (if missing, stop and tell the
user to run `/project-terrarium:setup`), resolve the config keys, and confirm `staging_dir` is
git-ignored. Also resolve `sharepoint.deck_folders` (default `[]`), `maintain.lookback_days`
(default 3) and `maintain.auto_accept` (default `[]`). A missing key never fails the run.

- If `<erd_dir>/ERD.md` doesn't exist, stop and tell the user to run `/project-terrarium:erd-build` first.
- If `<erd_dir>/sources.md` is missing, run the **Migration** from the `erd-build` skill (Step 2).
- Read the ERD's current Version (`BASE_VERSION`) and record the set of all `E-`, `R-`, `A-` and
  `Q-` IDs in it (`IDS_BEFORE`).
- Resolve `decisions_path` = `<erd_dir>/DECISIONS.md` (it may not exist; a missing file never fails a run), and record
  `DEC_CITES_BEFORE`: `Grep -o "\[DEC-[0-9]+\]"` with the element IDs on `ERD.md` (a list of `E-n`/`R-n` ↔ DEC pairs is
  enough). The contract is `../erd-assist/references/decisions-format.md`.

Let `RUN` = today's date (`YYYY-MM-DD`) and `STAGE` = `<staging_dir>/<RUN>`.

## Step 2: Discover (Gate A)

Follow `references/delta-discovery.md`. Show one compact table of **new and changed** candidates
only (ID-to-be, kind, title, date, location, new/changed). For known sources, give only a count.
Get the user's confirmation or pruning **before** reading any full content.

If nothing is new or changed, report "ERD v<n> is current as of <watermark>; nothing new found",
list any "Not included" items (e.g. recordings without a transcript file), and **stop without writing
anything**.

## Step 3: Stage

Stage the confirmed sources into `STAGE` per `source-gathering.md` §6, writing
`STAGE/sources-manifest.md` with global IDs. Allocate IDs from `sources.md`, append the new rows,
and mark any replaced rows `superseded by S<new>`. Let `NEW_IDS` = the IDs allocated this run.

## Step 4: Propose (erd-analyst, maintain)

Launch the `erd-analyst` subagent (foreground) with: `mode: maintain`, `staging_dir: STAGE`,
`ledger_path: <erd_dir>/sources.md`, `erd_path: <erd_dir>/ERD.md`, `decisions_path`, `format_spec` and
`changeset_spec` (absolute), `change_set_path: <erd_dir>/changes/<RUN>-changeset.md`,
`new_source_ids: NEW_IDS`, `changes_dir: <erd_dir>/changes`, the `project` block, and any focus
from `$ARGUMENTS`.

Verify that:
- the change set exists and follows `changeset-format.md`;
- every Evidence citation uses an ID in `NEW_IDS`;
- every Target ID exists in `ERD.md` or is provisional (`E-new-<k>` etc.);
- every modifying, breaking or conflict op has Supersedes;
- every op whose Target is in an active DEC's Affects (read the active rules from `decisions_path`: `Grep` pattern
  `^\| DEC-[0-9]+ \|[^|]*\| Active \|`) is class `conflict` with `[DEC-n]` in Supersedes.

If any check fails, send the agent back once with the specific problem.

## Step 5: Gate C, change-set decision

- **List DEC conflicts first**, as `CS-n reverses DEC-m (<rule>)`. Always require an explicit choice for them.
- Summarize by class: one line per op, with conflicts listing **both** sides (Evidence and
  Supersedes).
- Pre-accept the classes in `maintain.auto_accept`, **except** a `raise-question` marked
  `Pairs with CS-<n>`: it waits for the decision on its conflict op.
- Suggest accepting the additive ops. Modifying, breaking and conflict ops need an **explicit**
  choice.
- Accept replies like `accept all`, `accept additive`, `accept CS-1,CS-4`, `reject CS-7: <reason>`.
  Ops not mentioned stay `pending`; ask about them before continuing.
- For a conflict op, the user picks **one** of: accept the conflict op, or accept its paired
  `raise-question` op instead (reject the other). Never apply both.
- Write the Decision column and the `Decided` date into the change set yourself. This, plus the
  Status line in Step 7, is all you edit.
- If nothing is accepted, stop. The change set (all rejected) and the ledger are the only outputs.

## Step 6: Apply (erd-analyst, apply)

Launch `erd-analyst` with: `mode: apply`, `staging_dir: STAGE`, `ledger_path`, `erd_path`, `decisions_path`,
`format_spec` and `changeset_spec` (absolute), `change_set_path` (Decisions filled), and the
`project` block.

Verify that:
- the required sections are present (including *Change log*);
- all citations resolve against the ledger;
- Version went up by exactly 1 from `BASE_VERSION`;
- no ID in `IDS_BEFORE` has disappeared (diff the ID set before and after);
- the Change log row for this version is present;
- every pair in `DEC_CITES_BEFORE` is still present, unless an accepted op superseded that DEC;
- every DEC listed in an accepted op's Supersedes has its Index Status (and block Status) set to
  `Superseded by CS-<n> (<changeset file>)`.

If any check fails, send the agent back once with the specific problem.

## Step 7: Delta review and Gate B

Launch `appian-erd-reviewer` with: `erd_path`, `decisions_path`, `ledger_path`, `staging_dir`, `scope: delta`,
`changed_ids` (the final IDs touched by accepted ops, from the ID map), `change_set_path`,
`checklist` and `review_format` (absolute), the `project` block, and `round: 1`. The reviewer
reviews in full by itself when an accepted `breaking` or `conflict` op is present.

Save its final message **verbatim** to `<erd_dir>/reviews/<RUN>-appian-review.md`. If that file
exists from a same-day build, use `<RUN>-maintain-review.md`. Append `-r2` for round 2. Set the
ERD header's `Status` line to `Reviewed: <verdict>`.

Then run **Gate B exactly as in `erd-build`** (Step 5): summarize, and on "Approve with
changes / Rework" offer to send findings to `erd-analyst` with `mode: revise` (pass `decisions_path`), then re-review
(`round: 2`). **At most 2 review rounds.**

## Step 8: Finish

Report:
- files written or changed (`ERD.md`, change set, `sources.md`, review) as clickable links
- the staging path (and a reminder that it's git-ignored and holds raw source text)
- the still-open questions
- the "Not included" sources
- any Technical Decisions superseded this run (`DEC-n by CS-m`)

Don't commit. Leave that to the user.

## Guardrails

- Microsoft 365 access is **read-only**. Never send, upload, edit, or delete remote content.
- Staged text stays git-ignored. Never copy it into `erd/` or into chat beyond what's needed to confirm sources.
- **Change sets and the ledger are committed files; they must never contain source text.**
- The ERD describes fields, never values. No PII/PHI.
- The reviewer never edits files. If its output isn't in review format, re-prompt it.
- Never commit.
