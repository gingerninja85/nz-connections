#!/usr/bin/env node

/**
 * Charities Services OData officers -> NZ Connections SQL.
 * Resolves each public officer's OrganisationId to its charity registration
 * number before emitting evidence-backed OFFICER_OF relationships.
 */

const BASE = 'http://www.odata.charities.govt.nz';
const PUBLISHER = 'Charities Services, Department of Internal Affairs';
const DATASET = 'charities-register-officers';
const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const limit = limitArg ? Math.max(1, Number(limitArg.split('=')[1]) || 100) : null;

function sql(value) {
  if (value === null || value === undefined || value === '') return 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}
function slugify(value) {
  return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 90);
}
function values(payload) {
  if (Array.isArray(payload?.value)) return payload.value;
  if (Array.isArray(payload?.d)) return payload.d;
  if (Array.isArray(payload?.d?.results)) return payload.d.results;
  return [];
}
function one(payload) {
  if (payload?.d && !Array.isArray(payload.d) && !Array.isArray(payload.d?.results)) return payload.d;
  if (payload?.value && !Array.isArray(payload.value)) return payload.value;
  return payload;
}
function pick(obj, ...keys) {
  for (const key of keys) if (obj?.[key] !== undefined && obj?.[key] !== null) return obj[key];
  return null;
}
async function fetchJson(path) {
  const url = new URL(path, BASE);
  url.searchParams.set('$format', 'json');
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

const sourcePath = `/Officers?${limit ? `$top=${limit}&` : '$returnall=true&'}`;
const officers = values(await fetchJson(sourcePath));
if (!officers.length) throw new Error('Charities Services returned zero officer records; refusing to generate an empty import.');

// Resolve only the organisations referenced by this batch. This deliberately
// avoids downloading the entire Organisations set for a small canary import.
const organisationIds = [...new Set(officers.map((o) => pick(o, 'OrganisationId', 'OrganisationID')).filter((v) => v !== null))];
const organisations = new Map();
for (const organisationId of organisationIds) {
  try {
    const organisation = one(await fetchJson(`/Organisations(${encodeURIComponent(organisationId)})`));
    const registration = pick(organisation, 'CharityRegistrationNumber', 'RegistrationNumber');
    if (registration) organisations.set(String(organisationId), String(registration));
  } catch (error) {
    console.error(`Warning: could not resolve OrganisationId ${organisationId}: ${error.message}`);
  }
}

const retrievedAt = new Date().toISOString();
const snapshot = `${BASE}${sourcePath}`;
console.log('PRAGMA foreign_keys = ON;');
console.log(`INSERT INTO import_runs(dataset, source_snapshot, started_at, status, rows_seen, rows_written, errors, metadata_json) VALUES (${sql(DATASET)}, ${sql(snapshot)}, ${sql(retrievedAt)}, 'running', ${officers.length}, 0, 0, ${sql(JSON.stringify({ endpoint: 'Officers', count: officers.length, organisations_resolved: organisations.size, publisher: PUBLISHER }))});`);

let written = 0;
let unresolved = 0;
for (const officer of officers) {
  const organisationId = pick(officer, 'OrganisationId', 'OrganisationID');
  const registration = organisationId === null ? null : organisations.get(String(organisationId));
  const bodyCorporate = Boolean(pick(officer, 'IsaBodyCorporate', 'IsBodyCorporate', 'BodyCorporate'));
  const fullName = bodyCorporate
    ? pick(officer, 'BodyCorporateName', 'FullName', 'Name')
    : pick(officer, 'FullName', 'Name') ?? [pick(officer, 'FirstName'), pick(officer, 'MiddleName'), pick(officer, 'LastName')].filter(Boolean).join(' ');
  if (!registration || !fullName) { unresolved++; continue; }

  const officerId = pick(officer, 'OfficerId', 'OfficerID', 'Id', 'ID');
  const position = pick(officer, 'PositioninOrganisation', 'Position', 'OfficerPosition', 'Role');
  const effective = pick(officer, 'PositionAppointmentDate', 'EffectiveDate', 'DateAppointed', 'AppointmentDate');
  const pastSince = pick(officer, 'LastDateAsAnOfficer', 'PastSince', 'DateRemoved', 'EndDate');
  const identityKey = officerId ? `id-${officerId}` : `organisation-${organisationId}-${slugify(fullName)}`;
  const officerSlug = `charities-officer-${slugify(identityKey)}`;
  const recordId = officerId ? String(officerId) : `${organisationId}:${fullName}:${effective ?? ''}`;
  const sourceUrl = `https://register.charities.govt.nz/CharitiesRegister/ViewCharity?search=1&charityRegistrationNumber=${encodeURIComponent(registration)}`;
  const metadata = { source_dataset: 'Charities Register', officer_position: position, body_corporate: bodyCorporate, organisation_id: organisationId };

  console.log(`INSERT INTO entities(entity_type, canonical_name, slug, status, metadata_json, updated_at) VALUES (${bodyCorporate ? "'other'" : "'person'"}, ${sql(fullName)}, ${sql(officerSlug)}, ${sql(pastSince ? 'past officer' : 'current officer')}, ${sql(JSON.stringify(metadata))}, CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET canonical_name=excluded.canonical_name, status=excluded.status, metadata_json=excluded.metadata_json, updated_at=CURRENT_TIMESTAMP;`);
  console.log(`INSERT INTO sources(dataset, publisher, record_id, source_url, retrieved_at, licence, importer_version) VALUES (${sql(DATASET)}, ${sql(PUBLISHER)}, ${sql(recordId)}, ${sql(sourceUrl)}, ${sql(retrievedAt)}, 'Creative Commons Attribution 3.0 New Zealand', 'charities-officers-v2') ON CONFLICT DO NOTHING;`);
  console.log(`INSERT INTO entity_sources(entity_id, source_id, metadata_json) SELECT e.id, s.id, ${sql(JSON.stringify({ role: 'officer-register-record' }))} FROM entities e JOIN sources s ON s.dataset=${sql(DATASET)} AND s.record_id=${sql(recordId)} WHERE e.slug=${sql(officerSlug)} ON CONFLICT(entity_id, source_id) DO UPDATE SET metadata_json=excluded.metadata_json;`);
  console.log(`INSERT INTO relationships(subject_entity_id, predicate, object_entity_id, source_id, valid_from, valid_to, observed_at, metadata_json) SELECT p.id, 'OFFICER_OF', c.id, s.id, ${sql(effective)}, ${sql(pastSince)}, ${sql(retrievedAt)}, ${sql(JSON.stringify({ position, organisation_id: organisationId }))} FROM entities p, entities c, sources s WHERE p.slug=${sql(officerSlug)} AND c.entity_type='charity' AND json_extract(c.metadata_json, '$.charity_registration_number')=${sql(registration)} AND s.dataset=${sql(DATASET)} AND s.record_id=${sql(recordId)} ON CONFLICT DO NOTHING;`);
  written++;
}

console.log(`UPDATE import_runs SET completed_at=CURRENT_TIMESTAMP, status='completed', rows_seen=${officers.length}, rows_written=${written}, errors=${unresolved} WHERE id=(SELECT MAX(id) FROM import_runs WHERE dataset=${sql(DATASET)});`);
