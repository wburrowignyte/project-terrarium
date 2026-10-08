---
name: erd-build
description: Build (or regenerate) the project's ERD from Teams meeting transcripts, project context MD files, and SharePoint docs, then have an Appian architect review it for structural risk. Two agents run in sequence — erd-analyst (developer + BA) writes a cited ERD.md; appian-erd-reviewer returns a risk register and verdict — with a human gate and up to one revision round. Use when the user wants to create, generate, build, or rebuild the ERD / data model / entity relationship diagram for the project.
argument-hint: "[meeting/topic filter] [since <date>]"
---

# ERD build workflow

You are the **orchestrator**. You gather sources, run the two agents in order, save their
output, and keep the user in control at the gates. You don't author the ERD or the review
yourself. If an agent's output is wrong, send it back to that agent.

The reference files live in this skill's `references/` directory (this skill's base directory is
shown when it loads). Resolve them to **absolute paths** and pass those to the agents:
- `references/erd-format.md`: the ERD contract
- `references/source-gathering.md`: how to find and stage inputs (you follow this)
- `references/appian-risk-checklist.md`: the reviewer's checklist
- `references/review-format.md`: the reviewer's output contract

Arguments: `$ARGUMENTS` (optional meeting/topic filter and date scope; empty means use the config defaults).

## Step 1: Load configuration

Read `project-terrarium.yaml` at the repo root. If it's missing, stop and tell the user to run
`/project-terrarium:setup`. Resolve:
`project.{name,prefix,database,appian_tier}`, `context_paths`, `sharepoint.*`, `local_inputs`,
`outputs.erd_dir` (default `erd`), and `staging_dir` (default `.project-terrarium/staging`).
Confirm `staging_dir` is git-ignored (`git check-ignore`). If it isn't, stop and fix that first
(offer to add it to `.gitignore`). Sources may contain PII/PHI.

Let `RUN` = today's date (`YYYY-MM-DD`) and `STAGE` = `<staging_dir>/<RUN>`.

## Step 2: Gather and stage sources

Follow `references/source-gathering.md` exactly:
1. Discover candidates: context MD files, meeting transcripts, SharePoint docs, local inputs.
2. **Gate A:** show the candidate table and get the user's confirmation or pruning.
3. Read and stage the confirmed sources into `STAGE`, and write `STAGE/sources-manifest.md`.

If there are **no transcripts and no docs** (only context MDs), say so and ask whether to proceed.

## Step 3: Agent 1, erd-analyst (build)

Launch the `erd-analyst` subagent (foreground; you need its result). The prompt must include:
`mode: build`, `staging_dir: STAGE`, `manifest`, `erd_path: <erd_dir>/ERD.md`, `format_spec`
(absolute), the `project` block, and any focus from `$ARGUMENTS`. If `ERD.md` already exists, tell it
to preserve IDs and increment the version.

When it returns, verify that `ERD.md` exists and has the required sections. Check that
every `[S<n>` citation resolves to the manifest: grep for citations and compare them with the
manifest IDs. If either check fails, send the agent back once with the specific problem.

## Step 4: Agent 2, appian-erd-reviewer

Launch the `appian-erd-reviewer` subagent with: `erd_path`, `manifest_path`, `checklist` and
`review_format` (absolute), the `project` block, and `round: 1`.

Save its final message **verbatim** to `<erd_dir>/reviews/<RUN>-appian-review.md` (append `-r2`
for round 2). Then set the ERD header's `Status` line to `Reviewed: <verdict>`. That one-line
edit is the only change you make to `ERD.md` yourself.

## Step 5: Gate B, human decision

Give the user a short summary:
- the verdict
- counts by severity
- each **High** finding in one line
- the analyst's top assumptions and the number of open questions

Then:
- **Approve:** go to Step 6.
- **Approve with changes / Rework:** ask which findings to send back. Offer *all High + Medium*
  as the default, or let the user pick IDs, or accept as-is.
  - If findings are sent: run `erd-analyst` with `mode: revise`, the review path, and the chosen
    finding IDs. Then run `appian-erd-reviewer` with `round: 2` and the prior review path. Save the
    review as `-r2` and summarize again.
  - **At most 2 review rounds.** After round 2, report the remaining findings as open items and stop.

## Step 6: Finish

Report:
- files written or changed (`ERD.md`, review file(s)) as clickable links
- the staging path (and a reminder that it's git-ignored and holds raw source text)
- the open questions to take to the next stakeholder session
- that `/project-terrarium:erd-view` renders the ERD as an interactive HTML diagram (offer to run it)

Don't commit. Leave that to the user.

## Guardrails

- Microsoft 365 access is **read-only**. Never send, upload, edit, or delete remote content.
- Never copy staged source text into `erd/` or into chat beyond what's needed to confirm sources.
- The reviewer never edits files. If its output isn't in review format, re-prompt it; don't fix it yourself.
