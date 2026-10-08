<!-- TEST FIXTURE: expected change set for erd-maintain, for manual comparison.
     Setup: copy fixtures/baseline/{ERD.md,sources.md} into sample-project/erd/, then run
     /project-terrarium:erd-maintain from sample-project. New sources are S4 (2026-10-01 transcript)
     and S5 (2026-10-05 deck). Wording and CS numbering will differ; class + op + target should match.
     Target IDs refer to baseline/ERD.md (E-11 Authorization, E-9 Provider, R-8 child–authorization). -->

# Expected ops

## From S4: 2026-10-01-provider-followup.vtt
- [ ] modifying · modify-field · E-11.authorizedHoursPerWeek (and E-12.authorizedHoursPerWeek): Integer → Decimal; Supersedes [S3 @00:06:30]; Evidence [S4 @00:01:10]
- [ ] modifying · resolve-question · Q-1: co-payment is per authorization; Evidence [S4 @00:02:20]
- [ ] additive · add-field · E-11.copaymentAmount (Decimal), Evidence [S4 @00:02:20]
- [ ] conflict · modify-relationship (or deprecate) · R-8 / E-11: only one active provider per child at a time; Supersedes [S3 @00:05:12]; Evidence [S4 @00:03:30]
- [ ] additive · raise-question · paired with the conflict op, citing both [S3 @00:05:12] and [S4 @00:03:30]
- [ ] additive · add-citation · E-11 start/end date and E-12 (already modeled); Evidence [S4 @00:04:40]

## From S5: 2026-10-05-provider-design-review.pptx
- [ ] additive · add-entity · E-new-1 CCA Provider Capacity (`CCA_PROVIDER_CAPACITY`): providerId FK→E-9, ageGroupId FK→E-new-2, licensedSlots Integer; Evidence [S5 slide 2]
- [ ] additive · add-entity · E-new-2 CCA Age Group (reference: infant, toddler, preschool, school-age); Evidence [S5 slide 2]
- [ ] additive · add-field · E-9.contactEmail (Text); Evidence [S5 slide 3]
- [ ] additive · raise-question · slide 4 is image-only (`[visual content not extracted]`); Evidence [S5 slide 4]
- [ ] breaking · modify-field · E-9.licenseNumber: Key → UK; Evidence [S5 slide 5] (speaker notes)

## Checks
- Gate C: the breaking op and the conflict op need an explicit choice; additive ops are suggested.
- Because a breaking and/or conflict op is accepted, the review runs in full scope.
- Re-running with no changes: "ERD v2 is current"; nothing written.
- Touching the deck (new fingerprint): S5 is superseded by a new ID; rejected ops are not re-proposed.
