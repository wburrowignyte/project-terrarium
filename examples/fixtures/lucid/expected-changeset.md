# ERD change set: 2026-10-20 (Lucid)

| | |
|---|---|
| Base ERD version | 1 |
| New sources | S9 (see `sources.md`) |
| Proposed | 3 additive · 2 modifying · 1 breaking · 0 conflict |
| Decided | pending |

## Summary
Edits made in the Lucid document (https://lucid.app/lucidchart/doc-1/edit), read at 2026-10-20T12:00:00.000Z, differ from ERD v1 in 6 proposed change(s). Citations point at the tables and rows of that document.

## Proposed changes
| ID | Class | Op | Target | Change | Evidence | Supersedes | Confidence | Decision |
|---|---|---|---|---|---|---|---|---|
| CS-1 | modifying | modify-field | E-10.kind | Kind Reference → Core | [S9 §CCA_PROVIDER_LICENSE_TYPE] | [S3 @00:09:15] | High | pending |
| CS-2 | additive | add-field | E-2.preferredName | PREFERRED_NAME Text(60), Req N, Key — | [S9 §CCA_HOUSEHOLD_MEMBER.PREFERRED_NAME] | — | High | pending |
| CS-3 | modifying | modify-field | E-9.licenseNumber | Type Text(20) → Text(30) | [S9 §CCA_PROVIDER.LICENSE_NUMBER] | [S3 @00:09:15] | High | pending |
| CS-4 | additive | add-entity | E-new-1 CCA Provider Capacity (`CCA_PROVIDER_CAPACITY`) | Group: Provider. Kind: Core. Licensed slots per provider. Fields: id Integer, providerId Integer, licensedSlots Integer | [S9 §CCA_PROVIDER_CAPACITY] | — | High | pending |
| CS-5 | breaking | deprecate | R-17 | Line CCA_CHILD → CCA_HOUSEHOLD_MEMBER (via HOUSEHOLD_MEMBER_ID) was deleted in Lucid | [S9 §CCA_CHILD.HOUSEHOLD_MEMBER_ID] | [S1 §Glossary] | High | pending |
| CS-6 | additive | add-relationship | R-new-1 | E-new-1 → E-9 via PROVIDER_ID (many-to-one) | [S9 §CCA_PROVIDER_CAPACITY.PROVIDER_ID] | — | High | pending |

## Field detail
### CS-4
| Field | Column | Type | Req | Key | Description | Sources |
|---|---|---|---|---|---|---|
| id | ID | Integer | Y | PK | — | [S9 §CCA_PROVIDER_CAPACITY.ID] |
| providerId | PROVIDER_ID | Integer | Y | FK→E-9 | — | [S9 §CCA_PROVIDER_CAPACITY.PROVIDER_ID] |
| licensedSlots | LICENSED_SLOTS | Integer | N |  | — | [S9 §CCA_PROVIDER_CAPACITY.LICENSED_SLOTS] |

## Not proposed
- (none)
