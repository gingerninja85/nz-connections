#!/usr/bin/env node
/**
 * Phase 9C-1 full-corpus preparation tools for NZ Charities Services data.
 * Local/snapshot/chunk generation only. This file never executes production D1 writes.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { buildCharityRegisterUrl, isValidCharityRegistrationNumber, normalizeCharityRegistrationNumber } from './charity-source-url.mjs';

const BASE = 'http://www.odata.charities.govt.nz';
const PUBLISHER = 'Charities Services, Department of Internal Affairs';
const LICENCE = 'Creative Commons Attribution 3.0 New Zealand';
const CHARITY_DATASET = 'charities-register';
const OFFICER_DATASET = 'charities-register-officers';
const ORGANISATION_SELECT = 'OrganisationId,AccountId,Name,CharityRegistrationNumber,RegistrationStatus,NZBNNumber,CompaniesOfficeNumber,ModifiedOn';
const OFFICER_SELECT = 'OfficerId,ContactId,OrganisationId,FullName,FirstName,MiddleName,LastName,IsaBodyCorporate,BodyCorporateName,OfficerStatus,PositioninOrganisation,PositionAppointmentDate,LastDateAsAnOfficer,ModifiedOn';

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const found = process.argv.find((v) => v.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}
function hasFlag(name) { return process.argv.includes(`--${name}`); }
export function sql(v) {
  if (v === null || v === undefined || v === '') return 'NULL';
  return `'${String(v).replaceAll("'", "''")}'`;
}
export function slugify(v) {
  return String(v ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 90);
}
function sha256Text(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function fingerprintRows(rows) { return sha256Text(rows.map((r) => stableJson(r)).join('\n') + '\n'); }
function pick(o, ...keys) { for (const k of keys) if (o?.[k] !== undefined && o?.[k] !== null) return o[k]; return null; }
function fullOfficerName(row) {
  const bodyName = pick(row, 'BodyCorporateName');
  if (String(pick(row, 'IsaBodyCorporate', 'IsBodyCorporate', 'BodyCorporate') ?? '').toLowerCase() === 'true' && bodyName) return String(bodyName).trim();
  const full = pick(row, 'FullName', 'Name');
  if (full) return String(full).trim();
  return [pick(row, 'FirstName'), pick(row, 'MiddleName'), pick(row, 'LastName')].filter(Boolean).join(' ').trim();
}
function boolish(value) {
  if (value === true || value === 1) return true;
  const s = String(value ?? '').trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}
function countBy(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const v = String(r[key] ?? '').trim();
    if (!v) continue;
    m.set(v, (m.get(v) || 0) + 1);
  }
  return m;
}
function reject(row, reason, extra = {}) {
  return {
    reason,
    source_identity: {
      OrganisationId: pick(row, 'OrganisationId', 'OrganisationID'),
      AccountId: pick(row, 'AccountId'),
      OfficerId: pick(row, 'OfficerId', 'OfficerID', 'Id', 'ID'),
      ContactId: pick(row, 'ContactId', 'ContactID')
    },
    registration: pick(row, 'CharityRegistrationNumber', 'RegistrationNumber'),
    organisation_name: pick(row, 'Name', 'OrganisationName'),
    officer_name: fullOfficerName(row),
    context: { ...extra, row }
  };
}

export function planODataPages({ totalRows, pageSize }) {
  const pages = [];
  for (let skip = 0; skip < totalRows; skip += pageSize) pages.push({ skip, top: pageSize });
  return pages;
}
export function detectRepeatedContinuation(tokens) {
  return new Set(tokens).size !== tokens.length;
}
function values(payload) {
  if (Array.isArray(payload?.value)) return payload.value;
  if (Array.isArray(payload?.d?.results)) return payload.d.results;
  if (Array.isArray(payload?.d)) return payload.d;
  return [];
}
function continuation(payload) {
  return payload?.['@odata.nextLink'] || payload?.['odata.nextLink'] || payload?.d?.__next || null;
}
async function fetchJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json', 'User-Agent': 'Mozilla/5.0 NZ-Records-Phase9C-Prep' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return res.json();
}
export async function snapshotOData({ collection, outFile, pageSize = 50000, select, maxRows = null }) {
  const endpoint = new URL(`/${collection}`, BASE);
  endpoint.searchParams.set('$format', 'json');
  endpoint.searchParams.set('$top', String(pageSize));
  if (select) endpoint.searchParams.set('$select', select);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const stream = fs.createWriteStream(outFile, { encoding: 'utf8' });
  let rows = 0, pages = 0, skip = 0, nextUrl = null;
  const seenContinuations = [];
  const pageInfo = [];
  try {
    while (true) {
      if (!nextUrl) endpoint.searchParams.set('$skip', String(skip));
      const url = nextUrl || String(endpoint);
      if (seenContinuations.includes(url)) throw new Error(`Repeated OData page/continuation URL detected: ${url}`);
      seenContinuations.push(url);
      const payload = await fetchJson(url);
      let batch = values(payload);
      if (maxRows !== null) batch = batch.slice(0, Math.max(0, Number(maxRows) - rows));
      for (const row of batch) stream.write(`${stableJson(row)}\n`);
      pages += 1; rows += batch.length; pageInfo.push({ page: pages, skip: nextUrl ? null : skip, count: batch.length, url });
      const next = continuation(payload);
      if (next && seenContinuations.includes(next)) throw new Error(`Repeated OData continuation detected: ${next}`);
      if (maxRows !== null && rows >= Number(maxRows)) break;
      if (next) { nextUrl = next.startsWith('http') ? next : new URL(next, BASE).toString(); continue; }
      nextUrl = null;
      if (batch.length < pageSize) break;
      skip += batch.length;
    }
  } finally {
    await new Promise((resolve) => stream.end(resolve));
  }
  const text = fs.readFileSync(outFile, 'utf8');
  const manifest = { dataset: collection, endpoint: String(endpoint), retrievedAt: new Date().toISOString(), rowCount: rows, pageSize, pages: pageInfo, sha256: sha256Text(text), remoteWritesEnabled: false };
  fs.writeFileSync(`${outFile}.manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
export function readNdjson(file) {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}
export function writeNdjson(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, 'w');
  try {
    for (const row of rows) fs.writeSync(fd, `${stableJson(row)}\n`);
  } finally {
    fs.closeSync(fd);
  }
}
export function buildSnapshotManifest({ dataset, endpoint, rows, pageSize, pages }) {
  return { dataset, endpoint, retrievedAt: new Date().toISOString(), rowCount: rows.length, pageSize, pages, sha256: fingerprintRows(rows), remoteWritesEnabled: false };
}

export function validateCharityRows(rows) {
  const byReg = countBy(rows, 'CharityRegistrationNumber');
  const byOrg = countBy(rows, 'OrganisationId');
  const byAccount = countBy(rows, 'AccountId');
  const statusCounts = {};
  for (const r of rows) statusCounts[String(pick(r, 'RegistrationStatus') ?? '')] = (statusCounts[String(pick(r, 'RegistrationStatus') ?? '')] || 0) + 1;
  const accepted = [], rejects = [];
  let rejectedRows = 0;
  for (const r of rows) {
    const rawRegistration = pick(r, 'CharityRegistrationNumber', 'RegistrationNumber');
    const registration = normalizeCharityRegistrationNumber(rawRegistration);
    const reasons = [];
    if (!registration) reasons.push('missing_registration');
    else if (!isValidCharityRegistrationNumber(registration)) reasons.push('malformed_registration');
    if (registration && byReg.get(String(registration)) > 1) reasons.push('duplicate_registration');
    const org = String(pick(r, 'OrganisationId', 'OrganisationID') ?? '').trim();
    const acc = String(pick(r, 'AccountId') ?? '').trim();
    if (org && byOrg.get(org) > 1) reasons.push('duplicate_organisation_id');
    if (acc && byAccount.get(acc) > 1) reasons.push('duplicate_account_id');
    if (reasons.length) {
      rejectedRows++;
      for (const reason of reasons) rejects.push(reject(r, reason));
      continue;
    }
    const name = String(pick(r, 'Name', 'OrganisationName') ?? '').trim();
    if (!name) { rejectedRows++; rejects.push(reject(r, 'missing_organisation_name')); continue; }
    const sourceUrl = buildCharityRegisterUrl(registration);
    accepted.push({
      kind: 'charity', registration, organisationId: org, accountId: acc, name,
      status: String(pick(r, 'RegistrationStatus') ?? ''), nzbn: pick(r, 'NZBNNumber', 'NZBN'),
      companiesOfficeNumber: pick(r, 'CompaniesOfficeNumber'), modifiedOn: pick(r, 'ModifiedOn'),
      sourceUrl, slug: `charity-${slugify(registration)}`, raw: r
    });
  }
  return { accepted, rejects, summary: { source: rows.length, accepted: accepted.length, rejected: rejectedRows, rejectArtifacts: rejects.length, statusCounts, missingRegistration: rejects.filter((r) => r.reason === 'missing_registration').length, malformedRegistration: rejects.filter((r) => r.reason === 'malformed_registration').length, duplicateRegistration: rejects.filter((r) => r.reason === 'duplicate_registration').length, duplicateOrganisationId: rejects.filter((r) => r.reason === 'duplicate_organisation_id').length, duplicateAccountId: rejects.filter((r) => r.reason === 'duplicate_account_id').length } };
}

export function validateOfficerRows(rows, acceptedCharities) {
  const charityByOrganisationId = new Map(acceptedCharities.map((c) => [String(c.organisationId), c]));
  const byOfficer = countBy(rows, 'OfficerId');
  const accepted = [], rejects = [];
  let humanAccepted = 0, bodyCorporateAccepted = 0, unknownNameType = 0, current = 0, past = 0;
  for (const r of rows) {
    const officerId = String(pick(r, 'OfficerId', 'OfficerID', 'Id', 'ID') ?? '').trim();
    const organisationId = String(pick(r, 'OrganisationId', 'OrganisationID') ?? '').trim();
    const name = fullOfficerName(r);
    const bodyCorporate = boolish(pick(r, 'IsaBodyCorporate', 'IsBodyCorporate', 'BodyCorporate'));
    if (!officerId) { rejects.push(reject(r, 'missing_officer_id')); continue; }
    if (byOfficer.get(officerId) > 1) { rejects.push(reject(r, 'duplicate_officer_id')); continue; }
    if (!organisationId) { rejects.push(reject(r, 'missing_organisation_id')); continue; }
    const charity = charityByOrganisationId.get(organisationId);
    if (!charity) { rejects.push(reject(r, 'unmapped_organisation', { organisationId })); continue; }
    if (!name) { rejects.push(reject(r, 'missing_officer_name')); continue; }
    const officerStatus = String(pick(r, 'OfficerStatus') ?? '');
    const entityType = bodyCorporate ? 'other' : 'person';
    if (bodyCorporate) bodyCorporateAccepted++; else if (entityType === 'person') humanAccepted++; else unknownNameType++;
    if (/past/i.test(officerStatus) || pick(r, 'LastDateAsAnOfficer')) past++; else current++;
    accepted.push({
      kind: 'officer', officerId, contactId: String(pick(r, 'ContactId', 'ContactID') ?? '').trim() || null,
      organisationId, charityRegistration: charity.registration, charitySlug: charity.slug,
      name, entityType, bodyCorporate, status: officerStatus || (pick(r, 'LastDateAsAnOfficer') ? 'Past' : 'Current'),
      position: pick(r, 'PositioninOrganisation', 'Position'), appointmentDate: pick(r, 'PositionAppointmentDate', 'DateAppointed'),
      lastDateAsOfficer: pick(r, 'LastDateAsAnOfficer', 'DateRemoved'), modifiedOn: pick(r, 'ModifiedOn'),
      slug: `charities-officer-id-${slugify(officerId)}`,
      sourceUrl: buildCharityRegisterUrl(charity.registration), raw: r
    });
  }
  return { accepted, rejects, summary: { source: rows.length, accepted: accepted.length, rejected: rejects.length, humanAccepted, bodyCorporateAccepted, unknownNameType, current, past, missingOfficerId: rejects.filter((r) => r.reason === 'missing_officer_id').length, duplicateOfficerId: rejects.filter((r) => r.reason === 'duplicate_officer_id').length, missingOrganisationId: rejects.filter((r) => r.reason === 'missing_organisation_id').length, unmappedOrganisation: rejects.filter((r) => r.reason === 'unmapped_organisation').length } };
}

function importRunStart(dataset, sourceSnapshot, rowsSeen, metadata) {
  return `INSERT INTO import_runs(dataset, source_snapshot, started_at, status, rows_seen, rows_written, errors, metadata_json) VALUES (${sql(dataset)}, ${sql(sourceSnapshot)}, CURRENT_TIMESTAMP, 'running', ${rowsSeen}, 0, 0, ${sql(JSON.stringify(metadata))});`;
}
function charitySql(c, snapshotId) {
  const metadata = { charity_registration_number: c.registration, organisation_id: c.organisationId, account_id: c.accountId, registration_status: c.status, nzbn_number: c.nzbn, companies_office_number: c.companiesOfficeNumber, modified_on: c.modifiedOn, source_dataset: 'Charities Register', snapshot_id: snapshotId };
  return [
    `INSERT INTO entities(entity_type, canonical_name, slug, nzbn, company_number, status, metadata_json, updated_at) VALUES ('charity', ${sql(c.name)}, ${sql(c.slug)}, ${sql(c.nzbn)}, ${sql(c.companiesOfficeNumber)}, ${sql(c.status)}, ${sql(JSON.stringify(metadata))}, CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET canonical_name=excluded.canonical_name,nzbn=excluded.nzbn,company_number=excluded.company_number,status=excluded.status,metadata_json=excluded.metadata_json,updated_at=CURRENT_TIMESTAMP;`,
    `INSERT INTO sources(dataset, publisher, record_id, source_url, retrieved_at, licence, importer_version, raw_hash) VALUES (${sql(CHARITY_DATASET)}, ${sql(PUBLISHER)}, ${sql(c.registration)}, ${sql(c.sourceUrl)}, CURRENT_TIMESTAMP, ${sql(LICENCE)}, 'charities-odata-phase9c', ${sql(sha256Text(stableJson(c.raw)))}) ON CONFLICT DO NOTHING;`,
    `INSERT INTO entity_sources(entity_id, source_id, metadata_json) SELECT e.id, s.id, ${sql(JSON.stringify({ role: 'register-record', snapshot_id: snapshotId }))} FROM entities e JOIN sources s ON s.dataset=${sql(CHARITY_DATASET)} AND COALESCE(s.record_id, '')=${sql(c.registration)} AND s.source_url=${sql(c.sourceUrl)} WHERE e.slug=${sql(c.slug)} ON CONFLICT(entity_id,source_id) DO UPDATE SET metadata_json=excluded.metadata_json;`
  ];
}
function officerSql(o, snapshotId) {
  const metadata = { source_dataset: 'Charities Register', officer_id: o.officerId, contact_id: o.contactId, organisation_id: o.organisationId, charity_registration_number: o.charityRegistration, officer_status: o.status, officer_position: o.position, body_corporate: o.bodyCorporate, body_corporate_name: o.bodyCorporate ? o.name : null, appointment_date: o.appointmentDate, last_date_as_officer: o.lastDateAsOfficer, modified_on: o.modifiedOn, identity_scope: 'CHARITIES_REGISTER_OFFICER_ID', snapshot_id: snapshotId };
  const relMeta = { position: o.position, officer_status: o.status, organisation_id: o.organisationId, officer_id: o.officerId, contact_id: o.contactId, body_corporate: o.bodyCorporate, snapshot_id: snapshotId };
  return [
    `INSERT INTO entities(entity_type, canonical_name, slug, status, metadata_json, updated_at) VALUES (${sql(o.entityType)}, ${sql(o.name)}, ${sql(o.slug)}, ${sql(o.status)}, ${sql(JSON.stringify(metadata))}, CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET canonical_name=excluded.canonical_name,status=excluded.status,metadata_json=excluded.metadata_json,updated_at=CURRENT_TIMESTAMP;`,
    `INSERT INTO sources(dataset, publisher, record_id, source_url, retrieved_at, licence, importer_version, raw_hash) VALUES (${sql(OFFICER_DATASET)}, ${sql(PUBLISHER)}, ${sql(o.officerId)}, ${sql(o.sourceUrl)}, CURRENT_TIMESTAMP, ${sql(LICENCE)}, 'charities-officers-phase9c', ${sql(sha256Text(stableJson(o.raw)))}) ON CONFLICT DO NOTHING;`,
    `INSERT INTO entity_sources(entity_id, source_id, metadata_json) SELECT e.id, s.id, ${sql(JSON.stringify({ role: 'officer-register-record', snapshot_id: snapshotId }))} FROM entities e JOIN sources s ON s.dataset=${sql(OFFICER_DATASET)} AND COALESCE(s.record_id, '')=${sql(o.officerId)} AND s.source_url=${sql(o.sourceUrl)} WHERE e.slug=${sql(o.slug)} ON CONFLICT(entity_id,source_id) DO UPDATE SET metadata_json=excluded.metadata_json;`,
    `INSERT INTO relationships(subject_entity_id, predicate, object_entity_id, source_id, valid_from, valid_to, observed_at, metadata_json) SELECT p.id, 'OFFICER_OF', c.id, s.id, ${sql(o.appointmentDate)}, ${sql(o.lastDateAsOfficer)}, CURRENT_TIMESTAMP, ${sql(JSON.stringify(relMeta))} FROM entities p, entities c, sources s WHERE p.slug=${sql(o.slug)} AND c.slug=${sql(o.charitySlug)} AND s.dataset=${sql(OFFICER_DATASET)} AND COALESCE(s.record_id, '')=${sql(o.officerId)} AND s.source_url=${sql(o.sourceUrl)} ON CONFLICT DO NOTHING;`
  ];
}
export function buildSqlChunks({ charities = [], officers = [], chunkSize = 1000, snapshotId = 'unknown' }) {
  const units = [];
  for (const c of charities.slice().sort((a, b) => a.registration.localeCompare(b.registration))) units.push({ key: `charity:${c.registration}`, kind: 'charity', statements: charitySql(c, snapshotId), counts: { entities: 1, sources: 1, entity_sources: 1, relationships: 0 } });
  for (const o of officers.slice().sort((a, b) => Number(a.officerId) - Number(b.officerId) || a.officerId.localeCompare(b.officerId))) units.push({ key: `officer:${o.officerId}`, kind: 'officer', statements: officerSql(o, snapshotId), counts: { entities: 1, sources: 1, entity_sources: 1, relationships: 1 } });
  const chunks = [];
  for (let i = 0; i < units.length; i += chunkSize) {
    const part = units.slice(i, i + chunkSize);
    const totals = part.reduce((acc, u) => { for (const [k, v] of Object.entries(u.counts)) acc[k] = (acc[k] || 0) + v; return acc; }, {});
    const sqlText = ['PRAGMA foreign_keys = ON;', importRunStart(`phase9c-chunk-${String(chunks.length + 1).padStart(5, '0')}`, snapshotId, part.length, { snapshot_id: snapshotId, chunk_number: chunks.length + 1, first_key: part[0]?.key, last_key: part.at(-1)?.key, local_only_generated: true }), ...part.flatMap((u) => u.statements), `UPDATE import_runs SET completed_at=CURRENT_TIMESTAMP,status='completed',rows_written=${Object.values(totals).reduce((a, b) => a + b, 0)} WHERE id=(SELECT MAX(id) FROM import_runs WHERE dataset=${sql(`phase9c-chunk-${String(chunks.length + 1).padStart(5, '0')}`)});`, ''].join('\n');
    chunks.push({ chunkNumber: chunks.length + 1, firstKey: part[0]?.key, lastKey: part.at(-1)?.key, unitCount: part.length, expected: totals, fingerprint: sha256Text(sqlText), sql: sqlText });
  }
  return chunks;
}

export function writeValidationOutputs({ organisationsFile, officersFile = null, outDir }) {
  fs.mkdirSync(outDir, { recursive: true });
  const orgRows = readNdjson(organisationsFile);
  const charity = validateCharityRows(orgRows);
  writeNdjson(path.join(outDir, 'charities.accepted.ndjson'), charity.accepted);
  writeNdjson(path.join(outDir, 'charities.rejects.ndjson'), charity.rejects);
  let officer = null;
  if (officersFile) {
    officer = validateOfficerRows(readNdjson(officersFile), charity.accepted);
    writeNdjson(path.join(outDir, 'officers.accepted.ndjson'), officer.accepted);
    writeNdjson(path.join(outDir, 'officers.rejects.ndjson'), officer.rejects);
  }
  const manifest = { generatedAt: new Date().toISOString(), remoteWritesEnabled: false, charities: charity.summary, officers: officer?.summary ?? null };
  fs.writeFileSync(path.join(outDir, 'validation-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
async function* readNdjsonStream(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim()) yield JSON.parse(line);
  }
}
function chunkFromUnits(part, chunkNumber, snapshotId) {
  const totals = part.reduce((acc, u) => { for (const [k, v] of Object.entries(u.counts)) acc[k] = (acc[k] || 0) + v; return acc; }, {});
  const sqlText = ['PRAGMA foreign_keys = ON;', importRunStart(`phase9c-chunk-${String(chunkNumber).padStart(5, '0')}`, snapshotId, part.length, { snapshot_id: snapshotId, chunk_number: chunkNumber, first_key: part[0]?.key, last_key: part.at(-1)?.key, local_only_generated: true }), ...part.flatMap((u) => u.statements), `UPDATE import_runs SET completed_at=CURRENT_TIMESTAMP,status='completed',rows_written=${Object.values(totals).reduce((a, b) => a + b, 0)} WHERE id=(SELECT MAX(id) FROM import_runs WHERE dataset=${sql(`phase9c-chunk-${String(chunkNumber).padStart(5, '0')}`)});`, ''].join('\n');
  return { chunkNumber, firstKey: part[0]?.key, lastKey: part.at(-1)?.key, unitCount: part.length, expected: totals, fingerprint: sha256Text(sqlText), sql: sqlText };
}
export async function writeChunks({ acceptedCharitiesFile, acceptedOfficersFile = null, outDir, chunkSize = 1000, snapshotId = 'unknown' }) {
  fs.mkdirSync(outDir, { recursive: true });
  let part = [], chunkNumber = 1;
  const manifestChunks = [];
  async function flush(force = false) {
    if (!part.length || (!force && part.length < chunkSize)) return;
    const chunk = chunkFromUnits(part, chunkNumber++, snapshotId);
    fs.writeFileSync(path.join(outDir, `chunk-${String(chunk.chunkNumber).padStart(5, '0')}.sql`), chunk.sql);
    const { sql: _sql, ...meta } = chunk;
    manifestChunks.push(meta);
    part = [];
  }
  for await (const c of readNdjsonStream(acceptedCharitiesFile)) {
    part.push({ key: `charity:${c.registration}`, kind: 'charity', statements: charitySql(c, snapshotId), counts: { entities: 1, sources: 1, entity_sources: 1, relationships: 0 } });
    await flush(false);
  }
  if (acceptedOfficersFile) {
    for await (const o of readNdjsonStream(acceptedOfficersFile)) {
      part.push({ key: `officer:${o.officerId}`, kind: 'officer', statements: officerSql(o, snapshotId), counts: { entities: 1, sources: 1, entity_sources: 1, relationships: 1 } });
      await flush(false);
    }
  }
  await flush(true);
  const totals = manifestChunks.reduce((acc, c) => { for (const [k, v] of Object.entries(c.expected)) acc[k] = (acc[k] || 0) + v; return acc; }, {});
  const manifest = { generatedAt: new Date().toISOString(), remoteWritesEnabled: false, chunkSize, snapshotId, chunkCount: manifestChunks.length, expectedTotals: totals, chunks: manifestChunks };
  fs.writeFileSync(path.join(outDir, 'chunks-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
async function main() {
  const cmd = process.argv[2];
  if (!cmd || hasFlag('help')) {
    console.log(`Usage:
  node importers/charities/phase9c-prep.mjs snapshot --dataset=organisations|officers --out=phase9c-prep/snapshots/organisations.ndjson --page-size=50000 [--max-rows=1000]
  node importers/charities/phase9c-prep.mjs validate --organisations=... --officers=... --out-dir=phase9c-prep/validation
  node importers/charities/phase9c-prep.mjs chunks --charities=... --officers=... --out-dir=phase9c-prep/chunks --chunk-size=1000 --snapshot-id=<id>
No command here executes D1 or production writes.`);
    return;
  }
  if (cmd === 'snapshot') {
    const dataset = arg('dataset');
    const out = arg('out');
    if (!['organisations', 'officers'].includes(dataset) || !out) throw new Error('snapshot requires --dataset=organisations|officers and --out=FILE');
    const manifest = await snapshotOData({ collection: dataset === 'organisations' ? 'Organisations' : 'Officers', outFile: out, pageSize: Number(arg('page-size', '50000')), select: dataset === 'organisations' ? ORGANISATION_SELECT : OFFICER_SELECT, maxRows: arg('max-rows') });
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }
  if (cmd === 'validate') {
    const manifest = writeValidationOutputs({ organisationsFile: arg('organisations'), officersFile: arg('officers'), outDir: arg('out-dir', 'phase9c-prep/validation') });
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }
  if (cmd === 'chunks') {
    const manifest = await writeChunks({ acceptedCharitiesFile: arg('charities'), acceptedOfficersFile: arg('officers'), outDir: arg('out-dir', 'phase9c-prep/chunks'), chunkSize: Number(arg('chunk-size', '1000')), snapshotId: arg('snapshot-id', 'manual') });
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }
  throw new Error(`Unknown command: ${cmd}`);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((err) => { console.error(err.stack || err.message); process.exit(1); });
