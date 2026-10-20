---
name: erd-lucid
description: Sync the project's ERD.md with one living Lucidchart document. `push` draws the ERD in Lucid (first push creates the doc, later pushes update it in place and never move a table a person placed); `pull` reads edits people made in Lucid and proposes them as a reviewable change set for ERD.md. Use when the user mentions Lucid or Lucidchart, or wants to push, sync or publish the ERD to Lucid, or pull, import or sync changes back from Lucid.
argument-hint: "push|pull [path/to/ERD.md]"
---

# ERD Lucid sync

`ERD.md` stays the canonical model. The Lucid document is a view the team can look at and edit, and a *source*:
edits made there come back into `ERD.md` only as a change set the user accepts at Gate C.

All logic is in a zero-dependency Node tool (`tools/erd-lucid/erd-lucid.mjs`, Node 18+). It plans pushes, diffs
snapshots and records state. **You only move files between that tool and the Lucid MCP tools. Never hand-write
Lucid scripts**: run the generated ones verbatim.

Arguments: `$ARGUMENTS` = `push` or `pull`, then an optional path to `ERD.md` (empty means `<erd_dir>/ERD.md`).

## Prerequisites

- The **Lucid** MCP connector (`mcp__Lucid__*` tools). If it is missing, tell the user to add it under
  *Settings → Connectors* and stop. Everything runs as the signed-in user, with their Lucid permissions.
- Read `lucid://skills/readme` (`get_mcp_resource`) once per session, as the connector asks.
- `node` on the path. If it is missing, say so and stop.

Resolve `<plugin-root>` (two levels above this skill's base directory). Read `project-terrarium.yaml`
(if missing, tell the user to run `/project-terrarium:setup`), then resolve:
`erd_dir` (default `erd`), `lucid.folder_id` (optional), `lucid.document_title` (default `<project.name> ERD`).
`ERD` = the argument or `<erd_dir>/ERD.md`. If it doesn't exist, tell the user to run `/project-terrarium:erd-build`.
`STATE` = `<erd_dir>/lucid.json` (committed; only this tool writes it). `TOOL` = `node <plugin-root>/tools/erd-lucid/erd-lucid.mjs`.
`SCRATCH` = your scratchpad directory (never the repo): snapshots, batches and id maps live there.

Only ever touch the document recorded in `STATE`. Other Lucid documents (for example hand-built ERDs) are left alone.

## push

1. **First push** (no `STATE`, or `STATE` has no baseline):
   1. Confirm the document title with the user. Create the doc with `lucid_create_erd` (`product: "lucidchart"`,
      one placeholder entity named `SEED`, no relationships), then run a script that deletes it
      (`skills.basecanvasediting.deleteItem({ itemIds: skills.erds.list().map(e => e.id) })`). That is the only script you write.
   2. If `lucid.folder_id` is set, move it with `lucid_update_document(parent: <folder_id>)`.
   3. `TOOL init --state STATE --doc-id <id> --doc-url <editUrl> --title "<title>"`.
2. **Incremental push**: run the snapshot script and save its result:
   `TOOL snapshot-script` prints the script; run it with `lucid_run_script` and write the returned JSON to
   `SCRATCH/snapshot.json`. Pass `--snapshot SCRATCH/snapshot.json` below.
3. Plan: `TOOL push-plan ERD --state STATE [--snapshot SCRATCH/snapshot.json] --out SCRATCH/push`.
   - **Exit 3** (`Lucid has N unpulled change(s). Run pull first.`): tell the user to run `pull` and **stop**.
     A push never overwrites an edit made in Lucid. There is no force option.
   - "Lucid doc matches ERD v<n>." means there is nothing to push: report it and stop.
   - Print any `warning:` lines (for example tables or lines in Lucid that `ERD.md` does not know; they are left alone).
   - **Deletes need a yes.** If `SCRATCH/push/plan.json` counts any `delete-entity` or `delete-rel` (an entity or line that `ERD.md`
     deprecated), say how many and which ids, remind the user that a deleted table takes its lines, and any styling or notes
     added to it in Lucid, with it, and ask before running the batches.
4. Run `SCRATCH/push/batch-001.js`, `batch-002.js`, … **in order**: `Read` each file and pass its text unchanged as
   `source` to `lucid_run_script` for the document in `STATE`. Each returns `{ ok, created: { <ERD_ID>: <lucid id> }, errors }`.
   Merge every `created` map into `SCRATCH/ids.json`. A failed batch reverts itself (Lucid scripts are atomic): stop,
   report which batch and the error, and **do not record**. A rerun is safe (every op is idempotent).
5. Record: `TOOL record --push ERD --ids SCRATCH/ids.json --state STATE`.
6. Look at the result: `lucid_export_document_as_PNG`, then check it. If tables overlap or lines run through tables,
   run `skills.basecanvasediting.rerouteLines` on the affected lines, and nudge **only newly created** tables
   (never move a table a person placed). Report the document URL, the counts from the plan, and any warnings.
7. Remind the user that `STATE` and `ERD.md` are committed files (the tool never commits).

## pull

1. Needs `STATE` with a baseline. Without it: "Nothing to pull. Run `push` first."
2. Snapshot as in push step 2, but save it to `.project-terrarium/staging/lucid-<RUN>.json` (git-ignored). `RUN` = today.
3. **Dry run:** `TOOL pull-diff ERD --state STATE --snapshot <that file> --source S? --run RUN [--decisions <erd_dir>/DECISIONS.md] --dry-run`.
   If it says `Lucid doc matches ERD v<n>.`, report that (plus any `not proposed:` lines) and stop. Nothing is written.
4. **Ledger row** in `<erd_dir>/sources.md` (allocate the next `S<n>`): Kind `lucid-diagram`, Title = the document
   title, Date = the snapshot date, Location = the document URL, Fingerprint = `lucid:<lastModified>` from
   `lucid_get_document_metadata` (fall back to `lucid:<takenAt>`), Ingested = today, Staged file = `lucid-<RUN>.json`,
   Status `active`. Mark the previous `lucid-diagram` row `superseded by S<n>`.
5. Run it for real: the same command with `--source S<n>` and without `--dry-run`. It writes
   `<erd_dir>/changes/<RUN>-lucid-changeset.md` (a second pull on the same day gets `<RUN>-2-…`).
6. **Gate C and apply: follow `skills/erd-maintain/SKILL.md` Step 5 and Step 6 exactly** (same questions, same
   pre-accept rules, same `erd-analyst` apply mode, Version + 1, a Change log row naming this change-set path and
   the accepted count). Evidence in this change set is `[S<n> §TABLE]` or `[S<n> §TABLE.COLUMN]`. Do not duplicate
   those steps here, and do not run the delta Appian review unless the user asks.
7. After apply: `TOOL record --pull ERD --snapshot <that file> --state STATE --source S<n>`. This sets the baseline from
   the new `ERD.md`. Then offer a **push**: any rejected op means Lucid now differs from `ERD.md`, and the push puts it
   back in line; it also stamps tables accepted from Lucid with their ids.

## Guardrails

- The change set and `STATE` are committed. They hold no source text. The snapshot in `.project-terrarium/staging/` is git-ignored.
- Never edit `ERD.md` yourself: only through the accepted change set and `erd-analyst` apply mode.
- Never delete the Lucid document, and never run any other script against it than the ones the tool generated.
- Lucid is not mocked anywhere: if a script fails, show the error rather than improvising a fix.
- Know the limits (say them if asked): a push deletes the Lucid tables and lines that `ERD.md` has deprecated (with the styling
  and notes people added to them), and re-routes the lines it creates or re-pins (a route somebody tidied by hand on such a line is
  redone; tables and the routes of other lines are never touched); there is no headless or CI sync; layout is never read back; citations, descriptions
  (other than Purpose), assumptions and questions live only in `ERD.md`; renaming a field in Lucid is a heuristic
  (Confidence Medium); a copy-pasted table loses its identity.
