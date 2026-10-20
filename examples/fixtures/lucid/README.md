# Lucid sync fixtures

Synthetic test data for `tools/erd-lucid/`. Nothing here came from a real Lucid document.

- `lucid.json`: the state file right after a push of `../baseline/ERD.md`. Its document id and URL (`doc-1`) are made up.
- `snapshot-faithful.json`: what the snapshot script returns for a Lucid doc that matches that ERD exactly.
- `snapshot-edited.json`: the same doc after five edits (a new row, a changed type, a deleted line, a new table with a Group, a changed Kind).
- `expected-changeset.md`: the change set `pull-diff` must produce from `snapshot-edited.json` (compared by `pull-diff.test.mjs`).

Do not copy these into a real `erd/` folder: a real `lucid.json` is written only by `erd-lucid`.
