---
name: erd-view
description: Render the project's ERD.md as an interactive, self-contained HTML diagram (pan/zoom, search, filter by kind or sensitivity, focus on one entity and its neighbors, export SVG/PNG). Use when the user wants to see, view, open, render, or visualize the ERD or data model, or when the Mermaid diagram in ERD.md is too large to render.
argument-hint: "[path/to/ERD.md]"
---

# ERD view

Convert an `ERD.md` into one offline HTML file. The tool is a zero-dependency Node script
(Node 18+), so there is nothing to install and the ERD content never leaves the machine.

Arguments: `$ARGUMENTS` (optional path to the ERD; empty means the project's ERD).

## Steps

1. **Find the ERD.** Use the argument if given. Otherwise read `outputs.erd_dir` (default `erd`) from
   `project-terrarium.yaml` and use `<erd_dir>/ERD.md`. If the file doesn't exist, tell the user to run
   `/project-terrarium:erd-build` first.
2. **Render.** Resolve this skill's plugin root (two levels above this skill's base directory) and run:
   ```bash
   node <plugin-root>/tools/erd-view/erd-view.mjs <path-to-ERD.md>
   ```
   The output is `ERD.html` beside the input. Pass `-o <path>` to change it.
   If `node` is missing, say so and stop; don't try to install anything.
3. **Report.** Give the user the output path as a clickable link, the entity/relationship counts, and any
   `warning:` lines the script printed (for example a many-to-many without a junction entity, or an entity
   that appears only in the Mermaid block). Warnings mean the ERD and its Mermaid block disagree; point the
   user to `erd-analyst` revise mode rather than editing the ERD yourself.
4. If the user is working in a cloud session and can't open local files, say the HTML must be downloaded
   from the session to open it.

## Notes

- `ERD.html` is git-ignored: it embeds the ERD text, which may describe PII/PHI fields.
- The viewer reads the Entities and Relationships tables (richer than Mermaid) and falls back to the
  Mermaid block for anything the tables don't cover.
- Viewer tips to relay if asked: `/` searches, click selects an entity and highlights its neighbors,
  double-click zooms to it, *Focus selected* shows only an entity's N-hop neighborhood, hiding Reference
  tables in the Kind filter removes most clutter on large models.
