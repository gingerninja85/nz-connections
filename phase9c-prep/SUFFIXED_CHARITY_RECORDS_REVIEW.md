# Suffixed Charity Records Review

Read-only production SELECT review for existing `CC10819-*` and `CC11026-*` records. No production writes.

Rows returned: 10

| entity_id | name | metadata registration | source_id | source record_id | relationships | source_url |
|---:|---|---|---:|---|---:|---|
| 917 | Te Kotahitanga o Te Arawa Waka Fisheries Trust Board | CC10819-1 | 1012 | CC10819-1 | 0 | https://register.charities.govt.nz/CharitiesRegister/ViewCharity?search=1&charityRegistrationNumber=CC10819-1 |
| 918 | Te Arawa Fisheries Limited | CC10819-2 | 1013 | CC10819-2 | 0 | https://register.charities.govt.nz/CharitiesRegister/ViewCharity?search=1&charityRegistrationNumber=CC10819-2 |
| 919 | Te Arawa Fisheries Holding Company Limited | CC10819-3 | 1014 | CC10819-3 | 0 | https://register.charities.govt.nz/CharitiesRegister/ViewCharity?search=1&charityRegistrationNumber=CC10819-3 |
| 1126 | Ngati Awa Group Holdings Limited | CC11026-1 | 1221 | CC11026-1 | 0 | https://register.charities.govt.nz/CharitiesRegister/ViewCharity?search=1&charityRegistrationNumber=CC11026-1 |
| 1127 | Ngati Awa Farms Limited | CC11026-2 | 1222 | CC11026-2 | 0 | https://register.charities.govt.nz/CharitiesRegister/ViewCharity?search=1&charityRegistrationNumber=CC11026-2 |
| 1128 | Ngati Awa Fisheries Limited | CC11026-3 | 1223 | CC11026-3 | 0 | https://register.charities.govt.nz/CharitiesRegister/ViewCharity?search=1&charityRegistrationNumber=CC11026-3 |
| 1129 | Ngati Awa Fish Quota Holdings Limited | CC11026-4 | 1224 | CC11026-4 | 0 | https://register.charities.govt.nz/CharitiesRegister/ViewCharity?search=1&charityRegistrationNumber=CC11026-4 |
| 1130 | Ngati Awa Forests Limited | CC11026-5 | 1225 | CC11026-5 | 0 | https://register.charities.govt.nz/CharitiesRegister/ViewCharity?search=1&charityRegistrationNumber=CC11026-5 |
| 1131 | White Island Tours Limited | CC11026-6 | 1226 | CC11026-6 | 0 | https://register.charities.govt.nz/CharitiesRegister/ViewCharity?search=1&charityRegistrationNumber=CC11026-6 |
| 1132 | Ngati Awa Properties Limited | CC11026-7 | 1227 | CC11026-7 | 0 | https://register.charities.govt.nz/CharitiesRegister/ViewCharity?search=1&charityRegistrationNumber=CC11026-7 |

## Finding

- These are pre-existing production charity records using suffixed registration identifiers, not valid strict `^CC[0-9]+$` registrations.
- Phase 9C normal public import must not alter them and must not invent suffixes.
- Current strict source-corpus imports keyed by unsuffixed CC values will not collide with these slugs/record_ids if the Phase 9C validator rejects malformed/suffixed registration values.
- Live OData smoke lookup for unsuffixed `CC10819` and `CC11026` returned zero authoritative Organisation rows on 2026-09-01. That suggests the suffixed records came from previous importer behaviour or non-normal register semantics, not current strict Charities OData `CharityRegistrationNumber` values.
- Treatment remains architectural-review territory: preserve as legacy evidence or plan a separate provenance cleanup. Do not modify during 9C-1/9C-2.
