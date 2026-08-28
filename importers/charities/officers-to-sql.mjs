#!/usr/bin/env node

/**
 * Charities Services OData officers -> NZ Connections SQL.
 *
 * Emits person/body-corporate officer entities and evidence-backed OFFICER_OF
 * relationships to charities already imported from the Charities Register.
 * Officer identity is deliberately scoped to the Charities Register source;
 * this importer does NOT merge a same-named officer with people from other
 * datasets.
 *
 * Usage:
 *   node importers/charities/officers-to-sql.mjs --limit=100 > charity-officers.sql
 */

const BASE = 'https://www.odata.charities.govt.nz';
const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const limit = limitArg ? Math.max(1, Number(limitArg.split('=')[1]) || 100) : null;

function sql(value) {
  if (value === null || value === undefined || value === '') return 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function slugify(value) {
  return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 90);
}

function values(payload) { return payload?.value ?? payload?.d?.results ?? []; }
function pick(obj, ...keys) { for (const key of keys) if (obj?.[key] !== undefined && obj?.[key] !== null) return obj[key]; return null; }

async function fetchJson(path) {
  const url = new URL(path, BASE);
  url.searchParams.set('$format', 'json');
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

// The service exposes officer data; use the entity set advertised by metadata.
// Current Charities Services register/search also confirms officers are linked
// to charities and can be individuals or body corporates.
const candidates = ['Officers', 'GrpOrgOfficers'];
let officers = null;
let endpoint = null;
let lastError = null;
for (const set of candidates) {
  try {
    const path = `/${set}?${limit ? `$top=${limit}&` : '$returnall=true&'}`;
    officers = values(await fetchJson(path));
    endpoint = set;
    break;
  } catch (error) { lastError = error; }
}
if (!officers) throw lastError ?? new Error('No Charities Services officer entity set could be read');

const retrievedAt = new Date().toISOString();
console.log('PRAGMA foreign_keys = ON;');
console.log('BEGIN TRANSACTION;');
console.log(`INSERT INTO import_runs(dataset, publisher, started_at, status, metadata_json) VALUES ('charities-register-officers', 'Charities Services, Department of Internal Affairs', ${sql(retrievedAt)}, 'running', ${sql(JSON.stringify({ endpoint, count: officers.length }))});`);

let written = 0;
for (const officer of officers) {
  const registration = pick(officer, 'CharityRegistrationNumber', 'RegistrationNumber');
  const fullName = pick(officer, 'FullName', 'OfficerName', 'Name');
  if (!registration || !fullName) continue;

  const officerId = pick(officer, 'OfficerId', 'OfficerID', 'Id', 'ID');
  const position = pick(officer, 'Position', 'OfficerPosition', 'Role');
  const effective = pick(officer, 'EffectiveDate', 'DateAppointed', 'AppointmentDate');
  const pastSince = pick(officer, 'PastSince', 'DateRemoved', 'EndDate');
  const bodyCorporate = Boolean(pick(officer, 'IsBodyCorporate', 'BodyCorporate'));
  const identityKey = officerId ? `id-${officerId}` : `charity-${registration}-${slugify(fullName)}`;
  const officerSlug = `charities-officer-${slugify(identityKey)}`;
  const recordId = officerId ? String(officerId) : `${registration}:${fullName}:${effective ?? ''}`;
  const sourceUrl = `https://register.charities.govt.nz/CharitiesRegister/Search?OfficerSearchType=${bodyCorporate ? 'BodyCorporate' : 'Individual'}&Submitted=True`;
  const metadata = { source_dataset: 'Charities Register', officer_position: position, body_corporate: bodyCorporate };

  console.log(`INSERT INTO entities(entity_type, canonical_name, slug, status, metadata_json, updated_at) VALUES (${bodyCorporate ? "'other'" : "'person'"}, ${sql(fullName)}, ${sql(officerSlug)}, ${sql(pastSince ? 'past officer' : 'current officer')}, ${sql(JSON.stringify(metadata))}, CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET canonical_name=excluded.canonical_name, status=excluded.status, metadata_json=excluded.metadata_json, updated_at=CURRENT_TIMESTAMP;`);
  console.log(`INSERT INTO sources(dataset, publisher, record_id, source_url, retrieved_at, licence, importer_version) VALUES ('charities-register-officers', 'Charities Services, Department of Internal Affairs', ${sql(recordId)}, ${sql(sourceUrl)}, ${sql(retrievedAt)}, 'Creative Commons Attribution 3.0 New Zealand', 'charities-officers-v1') ON CONFLICT DO NOTHING;`);
  console.log(`INSERT INTO entity_sources(entity_id, source_id, metadata_json) SELECT e.id, s.id, ${sql(JSON.stringify({ role: 'officer-register-record' }))} FROM entities e JOIN sources s ON s.dataset='charities-register-officers' AND s.record_id=${sql(recordId)} WHERE e.slug=${sql(officerSlug)} ON CONFLICT(entity_id, source_id) DO UPDATE SET metadata_json=excluded.metadata_json;`);
  console.log(`INSERT INTO relationships(subject_entity_id, predicate, object_entity_id, source_id, valid_from, valid_to, observed_at, metadata_json) SELECT p.id, 'OFFICER_OF', c.id, s.id, ${sql(effective)}, ${sql(pastSince)}, ${sql(retrievedAt)}, ${sql(JSON.stringify({ position }))} FROM entities p, entities c, sources s WHERE p.slug=${sql(officerSlug)} AND c.entity_type='charity' AND json_extract(c.metadata_json, '$.charity_registration_number')=${sql(registration)} AND s.dataset='charities-register-officers' AND s.record_id=${sql(recordId)} ON CONFLICT DO NOTHING;`);
  written++;
}

console.log(`UPDATE import_runs SET completed_at=CURRENT_TIMESTAMP, status='completed', records_seen=${officers.length}, records_written=${written} WHERE id=(SELECT MAX(id) FROM import_runs WHERE dataset='charities-register-officers');`);
console.log('COMMIT;');
