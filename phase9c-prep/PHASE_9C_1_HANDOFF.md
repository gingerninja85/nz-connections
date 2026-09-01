# NZ Records Phase 9C-1 handoff

Status: importer/validation preparation only. Phase 9C-2 local full-corpus rehearsal is not started.

## Branch/base

- Base SHA: `6a2b365ac5cc47bda4f16dc3a79693ad0d20402a`
- Branch: `feature/phase9c-full-charities-import-prep`

## What 9C-1 adds

- `importers/charities/phase9c-prep.mjs`: local-only OData snapshot, validation/quarantine, manifest, and deterministic SQL chunk generation CLI.
- `tests/phase9c_prep.test.mjs`: fixture tests for charity validation, officer identity, body-corporate typing, direct URL provenance, chunk determinism, and local SQLite idempotency via Python sqlite3.
- `phase9c-prep/IMPLEMENTATION_PLAN.md`: concise local plan written before implementation.
- `phase9c-prep/SUFFIXED_CHARITY_RECORDS_REVIEW.md`: read-only production review of `CC10819-*` and `CC11026-*` legacy records.
- `importers/charities/README.md`: updated operator docs and Phase 9C-2 local-only commands.

## Source snapshot commands

```bash
npm run charities:phase9c:snapshot:organisations
npm run charities:phase9c:snapshot:officers
```

Explicit form:

```bash
node importers/charities/phase9c-prep.mjs snapshot \
  --dataset=organisations \
  --out=phase9c-prep/snapshots/organisations.ndjson \
  --page-size=50000

node importers/charities/phase9c-prep.mjs snapshot \
  --dataset=officers \
  --out=phase9c-prep/snapshots/officers.ndjson \
  --page-size=50000
```

The snapshot CLI records dataset, endpoint, retrieval timestamp, page counters, row count, page size, and SHA-256 fingerprint in `*.manifest.json`.

## Validation commands

```bash
npm run charities:phase9c:validate
```

Explicit form:

```bash
node importers/charities/phase9c-prep.mjs validate \
  --organisations=phase9c-prep/snapshots/organisations.ndjson \
  --officers=phase9c-prep/snapshots/officers.ndjson \
  --out-dir=phase9c-prep/validation
```

Outputs:

- `phase9c-prep/validation/charities.accepted.ndjson`
- `phase9c-prep/validation/charities.rejects.ndjson`
- `phase9c-prep/validation/officers.accepted.ndjson`
- `phase9c-prep/validation/officers.rejects.ndjson`
- `phase9c-prep/validation/validation-manifest.json`

## Chunk generation commands

```bash
npm run charities:phase9c:chunks
```

Explicit form:

```bash
node importers/charities/phase9c-prep.mjs chunks \
  --charities=phase9c-prep/validation/charities.accepted.ndjson \
  --officers=phase9c-prep/validation/officers.accepted.ndjson \
  --out-dir=phase9c-prep/chunks \
  --chunk-size=1000 \
  --snapshot-id=local-phase9c
```

Outputs:

- deterministic `chunk-00001.sql` style files;
- `chunks-manifest.json` with chunk number, stable key range, expected counts, and fingerprint.

## Phase 9C-2 local-only rehearsal commands

Do not use `--remote`.

```bash
rm -rf phase9c-prep/local-db
mkdir -p phase9c-prep/local-db
python3 - <<'PY'
import sqlite3, pathlib
repo = pathlib.Path('.')
db = repo / 'phase9c-prep/local-db/nz-records-phase9c.sqlite'
conn = sqlite3.connect(db)
conn.executescript((repo / 'database/schema.sql').read_text())
conn.commit()
conn.close()
PY

python3 - <<'PY'
import sqlite3, pathlib
repo = pathlib.Path('.')
db = repo / 'phase9c-prep/local-db/nz-records-phase9c.sqlite'
conn = sqlite3.connect(db)
for chunk in sorted((repo / 'phase9c-prep/chunks').glob('chunk-*.sql')):
    conn.executescript(chunk.read_text())
conn.commit()
conn.close()
PY

# Idempotency rerun: counts must not increase.
python3 - <<'PY'
import sqlite3, pathlib
repo = pathlib.Path('.')
db = repo / 'phase9c-prep/local-db/nz-records-phase9c.sqlite'
conn = sqlite3.connect(db)
for chunk in sorted((repo / 'phase9c-prep/chunks').glob('chunk-*.sql')):
    conn.executescript(chunk.read_text())
conn.commit()
print(conn.execute('PRAGMA foreign_key_check').fetchall())
print(conn.execute('SELECT COUNT(*) FROM entities').fetchone()[0], 'entities')
print(conn.execute('SELECT COUNT(*) FROM sources').fetchone()[0], 'sources')
print(conn.execute('SELECT COUNT(*) FROM entity_sources').fetchone()[0], 'entity_sources')
print(conn.execute("SELECT COUNT(*) FROM relationships WHERE predicate='OFFICER_OF'").fetchone()[0], 'OFFICER_OF')
conn.close()
PY

du -h phase9c-prep/local-db/nz-records-phase9c.sqlite
```

## Validation rules encoded

- Charity normal public import requires strict `^CC[0-9]+$`.
- Missing/malformed/duplicate registrations, duplicate `OrganisationId`, and duplicate `AccountId` are rejected/quarantined and reported.
- No invented suffixes.
- Existing `CC10819-*` and `CC11026-*` production records are left untouched.
- Officer identity is one evidence entity per `OfficerId`.
- Missing/duplicate `OfficerId`, missing `OrganisationId`, and unmapped `OrganisationId` are rejected/quarantined.
- No name merge, fuzzy merge, ContactId person merge, or cross-charity reconciliation.
- Body corporate officers are `entity_type='other'`, not `person`.
- `OfficerStatus`, `PositioninOrganisation`, `PositionAppointmentDate`, and `LastDateAsAnOfficer` are preserved.
- `Source for this record` remains `entity_sources`; `Evidence for this connection` remains `relationships.source_id`.
- Valid charity URLs are direct: `https://www.register.charities.govt.nz/Charity/CCxxxxx`.

## Tests run

```text
npm run check                            PASS — 0 errors, 0 warnings
npm run build                            PASS
npm run test:gets                        PASS — 12 tests
python3 tests/phase9b_static_assertions.py PASS — 7 assertions
npm run test:phase9c-prep                PASS — 6 tests, 0 skipped
```

## Live-source smoke test

Small read-only OData snapshot smoke test completed with `--max-rows=5` for Organisations and Officers. It proved endpoint compatibility without processing the full corpus.

Smoke validation result:

```text
organisations rows: 5 accepted: 5 rejected: 0
officers rows: 5 accepted: 0 rejected: 5 unmapped OrganisationId: 5
```

The officer smoke reject result is expected because the first 5 Officers rows did not map to the first 5 Organisations rows in the deliberately tiny smoke sample.

## Remaining risks/open decisions

- Phase 9C-2 still needs actual full-corpus local measurement of generated row counts and DB size before any production canary.
- The existing public record page caps displayed connections at 250; record this for later UI work, but do not fix in 9C-1.
- Full FTS/storage impact is estimated, not measured until 9C-2.
- Legacy suffixed records need separate architectural cleanup decision if they should be normalized or retained as historical evidence.
- Generated chunks currently target the existing schema. If 9C-2 reveals a missing uniqueness constraint or scale limit, stop before production workarounds.

## Safety confirmation

- production D1 writes: 0
- production schema changes: 0
- production imports: 0
- production deployments: 0
- DNS/binding changes: 0
- graph changes: 0
- main merges: 0
- Phase 9C-2 execution: NOT STARTED
