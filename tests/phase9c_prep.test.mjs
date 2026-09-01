import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  validateCharityRows,
  validateOfficerRows,
  buildSqlChunks,
  planODataPages,
  detectRepeatedContinuation,
  buildSnapshotManifest,
  writeNdjson,
  readNdjson,
  writeChunks
} from '../importers/charities/phase9c-prep.mjs';

const charities = [
  { OrganisationId: 1, AccountId: 'a1', Name: 'Alpha Trust', CharityRegistrationNumber: 'CC10001', RegistrationStatus: 'Registered' },
  { OrganisationId: 2, AccountId: 'a2', Name: 'Beta Trust', CharityRegistrationNumber: 'CC10002', RegistrationStatus: 'Deregistered' },
  { OrganisationId: 3, AccountId: 'a3', Name: 'Gamma Trust', CharityRegistrationNumber: 'CC10003', RegistrationStatus: 'Removed' },
  { OrganisationId: 4, AccountId: 'a4', Name: 'Missing Reg', CharityRegistrationNumber: '', RegistrationStatus: 'Registered' },
  { OrganisationId: 5, AccountId: 'a5', Name: 'Malformed Reg', CharityRegistrationNumber: 'CC10A04', RegistrationStatus: 'Registered' },
  { OrganisationId: 6, AccountId: 'a6', Name: 'Duplicate One', CharityRegistrationNumber: 'CC65044', RegistrationStatus: 'Registered' },
  { OrganisationId: 7, AccountId: 'a7', Name: 'Duplicate Two', CharityRegistrationNumber: 'CC65044', RegistrationStatus: 'Deregistered' },
  { OrganisationId: 7, AccountId: 'a8', Name: 'Duplicate OrganisationId', CharityRegistrationNumber: 'CC10007', RegistrationStatus: 'Registered' },
  { OrganisationId: 8, AccountId: 'a8', Name: 'Duplicate AccountId', CharityRegistrationNumber: 'CC10008', RegistrationStatus: 'Registered' }
];

test('charity validation accepts statuses but quarantines missing malformed and duplicate identifiers', () => {
  const result = validateCharityRows(charities);
  assert.deepEqual(result.summary.statusCounts, { Registered: 6, Deregistered: 2, Removed: 1 });
  assert.equal(result.accepted.length, 3);
  assert.equal(result.summary.rejected, 6);
  assert.equal(result.summary.rejectArtifacts, 8);
  assert.equal(result.rejects.filter((r) => r.reason === 'missing_registration').length, 1);
  assert.equal(result.rejects.filter((r) => r.reason === 'malformed_registration').length, 1);
  assert.equal(result.rejects.filter((r) => r.reason === 'duplicate_registration').length, 2);
  assert.equal(result.rejects.filter((r) => r.reason === 'duplicate_organisation_id').length, 2);
  assert.equal(result.rejects.filter((r) => r.reason === 'duplicate_account_id').length, 2);
  assert.equal(result.accepted.find((r) => r.registration === 'CC10002').status, 'Deregistered');
});

test('officer validation uses OfficerId identity and never merges same-looking names', () => {
  const acceptedCharities = validateCharityRows(charities).accepted;
  const officers = [
    { OfficerId: 10, ContactId: 'c1', OrganisationId: 1, FullName: 'John Wilson', OfficerStatus: 'Qualified', PositioninOrganisation: 'Trustee', PositionAppointmentDate: '2020-01-01T00:00:00Z' },
    { OfficerId: 11, ContactId: 'c2', OrganisationId: 2, FullName: 'John Wilson', OfficerStatus: 'Past', PositioninOrganisation: 'Chair', PositionAppointmentDate: '2019-01-01T00:00:00Z', LastDateAsAnOfficer: '2021-01-01T00:00:00Z' },
    { OfficerId: 12, ContactId: 'c3', OrganisationId: 3, IsaBodyCorporate: true, BodyCorporateName: 'Public Trust', OfficerStatus: 'Qualified', PositioninOrganisation: 'Trustee' },
    { ContactId: 'missing', OrganisationId: 1, FullName: 'No OfficerId' },
    { OfficerId: 15, ContactId: 'dup-a', OrganisationId: 1, FullName: 'Duplicate OfficerId A' },
    { OfficerId: 15, ContactId: 'dup-b', OrganisationId: 2, FullName: 'Duplicate OfficerId B' },
    { OfficerId: 13, ContactId: 'no-org', FullName: 'No Org' },
    { OfficerId: 14, ContactId: 'bad-map', OrganisationId: 999, FullName: 'No Charity' }
  ];
  const result = validateOfficerRows(officers, acceptedCharities);
  assert.equal(result.accepted.length, 3);
  assert.equal(result.accepted[0].slug, 'charities-officer-id-10');
  assert.equal(result.accepted[1].slug, 'charities-officer-id-11');
  assert.notEqual(result.accepted[0].slug, result.accepted[1].slug);
  assert.equal(result.accepted[2].entityType, 'other');
  assert.equal(result.accepted[2].bodyCorporate, true);
  assert.equal(result.summary.humanAccepted, 2);
  assert.equal(result.summary.bodyCorporateAccepted, 1);
  assert.equal(result.rejects.filter((r) => r.reason === 'missing_officer_id').length, 1);
  assert.equal(result.rejects.filter((r) => r.reason === 'duplicate_officer_id').length, 2);
  assert.equal(result.rejects.filter((r) => r.reason === 'missing_organisation_id').length, 1);
  assert.equal(result.rejects.filter((r) => r.reason === 'unmapped_organisation').length, 1);
});

test('SQL chunks are deterministic, direct-url only, provenance preserving and idempotent', () => {
  const acceptedCharities = validateCharityRows(charities).accepted;
  const acceptedOfficers = validateOfficerRows([
    { OfficerId: 10, ContactId: 'c1', OrganisationId: 1, FullName: 'John Wilson', OfficerStatus: 'Qualified', PositioninOrganisation: 'Trustee', PositionAppointmentDate: '2020-01-01T00:00:00Z' },
    { OfficerId: 11, ContactId: 'c2', OrganisationId: 2, FullName: 'John Wilson', OfficerStatus: 'Past', PositioninOrganisation: 'Chair', PositionAppointmentDate: '2019-01-01T00:00:00Z', LastDateAsAnOfficer: '2021-01-01T00:00:00Z' }
  ], acceptedCharities).accepted;
  const chunks = buildSqlChunks({ charities: acceptedCharities, officers: acceptedOfficers, chunkSize: 2, snapshotId: 'fixture' });
  assert.equal(chunks.length, 3);
  const sql = chunks.map((c) => c.sql).join('\n');
  assert.match(sql, /https:\/\/www\.register\.charities\.govt\.nz\/Charity\/CC10001/);
  assert.doesNotMatch(sql, /CharitiesRegister\/ViewCharity/);
  assert.match(sql, /ON CONFLICT DO NOTHING/);
  assert.match(sql, /ON CONFLICT\(entity_id,source_id\) DO UPDATE/);
  assert.match(sql, /OFFICER_OF/);
  assert.match(sql, /officer_status/);
  assert.equal(buildSqlChunks({ charities: acceptedCharities, officers: acceptedOfficers, chunkSize: 2, snapshotId: 'fixture' })[0].fingerprint, chunks[0].fingerprint);
});

test('pagination planning and continuation loop protection are explicit', () => {
  assert.deepEqual(planODataPages({ totalRows: 2500, pageSize: 1000 }), [{ skip: 0, top: 1000 }, { skip: 1000, top: 1000 }, { skip: 2000, top: 1000 }]);
  assert.equal(detectRepeatedContinuation(['a', 'b', 'c']), false);
  assert.equal(detectRepeatedContinuation(['a', 'b', 'a']), true);
});

test('snapshot manifest captures reproducible local-only source evidence', () => {
  const manifest = buildSnapshotManifest({ dataset: 'Organisations', endpoint: 'http://example.test/Organisations', rows: charities, pageSize: 1000, pages: [{ skip: 0, count: charities.length }] });
  assert.equal(manifest.dataset, 'Organisations');
  assert.equal(manifest.rowCount, charities.length);
  assert.match(manifest.sha256, /^[a-f0-9]{64}$/);
  assert.equal(manifest.remoteWritesEnabled, false);
});

test('generated SQL applies twice to local SQLite without duplicate graph rows', () => {
  const acceptedCharities = validateCharityRows(charities).accepted;
  const acceptedOfficers = validateOfficerRows([
    { OfficerId: 10, ContactId: 'c1', OrganisationId: 1, FullName: 'John Wilson', OfficerStatus: 'Qualified', PositioninOrganisation: 'Trustee', PositionAppointmentDate: '2020-01-01T00:00:00Z' },
    { OfficerId: 11, ContactId: 'c2', OrganisationId: 2, FullName: 'John Wilson', OfficerStatus: 'Past', PositioninOrganisation: 'Chair', PositionAppointmentDate: '2019-01-01T00:00:00Z', LastDateAsAnOfficer: '2021-01-01T00:00:00Z' },
    { OfficerId: 12, ContactId: 'c3', OrganisationId: 3, IsaBodyCorporate: true, BodyCorporateName: 'Public Trust', OfficerStatus: 'Qualified', PositioninOrganisation: 'Trustee' }
  ], acceptedCharities).accepted;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'phase9c-prep-'));
  const db = path.join(tmp, 'fixture.sqlite');
  const schema = path.resolve('database/schema.sql');
  const chunks = buildSqlChunks({ charities: acceptedCharities, officers: acceptedOfficers, chunkSize: 2, snapshotId: 'fixture' });
  const sqlText = chunks.map((c) => c.sql).join('\n');
  fs.writeFileSync(path.join(tmp, 'chunks.sql'), sqlText);
  const py = `import sqlite3, pathlib\nconn=sqlite3.connect(${JSON.stringify(db)})\nconn.executescript(pathlib.Path(${JSON.stringify(schema)}).read_text())\nchunk=pathlib.Path(${JSON.stringify(path.join(tmp, 'chunks.sql'))}).read_text()\nconn.executescript(chunk)\nconn.executescript(chunk)\nconn.commit()\nprint(conn.execute("SELECT (SELECT COUNT(*) FROM entities),(SELECT COUNT(*) FROM sources),(SELECT COUNT(*) FROM entity_sources),(SELECT COUNT(*) FROM relationships),(SELECT COUNT(*) FROM relationships WHERE predicate='OFFICER_OF')").fetchone())\nprint(conn.execute("SELECT entity_type,COUNT(*) FROM entities GROUP BY entity_type ORDER BY entity_type").fetchall())\n`;
  const out = execFileSync('python3', ['-c', py], { encoding: 'utf8' }).trim().split('\n');
  assert.equal(out[0], '(6, 6, 6, 3, 3)');
  assert.match(out[1], /\('charity', 3\)/);
  assert.match(out[1], /\('other', 1\)/);
  assert.match(out[1], /\('person', 2\)/);
});

test('writeNdjson streams rows without building one giant output string', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'phase9c-ndjson-'));
  const file = path.join(tmp, 'rows.ndjson');
  const rows = Array.from({ length: 5000 }, (_, i) => ({ id: i, value: `row-${i}` }));
  writeNdjson(file, rows);
  const loaded = readNdjson(file);
  assert.equal(loaded.length, rows.length);
  assert.deepEqual(loaded.at(0), rows[0]);
  assert.deepEqual(loaded.at(-1), rows.at(-1));
});

test('writeChunks streams accepted files to deterministic chunk files', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'phase9c-chunks-'));
  const acceptedCharities = validateCharityRows(charities).accepted;
  const acceptedOfficers = validateOfficerRows([
    { OfficerId: 10, ContactId: 'c1', OrganisationId: 1, FullName: 'John Wilson', OfficerStatus: 'Qualified', PositioninOrganisation: 'Trustee' },
    { OfficerId: 11, ContactId: 'c2', OrganisationId: 2, FullName: 'John Wilson', OfficerStatus: 'Past', PositioninOrganisation: 'Chair', LastDateAsAnOfficer: '2021-01-01T00:00:00Z' }
  ], acceptedCharities).accepted;
  const charitiesFile = path.join(tmp, 'charities.accepted.ndjson');
  const officersFile = path.join(tmp, 'officers.accepted.ndjson');
  writeNdjson(charitiesFile, acceptedCharities);
  writeNdjson(officersFile, acceptedOfficers);
  const outDir = path.join(tmp, 'chunks');
  const manifest = await writeChunks({ acceptedCharitiesFile: charitiesFile, acceptedOfficersFile: officersFile, outDir, chunkSize: 2, snapshotId: 'fixture' });
  assert.equal(manifest.chunkCount, 3);
  assert.equal(fs.readdirSync(outDir).filter((n) => n.endsWith('.sql')).length, 3);
  assert.equal(manifest.expectedTotals.entities, 5);
  assert.equal(manifest.expectedTotals.relationships, 2);
  const manifestAgain = await writeChunks({ acceptedCharitiesFile: charitiesFile, acceptedOfficersFile: officersFile, outDir: path.join(tmp, 'chunks-again'), chunkSize: 2, snapshotId: 'fixture' });
  assert.deepEqual(manifestAgain.chunks.map((c) => c.fingerprint), manifest.chunks.map((c) => c.fingerprint));
});
