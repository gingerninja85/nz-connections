#!/usr/bin/env node

/**
 * Charities Services OData -> NZ Connections SQL importer.
 *
 * Fetches public charity records from the unauthenticated Charities Register
 * OData service and emits idempotent SQL for D1. The generated records retain
 * source URLs and CC BY 3.0 NZ attribution metadata.
 *
 * Usage:
 *   node importers/charities/to-sql.mjs > charities.sql
 *   node importers/charities/to-sql.mjs --limit=100 > charities.sql
 */

const BASE = 'http://www.odata.charities.govt.nz';
const PUBLISHER = 'Charities Services, Department of Internal Affairs';
const DATASET = 'charities-register';
const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const limit = limitArg ? Math.max(1, Number(limitArg.split('=')[1]) || 100) : null;

function sql(value) {
  if (value === null || value === undefined || value === '') return 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function slugify(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 90);
}

// Charities Services currently exposes an OData v3 service. Depending on the
// JSON verbosity negotiated by the server, collections may be returned as
// { d: [...] }, { d: { results: [...] } }, or { value: [...] }.
function values(payload) {
  if (Array.isArray(payload?.value)) return payload.value;
  if (Array.isArray(payload?.d)) return payload.d;
  if (Array.isArray(payload?.d?.results)) return payload.d.results;
  return [];
}

async function fetchJson(path) {
  const url = new URL(path, BASE);
  url.searchParams.set('$format', 'json');
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

function pick(obj, ...keys) {
  for (const key of keys) if (obj?.[key] !== undefined && obj?.[key] !== null) return obj[key];
  return null;
}

const orgPath = `/Organisations?${limit ? `$top=${limit}&` : '$returnall=true&'}$orderby=CharityRegistrationNumber`;
const organisations = values(await fetchJson(orgPath));
if (organisations.length === 0) {
  throw new Error('Charities Services returned zero organisation records; refusing to generate an empty import.');
}
const retrievedAt = new Date().toISOString();
const snapshot = `${BASE}${orgPath}`;

// Do not emit BEGIN/COMMIT: Cloudflare D1's remote SQL ingest rejects explicit
// transaction statements. Wrangler handles import atomicity/rollback itself.
console.log('PRAGMA foreign_keys = ON;');
console.log(`INSERT INTO import_runs(dataset, source_snapshot, started_at, status, rows_seen, rows_written, errors, metadata_json) VALUES (${sql(DATASET)}, ${sql(snapshot)}, ${sql(retrievedAt)}, 'running', ${organisations.length}, 0, 0, ${sql(JSON.stringify({ endpoint: BASE, count: organisations.length, publisher: PUBLISHER }))});`);

let written = 0;
for (const org of organisations) {
  const registration = pick(org, 'CharityRegistrationNumber', 'RegistrationNumber');
  const name = pick(org, 'Name', 'OrganisationName');
  if (!registration || !name) continue;

  const nzbn = pick(org, 'NZBN', 'Nzbn', 'NZBNNumber');
  const status = pick(org, 'RegistrationStatus');
  const sourceUrl = `https://register.charities.govt.nz/CharitiesRegister/ViewCharity?search=1&charityRegistrationNumber=${encodeURIComponent(registration)}`;
  const recordId = String(registration);
  const slug = `charity-${slugify(registration)}-${slugify(name)}`;
  const metadata = {
    charity_registration_number: registration,
    date_registered: pick(org, 'DateRegistered'),
    deregistration_date: pick(org, 'DeregistrationDate', 'deregistrationdate'),
    entity_type: pick(org, 'EntityType'),
    town_city: pick(org, 'TownCity', 'PostalAddress_TownCity'),
    source_dataset: 'Charities Register'
  };

  console.log(`INSERT INTO entities(entity_type, canonical_name, slug, nzbn, status, metadata_json, updated_at) VALUES ('charity', ${sql(name)}, ${sql(slug)}, ${sql(nzbn)}, ${sql(status)}, ${sql(JSON.stringify(metadata))}, CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET canonical_name=excluded.canonical_name, nzbn=COALESCE(excluded.nzbn, entities.nzbn), status=excluded.status, metadata_json=excluded.metadata_json, updated_at=CURRENT_TIMESTAMP;`);
  console.log(`INSERT INTO sources(dataset, publisher, record_id, source_url, retrieved_at, licence, importer_version) VALUES (${sql(DATASET)}, ${sql(PUBLISHER)}, ${sql(recordId)}, ${sql(sourceUrl)}, ${sql(retrievedAt)}, 'Creative Commons Attribution 3.0 New Zealand', 'charities-odata-v1') ON CONFLICT DO NOTHING;`);
  console.log(`INSERT INTO entity_sources(entity_id, source_id, metadata_json) SELECT e.id, s.id, ${sql(JSON.stringify({ role: 'register-record' }))} FROM entities e JOIN sources s ON s.dataset=${sql(DATASET)} AND s.record_id=${sql(recordId)} WHERE e.slug=${sql(slug)} ON CONFLICT(entity_id, source_id) DO UPDATE SET metadata_json=excluded.metadata_json;`);
  written++;
}

console.log(`UPDATE import_runs SET completed_at=CURRENT_TIMESTAMP, status='completed', rows_seen=${organisations.length}, rows_written=${written} WHERE id=(SELECT MAX(id) FROM import_runs WHERE dataset=${sql(DATASET)});`);
