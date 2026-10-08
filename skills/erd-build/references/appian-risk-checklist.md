# Appian ERD risk checklist

The `appian-erd-reviewer` works through every section of this checklist against `ERD.md`. Each item is a
**risk to probe**, not an automatic finding: raise it only when the ERD actually exhibits it.
Limits below were checked against Appian docs 26.x (October 2026). If the project runs an older
version, confirm against `search_appian_knowledge_sources` and cite the page.

Severity guide:
- **High:** will break the build, block a required feature, or create a security/compliance exposure.
- **Medium:** forces rework later, degrades performance at expected volume, or violates a convention the team relies on.
- **Low:** style, clarity, or a minor convention gap.

## 1. Keys and identity
- [ ] Every entity has a single integer surrogate PK `id`/`ID`. **High** if missing.
- [ ] Composite primary keys. Appian supports them on record types, but a composite-key record
  type **can't be the "one" side** of a relationship, and one-to-many relationships *to* it force
  "write/delete related records" on. Usually **Medium**: recommend surrogate `id` + unique constraint.
- [ ] Natural/business keys (case number, MAXIS/METS IDs, PMI) modeled as `UK` fields, not PKs.
- [ ] Every FK matches the type of the field it references. Relationship common fields must be
  Integer, Text, User, or Group, with **identical types** on both sides. **High** on mismatch.

## 2. Relationships
- [ ] No direct many-to-many relationships. Appian has none; each needs a junction record type with its own PK and two
  many-to-one relationships. **High** if one is modeled directly.
- [ ] The one-side of every relationship is unique (PK or unique constraint); one-to-one is unique on both sides.
- [ ] Relationships are declared bidirectionally (each many-to-one implies the parent's one-to-many).
- [ ] Deep chains: real-time custom record fields can traverse at most **5** relationship levels.
  Flag reporting/derived needs that require more.
- [ ] One-to-many queries return at most **100 related rows per base record**. Flag parents that will
  routinely exceed that and are expected to show children inline (e.g. case → notes, payments).
- [ ] Optional vs required FK: does nullability match the business rule in the sources?
- [ ] Circular or ambiguous paths (two routes from A to C) that will confuse record-level security or reporting.

## 3. Normalization and reference data
- [ ] Enumerations with 3+ values are reference tables, not Text fields. **Medium**.
- [ ] Reference tables pass the 5-criteria test (small and static (<50 rows), controlled vocabulary, lookup purpose,
  no temporal attributes, only outward one-to-many relationships) and carry `label`, `sortOrder`, `isActive`.
- [ ] Entity-scoped status tables (`<ENTITY>_STATUS`) and the project's shared `<PREFIX>_LOOKUP` are both
  acceptable. A bare, shared `STATUS` table never is.
- [ ] The database can't enforce that a LOOKUP FK points at a row of the right `LOOKUP_TYPE`. Is validation
  planned (a check in the interface/process layer, or a per-type view)? **Medium**.
- [ ] Values with lifecycle rules (allowed transitions) or extra attributes are forced into LOOKUP instead of
  a dedicated table. **Medium**.
- [ ] A LOOKUP FK (`FK→LOOKUP:<TYPE>`) has no row in Relationships. Appian needs one relationship per FK. **Low**.
- [ ] Multi-valued attributes (comma lists, "field1/field2/field3") become child or junction tables.
- [ ] Repeating groups and derived values: derived values should be custom record fields, not stored columns,
  unless the sources require point-in-time snapshots (common for eligibility determinations, so check).
- [ ] 1:1 splits are justified (4+ fields, sensitivity separation, or optional groups); otherwise inline.

## 4. Naming and platform limits
- [ ] Table/column names ≤ **30 characters** when the target DB is Oracle. **High** for Oracle, **Low** otherwise.
- [ ] Application prefix on every table; singular names; conventions per `erd-format.md`.
- [ ] Reserved words used as table/column names (`USER`, `GROUP`, `DATE`, `COMMENT`, `ORDER`, `LEVEL`, `SIZE`).
- [ ] Record types are limited to **100 fields total** (source + custom record fields; max 40 custom).
  Flag entities above ~80 source fields as **Medium** (no headroom).
- [ ] Long text: values over 4,000 characters need **Extra Long Text** (≤64,000 chars). It can't be returned
  through one-to-many related queries, and a record type allows only one for smart search.
  Narrative fields (case notes, justifications) need an explicit type decision.

## 5. Volume and data sync
- [ ] Estimate rows per entity over the retention period. Synced row limits depend on the capability tier:
  Standard **4M**, Advanced **20M**, Premium no set limit. Anything near the tier limit needs sync filters
  or direct data access. **High** if a high-volume entity (history, audit, payments, notices) has no
  volume estimate.
- [ ] Write Records / Write to Multiple Data Store Entities smart-service sync handles ≤ **1,000 rows per call**.
  Flag batch-loaded entities (conversions, nightly interfaces).
- [ ] Soft delete (`isActive`/`isDeleted`) on entities that need history; sync filters will need it.
- [ ] Entities sourced from external systems (MAXIS, METS, MMIS, SSIS, etc.): the ERD should say whether they're
  replicated tables, direct-access record types, or integration-fed. Mixed synced/unsynced relationships run
  as federated queries and carry performance risk.

## 6. Security and compliance (public sector / DHS)
- [ ] Sensitivity marked on every entity holding PII, PHI, FTI (IRS 1075), or CJI. **High** if obviously sensitive
  fields (SSN, DOB, diagnosis, income, immigration status) sit on an entity marked `None`.
- [ ] Record-level security has a data path: can each sensitive record be tied to the county / agency /
  program / worker that governs access, via fields or relationships on that record (or ≤1 hop)?
  **High** if the access rule in the sources can't be evaluated from the model.
- [ ] Field-level security candidates (SSN, etc.) noted, or sensitive fields split into a separate entity.
- [ ] Audit: `createdBy`/`createdAt`/`modifiedBy`/`modifiedAt` (User / Date and Time) on transactional entities;
  an event-history entity where the sources require "who changed what when" or Process HQ analysis.
- [ ] Retention/purge rules from the sources reflected (dates and flags needed to drive purge).

## 7. Traceability and completeness
- [ ] Every entity and field has a source citation or an explicit `ASSUMPTION`/`CONVENTION`.
- [ ] High-impact assumptions (cardinality, ownership, volume) that should become open questions.
- [ ] Concepts that are prominent in the sources but missing from the model, or modeled entities never mentioned in the sources.
- [ ] Mermaid diagram consistent with the Entities and Relationships tables (names, cardinality, keys).
