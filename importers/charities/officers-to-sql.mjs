#!/usr/bin/env node

/** Charities Services officers -> NZ Connections SQL, bulk-capable. */
import { buildCharityRegisterUrl } from './charity-source-url.mjs';
const BASE='http://www.odata.charities.govt.nz';
const PUBLISHER='Charities Services, Department of Internal Affairs';
const DATASET='charities-register-officers';
const arg=(name)=>process.argv.find(v=>v.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const limit=Math.max(1,Number(arg('limit'))||5000); const skip=Math.max(0,Number(arg('skip'))||0);
function sql(v){if(v===null||v===undefined||v==='')return'NULL';return`'${String(v).replaceAll("'","''")}'`;}
function slugify(v){return String(v).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,90);}
function values(p){if(Array.isArray(p?.value))return p.value;if(Array.isArray(p?.d))return p.d;if(Array.isArray(p?.d?.results))return p.d.results;return[];}
function pick(o,...ks){for(const k of ks)if(o?.[k]!==undefined&&o?.[k]!==null)return o[k];return null;}
async function fetchJson(path){const u=new URL(path,BASE);u.searchParams.set('$format','json');const r=await fetch(u,{headers:{accept:'application/json'}});if(!r.ok)throw new Error(`${r.status} ${r.statusText}: ${u}`);return r.json();}

const sourcePath=`/Officers?$top=${limit}&$skip=${skip}`;
const officers=values(await fetchJson(sourcePath)); if(!officers.length)throw new Error('Charities Services returned zero officer records; refusing empty import.');
// Bulk-resolve organisation IDs in one dataset request instead of N HTTP calls.
const orgs=values(await fetchJson('/Organisations?$returnall=true'));
const registrations=new Map();
for(const o of orgs){const oid=pick(o,'OrganisationId','OrganisationID','Id','ID');const reg=pick(o,'CharityRegistrationNumber','RegistrationNumber');if(oid!==null&&reg)registrations.set(String(oid),String(reg));}
const retrievedAt=new Date().toISOString();
console.log('PRAGMA foreign_keys = ON;');
console.log(`INSERT INTO import_runs(dataset,source_snapshot,started_at,status,rows_seen,rows_written,errors,metadata_json) VALUES (${sql(DATASET)},${sql(BASE+sourcePath)},${sql(retrievedAt)},'running',${officers.length},0,0,${sql(JSON.stringify({limit,skip,organisations_loaded:registrations.size,publisher:PUBLISHER}))});`);
let written=0,unresolved=0;
for(const officer of officers){
 const oid=pick(officer,'OrganisationId','OrganisationID'); const registration=oid===null?null:registrations.get(String(oid));
 const body=Boolean(pick(officer,'IsaBodyCorporate','IsBodyCorporate','BodyCorporate'));
 const fullName=body?pick(officer,'BodyCorporateName','FullName','Name'):(pick(officer,'FullName','Name')??[pick(officer,'FirstName'),pick(officer,'MiddleName'),pick(officer,'LastName')].filter(Boolean).join(' '));
 if(!registration||!fullName){unresolved++;continue;}
 const officerId=pick(officer,'OfficerId','OfficerID','Id','ID'); const position=pick(officer,'PositioninOrganisation','Position','OfficerPosition','Role'); const effective=pick(officer,'PositionAppointmentDate','EffectiveDate','DateAppointed','AppointmentDate'); const past=pick(officer,'LastDateAsAnOfficer','PastSince','DateRemoved','EndDate');
 // OfficerId is source-scoped identity. Never merge a same-named person across datasets.
 const identity=officerId?`id-${officerId}`:`organisation-${oid}-${slugify(fullName)}-${slugify(effective??'')}`; const officerSlug=`charities-officer-${slugify(identity)}`; const recordId=officerId?String(officerId):`${oid}:${fullName}:${effective??''}`;
 const sourceUrl=buildCharityRegisterUrl(registration); if(!sourceUrl){unresolved++;continue;} const metadata={source_dataset:'Charities Register',officer_position:position,body_corporate:body,organisation_id:oid};
 console.log(`INSERT INTO entities(entity_type,canonical_name,slug,status,metadata_json,updated_at) VALUES (${body?"'other'":"'person'"},${sql(fullName)},${sql(officerSlug)},${sql(past?'past officer':'current officer')},${sql(JSON.stringify(metadata))},CURRENT_TIMESTAMP) ON CONFLICT(slug) DO UPDATE SET canonical_name=excluded.canonical_name,status=excluded.status,metadata_json=excluded.metadata_json,updated_at=CURRENT_TIMESTAMP;`);
 console.log(`INSERT INTO sources(dataset,publisher,record_id,source_url,retrieved_at,licence,importer_version) VALUES (${sql(DATASET)},${sql(PUBLISHER)},${sql(recordId)},${sql(sourceUrl)},${sql(retrievedAt)},'Creative Commons Attribution 3.0 New Zealand','charities-officers-v3') ON CONFLICT DO NOTHING;`);
 console.log(`INSERT INTO entity_sources(entity_id,source_id,metadata_json) SELECT e.id,s.id,'{"role":"officer-register-record"}' FROM entities e JOIN sources s ON s.dataset=${sql(DATASET)} AND s.record_id=${sql(recordId)} WHERE e.slug=${sql(officerSlug)} ON CONFLICT(entity_id,source_id) DO UPDATE SET metadata_json=excluded.metadata_json;`);
 console.log(`INSERT INTO relationships(subject_entity_id,predicate,object_entity_id,source_id,valid_from,valid_to,observed_at,metadata_json) SELECT p.id,'OFFICER_OF',c.id,s.id,${sql(effective)},${sql(past)},${sql(retrievedAt)},${sql(JSON.stringify({position,organisation_id:oid}))} FROM entities p,entities c,sources s WHERE p.slug=${sql(officerSlug)} AND c.entity_type='charity' AND json_extract(c.metadata_json,'$.charity_registration_number')=${sql(registration)} AND s.dataset=${sql(DATASET)} AND s.record_id=${sql(recordId)} ON CONFLICT DO NOTHING;`); written++;
}
console.log(`UPDATE import_runs SET completed_at=CURRENT_TIMESTAMP,status='completed',rows_seen=${officers.length},rows_written=${written},errors=${unresolved} WHERE id=(SELECT MAX(id) FROM import_runs WHERE dataset=${sql(DATASET)});`);
