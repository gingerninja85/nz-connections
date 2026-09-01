# Charities Register importer

NZ Connections can ingest public records from the New Zealand Charities Register using the Charities Services OData service.

Official documentation: https://www.charities.govt.nz/charities-in-new-zealand/the-charities-register/open-data

## Source characteristics

- Publisher: Charities Services, Department of Internal Affairs
- Access: public, read-only OData; no authentication or registration required
- Licence: Creative Commons Attribution 3.0 New Zealand
- Core records: charities, officers and annual returns
- Default OData query limit: 1,000 records unless `$returnall=true` is requested

The importer deliberately excludes charity email addresses. NZ Connections does not need them for relationship mapping and Charities Services specifically restricts use of published addresses for unsolicited marketing.

## Legacy page SQL generators

The original generators are page/batch generators, not complete-corpus orchestration:

```bash
node importers/charities/to-sql.mjs --limit=100 --skip=0 > charities-page.sql
node importers/charities/officers-to-sql.mjs --limit=100 --skip=0 > officers-page.sql
```

`node importers/charities/to-sql.mjs` and `node importers/charities/officers-to-sql.mjs` default to 5,000 rows. Do **not** treat the default output as the full Charities Register.

## Phase 9C full-corpus preparation

Phase 9C-1 adds a local-only preparation CLI. It snapshots live OData into reproducible local NDJSON, validates/quarantines unsafe rows, and generates deterministic local SQL chunks for a later local rehearsal. It does not execute D1 or production writes.

```bash
# 1. Snapshot live source locally. Large files are gitignored.
npm run charities:phase9c:snapshot:organisations
npm run charities:phase9c:snapshot:officers

# 2. Validate and quarantine rejects.
npm run charities:phase9c:validate

# 3. Generate deterministic SQL chunks for local rehearsal only.
npm run charities:phase9c:chunks
```

Equivalent explicit commands:

```bash
node importers/charities/phase9c-prep.mjs snapshot \
  --dataset=organisations \
  --out=phase9c-prep/snapshots/organisations.ndjson \
  --page-size=50000

node importers/charities/phase9c-prep.mjs snapshot \
  --dataset=officers \
  --out=phase9c-prep/snapshots/officers.ndjson \
  --page-size=50000

node importers/charities/phase9c-prep.mjs validate \
  --organisations=phase9c-prep/snapshots/organisations.ndjson \
  --officers=phase9c-prep/snapshots/officers.ndjson \
  --out-dir=phase9c-prep/validation

node importers/charities/phase9c-prep.mjs chunks \
  --charities=phase9c-prep/validation/charities.accepted.ndjson \
  --officers=phase9c-prep/validation/officers.accepted.ndjson \
  --out-dir=phase9c-prep/chunks \
  --chunk-size=1000 \
  --snapshot-id=local-phase9c
```

Phase 9C-2 local rehearsal command shape, using local SQLite/D1 only and never `--remote`:

```bash
rm -rf phase9c-prep/local-db
mkdir -p phase9c-prep/local-db
sqlite3 phase9c-prep/local-db/nz-records-phase9c.sqlite < database/schema.sql
for f in phase9c-prep/chunks/chunk-*.sql; do sqlite3 phase9c-prep/local-db/nz-records-phase9c.sqlite < "$f"; done
for f in phase9c-prep/chunks/chunk-*.sql; do sqlite3 phase9c-prep/local-db/nz-records-phase9c.sqlite < "$f"; done # idempotency rerun
sqlite3 phase9c-prep/local-db/nz-records-phase9c.sqlite 'PRAGMA foreign_key_check;'
du -h phase9c-prep/local-db/nz-records-phase9c.sqlite
```

Production warning: do not run generated chunks against `nz-connections-db`, do not use `wrangler d1 execute --remote`, and do not run a production canary/full import without separate approval.

## Validation and modelling rules

- Charity rows require strict `^CC[0-9]+$` registration numbers for normal public import.
- Missing, malformed, duplicate, duplicate-OrganisationId, and duplicate-AccountId rows are quarantined and reported. Never invent suffixes.
- All source statuses are preserved: `Registered`, `Deregistered`, `Removed`, and blank/unknown.
- Officer identity is source-scoped: one evidence entity per `OfficerId`.
- Missing or duplicate `OfficerId` is quarantined in the new full-corpus path. No name/date fallback is used for normal full-corpus import.
- Human officers become `person`; body corporate officers become `other` for Phase 9C.
- Current and historical officer evidence is imported; `OfficerStatus`, `PositioninOrganisation`, `PositionAppointmentDate`, and `LastDateAsAnOfficer` are preserved.
- No name-only, fuzzy, ContactId-based, or cross-dataset person merge is allowed.
- `Source for this record` remains `entity_sources` provenance; `Evidence for this connection` remains `relationships.source_id` provenance.
- Valid CC source URLs use `https://www.register.charities.govt.nz/Charity/CCxxxxx`; never reintroduce legacy `CharitiesRegister/ViewCharity` URLs.
