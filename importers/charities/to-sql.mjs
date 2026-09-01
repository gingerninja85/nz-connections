#!/usr/bin/env node

/** Charities Services OData -> NZ Connections SQL importer. */
import { buildCharityRegisterUrl } from './charity-source-url.mjs';
const BASE = 'http://www.odata.charities.govt.nz';
const PUBLISHER = 'Charities Services, Department of Internal Affairs';
const DATASET = 'charities-register';
const arg = (name) => process.argv.find((v) => v.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const limit = Math.max(1, Number(arg('limit')) || 5000);
const skip = Math.max(0, Number(arg('skip')) || 0);
function sql(v) { if (v === null || v === undefined || v === '') return 'NULL'; return `'${String(v).replaceAll("'", "''")}'`; }
function slugify(v) { return String(v).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,90); }
function values(p) { if (Array.isArray(p?.value)) return p.value; if (Array.isArray(p?.d)) return p.d; if (Array.isArray(p?.d?.results)) return p.d.results; return []; }
function pick(o,...ks) { for (const k of ks) if (o?.[k] !== undefined && o?.[k] !== null) return o[k]; return null; }
async function fetchJson(path) { const u=new URL(path,BASE); u.searchParams.set('$format','json'); const r=await fetch(u,{headers:{accept:'application/json'}}); if(!r.ok) throw new Error(`${r.status} ${r.statusText}: ${u}`); return r.json(); }

const orgPath = `/Organisations?$top=${limit}&$skip=${skip}&$orderby=CharityRegistrationNumber`;
const organisations = values(await fetchJson(orgPath));
if (!organisations.length) throw new Error('Charities Services returned zero organisation records; refusing empty import.');
const retrievedAt = new Date().toISOString();
console.log('PRAGMA foreign_keys = ON;');
console.log(`INSERT INTO import_runs(dataset, source_snapshot, started_at, status, rows_seen, rows_written, errors, metadata_json) VALUES (${sql(DATASET)}, ${sql(BASE+orgPath)}, ${sql(retrievedAt)}, 'running', ${organisations.length}, 0, 0, ${sql(JSON.stringify({limit,skip,publisher:PUBLISHER}))});`);
let written=0;
for (const org of organisations) {
  const registration=pick(org,'CharityRegistrationNumber','RegistrationNumber'); const name=pick(org,'Name','OrganisationName'); if(!registration||!name) continue;
  const nzbn=pick(org,'NZBN','Nzbn','NZBNNumber'); const status=pick(org,'RegistrationStatus');
  const stableSlug=`charity-${slugify(registration)}`;
  const oldSlug=`charity-${slugify(registration)}-${slugify(name)}`;
  const sourceUrl=buildCharityRegisterUrl(registration);
  if(!sourceUrl) continue;
  const metadata={charity_registration_number:registration,organisation_id:pick(org,'OrganisationId','OrganisationID','Id','ID'),date_registered:pick(org,'DateRegistered'),deregistration_date:pick(org,'DeregistrationDate','deregistrationdate'),entity_type:pick(org,'EntityType'),town_city:pick(org,'TownCity','PostalAddress_TownCity'),source_dataset:'Charities Register'};
  // Migrate our earlier canary slug in-place so reimports retain the same entity id.
  console.log(`UPDATE entities SET slug=${sql(stableSlug)}, canonical_name=${sql(name)}, nzbn=COALESCE(${sql(nzbn)},nzbn), status=${sql(status)}, metadata_json=${sql(JSON.stringify(metadata))}, updated_at=CURRENT_TIMESTAMP WHERE entity_type='charity' AND (slug=${sql(oldSlug)} OR json_extract(metadata_json,'$.charity_registration_number')=${sql(registration)});`);
  console.log(`INSERT INTO entities(entity_type,canonical_name,slug,nzbn,status,metadata_json,updated_at) SELECT 'charity',${sql(name)},${sql(stableSlug)},${sql(nzbn)},${sql(status)},${sql(JSON.stringify(metadata))},CURRENT_TIMESTAMP WHERE NOT EXISTS(SELECT 1 FROM entities WHERE slug=${sql(stableSlug)});`);
  console.log(`INSERT INTO sources(dataset,publisher,record_id,source_url,retrieved_at,licence,importer_version) VALUES (${sql(DATASET)},${sql(PUBLISHER)},${sql(String(registration))},${sql(sourceUrl)},${sql(retrievedAt)},'Creative Commons Attribution 3.0 New Zealand','charities-odata-v2') ON CONFLICT DO NOTHING;`);
  console.log(`INSERT INTO entity_sources(entity_id,source_id,metadata_json) SELECT e.id,s.id,'{"role":"register-record"}' FROM entities e JOIN sources s ON s.dataset=${sql(DATASET)} AND s.record_id=${sql(String(registration))} WHERE e.slug=${sql(stableSlug)} ON CONFLICT(entity_id,source_id) DO UPDATE SET metadata_json=excluded.metadata_json;`);
  written++;
}
console.log(`UPDATE import_runs SET completed_at=CURRENT_TIMESTAMP,status='completed',rows_seen=${organisations.length},rows_written=${written} WHERE id=(SELECT MAX(id) FROM import_runs WHERE dataset=${sql(DATASET)});`);
