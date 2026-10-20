# Handoff: run ERD view and ERD assist directly in this repo (temporary)

**This file is the build spec.** If you hit a question it doesn't answer, choose the option most consistent
with the existing `erd-view` / `erd-assist` skills and record it under "Implementation notes" at the end.

Work on branch `dev`. Commit in logical steps (suggested points are marked ✅). Push to `origin dev`.
Don't open a pull request unless the user asks.

---

## 1. Problem and decision

The skills are built to run as the `project-terrarium` plugin inside a separate project repo. That remains the
target. For now the user needs to run **`erd-view`** and **`erd-assist`** from a Claude Code session opened on
**this** repo, including cloud sessions.

Today that doesn't work:

- Nothing loads the plugin when Claude Code opens this repo. `.claude/settings.json` only enables `context-guard`.
- The only documented way in is `claude --plugin-dir <this repo>`, which a cloud session can't pass.
- There is no `project-terrarium.yaml` or `erd/` directory at the repo root, so there is nothing for the skills to act on.

**Approaches tested and rejected:**

| Approach | Why not |
|---|---|
| Declare the local marketplace in `.claude/settings.json` (`extraKnownMarketplaces` with `"source": "directory"`) and enable `project-terrarium@project-terrarium-dev` | `claude plugin marketplace add ./ --scope project` writes an **absolute** path, which breaks on every other machine or container. With `"path": "./"` and a clean `HOME`, `claude plugin install` fails with *Plugin "project-terrarium" not found in marketplace*. |
| Symlink `skills/erd-view` into `.claude/skills/` | Both skills find the plugin root as "two levels above this skill's base directory". Through a symlink that resolves to `.claude/`, so `tools/` isn't found. Symlink handling is also not guaranteed across platforms. |

**Decision:** add two **thin project-skill wrappers** under `.claude/skills/`. Each wrapper tells the model to
follow the real plugin skill file and states the paths explicitly. Add a root `project-terrarium.yaml` that
points at a dedicated workspace ERD directory. **Don't change any plugin skill, agent, tool or contract.** When
the work moves to the project repo, deleting the files this spec adds undoes it.

Commands in this repo become `/erd-view` and `/erd-assist`. They are project skills, so they have no
`project-terrarium:` prefix.

## 2. Decision needed from the user (default chosen)

**Should the workspace ERD be committed to this repo?**

- **Default: commit it.** `ERD.md` and `DECISIONS.md` are designed to be committed. `DECISIONS.md` is the binding
  history. Cloud containers are reclaimed, so a git-ignored file is lost when the session ends. These files hold field
  names and rules, never PII/PHI values.
- **Alternative: git-ignore `workspace/`.** Choose this if the real client data model shouldn't live in the plugin
  repo. Note that the plugin's marketplace `source` is `./`, so anything committed here is also copied into every
  consumer's plugin install. With this option the user must copy the files out before the session ends.

Build with the default unless the user said otherwise. The only difference is one `.gitignore` line (§3.4).

## 3. Changes

### 3.1 `project-terrarium.yaml` (new, repo root)

Keep it minimal. `erd-view` and `erd-assist` only read `outputs.erd_dir`, and `project.prefix` and
`project.lookup_table` for the LOOKUP conventions.

```yaml
# project-terrarium configuration for running erd-view / erd-assist inside the plugin repo (temporary).
# Remove this file, workspace/ and .claude/skills/erd-* when the work moves to the project repo.
project:
  name: "<project name>"   # ask the user; leave the placeholder if unknown
  prefix: "<PREFIX>"       # Appian application prefix, e.g. DHS; ask the user
  database: "Oracle"
  appian_tier: "unknown"

outputs:
  erd_dir: "workspace/erd"
```

There are no `sharepoint`, `context_paths` or `staging_dir` keys: build and maintain are out of scope in this repo (§5).
If the user hasn't given a name and prefix, leave the placeholders and list them in the final report.

### 3.2 `workspace/erd/` (new)

- Add `workspace/erd/README.md`: one short paragraph. Drop `ERD.md` here, plus `DECISIONS.md`, `sources.md`,
  `reviews/` and `changes/` if the project has them. This is temporary and mirrors the project repo's `erd/`.
- Don't add an ERD. The user supplies theirs. Don't copy fixtures here except for testing (§4), and never commit those copies.
- `ERD.html` is already ignored by the existing `**/erd/ERD.html` rule. Confirm with
  `git check-ignore workspace/erd/ERD.html`.

### 3.3 `.claude/skills/erd-view/SKILL.md` and `.claude/skills/erd-assist/SKILL.md` (new)

Copy the frontmatter `name`, `description` and `argument-hint` from the plugin skill. Add one sentence to the
description saying it's the in-repo (temporary) entry point. The body is short and has the same shape in both:

```markdown
# ERD assist (in-repo entry point, temporary)

This repository is the project-terrarium plugin source. This wrapper runs the plugin's skill directly here.

Read `skills/erd-assist/SKILL.md` (relative to the repository root) in full and follow it exactly, with these
substitutions:
- **Plugin root** = the repository root (the directory containing `.claude-plugin/plugin.json`). Don't derive it
  from this wrapper's location.
- **That skill's base directory** = `<repo root>/skills/erd-assist`. Resolve its `references/` and `../erd-build/…`
  paths from there.
- `project-terrarium.yaml` is at the repository root; its `outputs.erd_dir` is `workspace/erd`.
- `$ARGUMENTS` from this invocation are that skill's `$ARGUMENTS`.
- Where it says `/project-terrarium:<skill>`, the in-repo name is `/<skill>` for `erd-view` and `erd-assist`. `erd-build`
  and `erd-maintain` aren't available here; tell the user to run them in the project repo.
```

Specifics for `erd-assist`:

- **Step 5 reviewer offer.** The `appian-erd-reviewer` subagent is registered only when the plugin is loaded. Add a
  substitution: if no agent type named `appian-erd-reviewer` is available, use a `general-purpose` subagent whose prompt is
  the body of `agents/appian-erd-reviewer.md` followed by the same inputs. If that isn't possible either, skip the offer
  and say why.
- Leave the "Never commit" guardrail as it is.

Specifics for `erd-view`: Step 4 already covers cloud sessions, where the HTML must be downloaded to open it. Nothing extra.

Don't add `disable-model-invocation`. The plugin versions are model-invocable, and so are these.

✅ Commit: "Add in-repo entry points for erd-view and erd-assist"

### 3.4 `.gitignore`

- Default (commit the workspace): no change. Verify `workspace/erd/ERD.html` is ignored.
- Alternative (§2): add `workspace/` under a `# temporary in-repo ERD workspace` comment.

### 3.5 `README.md`

Add a section after "Develop / test":

```markdown
## Running ERD view / assist in this repo (temporary)

Until the work moves to the project repo, open Claude Code on this repo and use `/erd-view` and `/erd-assist`.
They are thin wrappers in `.claude/skills/` that run `skills/erd-view` and `skills/erd-assist` with this repo as the
plugin root, against `workspace/erd/` (set in the root `project-terrarium.yaml`). Put your `ERD.md` (and `DECISIONS.md`,
if any) in `workspace/erd/`. `erd-build` and `erd-maintain` still run only from the project repo.

To move out: copy `workspace/erd/` to the project repo's `erd/`, then delete `workspace/`, `project-terrarium.yaml`
and `.claude/skills/erd-*`.
```

Also add one line to `.claude/README.md` saying `skills/` holds the temporary wrappers.

✅ Commit: "Document the temporary in-repo ERD workflow"

## 4. Verification

Run all of these. Record the results in Implementation notes.

1. `node --test "tools/*/test/*.test.mjs"`: all pass (55 today).
2. `claude plugin validate .`: passes. The plugin manifest is unchanged.
3. Smoke test in a **scratch copy** of the repo (`git archive HEAD | tar -x -C <scratch>`), so fixture copies never
   reach the real `workspace/`:
   - copy `examples/fixtures/decisions/ERD-with-decs.md` to `workspace/erd/ERD.md` and
     `examples/fixtures/decisions/DECISIONS.md` to `workspace/erd/DECISIONS.md`; set `prefix` in the yaml to the fixture's
     prefix (read it from the ERD header);
   - `claude -p "/erd-view" --permission-mode acceptEdits`: `workspace/erd/ERD.html` exists, and the reply reports the entity
     and relationship counts;
   - `claude -p "/erd-assist E-11" --permission-mode acceptEdits`: the brief appears, and the transcript shows `erd-slice` run
     from `<repo>/tools/erd-assist/` with no full `Read` of `ERD.md`;
   - follow up with `--continue` and one small change ("make E-11.endDate required, go ahead"): a new DEC is
     recorded, Version +1, and `erd-slice --check` is ok.
4. `git status` in the real repo shows only the files this spec adds.

If `claude -p` can't invoke project skills by slash command in your environment, prompt "Use the erd-view skill"
instead and note it.

✅ Commit any fixes. Push to `origin dev`.

## 5. Out of scope

- `erd-build` and `erd-maintain` in this repo. They need `context_paths`, SharePoint config, staging and the ledger.
  Running them here would put raw source text next to the plugin source. If the user asks later, that's a separate spec.
- Any change to `skills/`, `agents/`, `tools/` or the plugin manifests. The wrappers exist precisely so the plugin
  stays untouched.
- A version bump. The plugin version is unchanged because the plugin didn't change.

## Implementation notes

(Builder: record deviations, verification results and anything the spec didn't answer.)
