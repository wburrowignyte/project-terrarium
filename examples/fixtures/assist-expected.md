<!-- TEST FIXTURE: expected outcomes for erd-assist and for erd-maintain against decisions, for manual comparison.
     Setup A (assist): copy fixtures/baseline/{ERD.md,sources.md} and fixtures/decisions/DECISIONS.md into
     sample-project/erd/, run `claude --plugin-dir ../..` from sample-project, then /project-terrarium:erd-assist.
     Setup B (maintain): copy fixtures/decisions/ERD-with-decs.md as sample-project/erd/ERD.md, plus baseline/sources.md and
     decisions/DECISIONS.md, then /project-terrarium:erd-maintain (new sources S4, S5 as in maintain-expected.md).
     Wording differs between runs; IDs, versions, classes and file edits should match.
     Baseline IDs: E-11 CCA Authorization, E-9 CCA Provider, E-8 CCA Child, R-8 child–authorization. -->

# A. Scripted assist session (baseline ERD v1, DECISIONS.md with DEC-1–DEC-4)

- [ ] **Brief.** At most 6 lines: ERD v1, Status Draft; last run = full build (14 entities); 1 open question (Q-1); 3 active
  decisions; no uncommitted ERD changes (or whatever `git diff --stat` shows). The transcript has **no full `Read` of
  `ERD.md` or `DECISIONS.md`**: only `erd-slice` calls, a `Grep` of the Index for active rules, and `git diff --stat`.
- [ ] **"What does E-8 relate to?"** Answered from `erd-slice --ids E-8 --neighbors` (E-7 Case via R-7, E-2 Household Member
  via R-17, E-11 Authorization via R-8). No other section of the ERD is read.
- [ ] **"Make E-11.endDate required."** Plan: `modify-field`, class modifying, no active DEC touches `E-11.endDate`.
  - `DECISIONS.md`: DEC-5 appended (Index top row; block at the end; header `Last ID` DEC-5, `Active` 4, `Last updated` today).
  - `ERD.md`: E-11 `endDate` row has Req `Y` and cites `[DEC-5]`, with its `[S3 @00:06:30]` citation kept. Mermaid unchanged
    (it has no Req marker).
  - Version 1 → **2**; Change log row `| 2 | <today> | assist DEC-5 | … |`.
  - `erd-slice --check E-11 --decisions …` prints `ok`; `ERD.html` is re-rendered with no new warnings.
  - Reply is at most 4 lines.
- [ ] **"Also rename E-9.address to providerAddress."** Class breaking. The assistant states the effect in one line (field row,
  Mermaid `ADDRESS` column unchanged if only the record field is renamed) and proceeds.
  - DEC-6 appended. `[DEC-6]` added to the row. DEC-2 is already superseded, so no supersede question.
  - **No second Version bump.** Version stays 2, and the Change log row now reads `assist DEC-5–DEC-6`.
- [ ] **"Change E-11.authorizedHoursPerWeek to Decimal."** The assistant asks once: "This reverses DEC-1 (Store authorized hours as
  whole-hour Integer). Supersede it?" On yes:
  - DEC-7 appended with `Supersedes: DEC-1`; DEC-1 is `Superseded by DEC-7` in **both** the Index and its block; header
    `Active` is updated.
  - E-11 `authorizedHoursPerWeek` Type becomes `Decimal(5,2)` and cites `[DEC-7]`; Mermaid type becomes `decimal`.
  - Change log row reads `assist DEC-5–DEC-7`; Version is still 2.
  - Because rename (breaking) was applied, Step 5 offers a delta review (`changed_ids` = E-11, E-9) saved as
    `reviews/<RUN>-assist-review.md`.
- [ ] **"We decided not to model provider ratings."** A decision-only DEC-8 (Affects `global`). **No `ERD.md` edit**, so no
  version change and the Change log row is not touched. Confirmed in one line.

# B. Maintain respects decisions (Setup B)

- [ ] The S4 op on `E-11.authorizedHoursPerWeek` (Integer → Decimal, Evidence `[S4 @00:01:10]`) is class **conflict**,
  op `modify-field`, `Supersedes [DEC-1]` (plus `[S3 @00:06:30]`), paired with a `raise-question` citing both
  `[S4 @00:01:10]` and `[DEC-1]`. The `E-12.authorizedHoursPerWeek` op (history copy) may be `modifying` or also `conflict`:
  DEC-1 names only the E-11 field.
- [ ] No other op targets DEC-4's `E-2` / `R-2` or the global rule DEC-3 (the S5 `E-new-2` Age Group reference table has
  only ID and NAME, so it agrees with DEC-3; if the analyst adds a free-text field to it, that op is a `conflict` under DEC-3).
- [ ] Gate C lists `CS-n reverses DEC-1 (Store authorized hours as whole-hour Integer)` **first** and requires an explicit
  choice. The `Pairs with` question is not auto-accepted.
- [ ] **Run 1, reject the conflict op** (accept its paired question if desired). After apply:
  `authorizedHoursPerWeek` in E-11 is still `Integer` with `[DEC-1]`; DEC-1 is still `Active` in the Index. The
  `DEC_CITES_BEFORE` check passes.
- [ ] **Run 2, accept the conflict op.** After apply: E-11 is `Decimal(5,2)`; DEC-1 reads
  `Superseded by CS-<n> (<changeset file>)` in the Index **and** the block; header `Active` is 2; the `[DEC-1]` citation
  is gone from E-11 only because an accepted op superseded it. Step 8 lists "DEC-1 by CS-<n>". `erd-slice --check` then
  warns for any leftover non-Active `[DEC-n]` citation, never errors.
- [ ] Recovering from a missing file: delete `DECISIONS.md` and run `/project-terrarium:erd-maintain` on the baseline ERD.
  It behaves exactly as before this module (a missing log is an empty log).
