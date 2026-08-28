#!/usr/bin/env node

/** Full read-only audit of Charities Register officer identities. Pages until exhausted. */
const BASE='http://www.odata.charities.govt.nz';
const arg=(name)=>process.argv.find(v=>v.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const pageSize=Math.max(1000,Number(arg('page-size'))||50000);
function values(p){if(Array.isArray(p?.value))return p.value;if(Array.isArray(p?.d))return p.d;if(Array.isArray(p?.d?.results))return p.d.results;return[];}
function pick(o,...ks){for(const k of ks)if(o?.[k]!==undefined&&o?.[k]!==null&&o?.[k]!=='')return o[k];return null;}
function norm(v){return String(v??'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-NZ');}
async function fetchJson(path){const u=new URL(path,BASE);u.searchParams.set('$format','json');const r=await fetch(u,{headers:{accept:'application/json'}});if(!r.ok)throw new Error(`${r.status} ${r.statusText}: ${u}`);return r.json();}

const byContact=new Map(), byOfficer=new Map(), byName=new Map();
let total=0, missingContact=0, skip=0, pages=0;
while(true){
 const path=`/Officers?$top=${pageSize}&$skip=${skip}`;
 process.stderr.write(`Fetching officers ${skip.toLocaleString()}-${(skip+pageSize-1).toLocaleString()}... `);
 const rows=values(await fetchJson(path)); pages++; process.stderr.write(`${rows.length.toLocaleString()} rows\n`);
 if(!rows.length)break;
 for(const row of rows){
  total++;
  const contact=pick(row,'ContactId','ContactID'); if(!contact)missingContact++;
  const body=Boolean(pick(row,'IsaBodyCorporate','IsBodyCorporate','BodyCorporate'));
  const name=body?pick(row,'BodyCorporateName','FullName','Name'):(pick(row,'FullName','Name')??[pick(row,'FirstName'),pick(row,'MiddleName'),pick(row,'LastName')].filter(Boolean).join(' '));
  const org=String(pick(row,'OrganisationId','OrganisationID')??'');
  const officer=String(pick(row,'OfficerId','OfficerID','Id','ID')??'');
  const n=norm(name);
  if(contact){const key=String(contact).toLowerCase();if(!byContact.has(key))byContact.set(key,{id:String(contact),names:new Set(),organisations:new Set(),officerIds:new Set(),examples:[]});const x=byContact.get(key);if(n)x.names.add(n);if(org)x.organisations.add(org);if(officer)x.officerIds.add(officer);if(x.examples.length<5)x.examples.push({officerId:officer,organisationId:org,name});}
  if(officer){const key=officer.toLowerCase();if(!byOfficer.has(key))byOfficer.set(key,{organisations:new Set(),names:new Set()});const x=byOfficer.get(key);if(org)x.organisations.add(org);if(n)x.names.add(n);}
  if(n&&!body){if(!byName.has(n))byName.set(n,{display:name,organisations:new Set(),officerIds:new Set(),contactIds:new Set(),examples:[]});const x=byName.get(n);if(org)x.organisations.add(org);if(officer)x.officerIds.add(officer);if(contact)x.contactIds.add(String(contact).toLowerCase());if(x.examples.length<5)x.examples.push({officerId:officer,contactId:contact,organisationId:org});}
 }
 skip+=rows.length;
 if(rows.length<pageSize)break;
}
const repeatedContacts=[...byContact.values()].filter(x=>x.officerIds.size>1);
const crossContacts=repeatedContacts.filter(x=>x.organisations.size>1);
const repeatedOfficers=[...byOfficer.values()].filter(x=>x.organisations.size>1);
const crossNames=[...byName.values()].filter(x=>x.organisations.size>1).sort((a,b)=>b.organisations.size-a.organisations.size);
const likelyDistinctCrossNames=crossNames.filter(x=>x.contactIds.size>1);
const summary={rows:total,pages,pageSize,missingContact,uniqueContactIds:byContact.size,repeatedContactIds:repeatedContacts.length,contactIdsAcrossMultipleOrganisations:crossContacts.length,officerIdsAcrossMultipleOrganisations:repeatedOfficers.length,uniqueNormalisedPersonNames:byName.size,namesAppearingAcrossMultipleOrganisations:crossNames.length,crossOrganisationNamesWithMultipleContactIds:likelyDistinctCrossNames.length,maxOrganisationsForSameNormalisedName:crossNames[0]?.organisations.size??0};
console.log('\n'+JSON.stringify(summary,null,2));
console.log('\nTop repeated person names across organisations (NOT proof of same person):');
for(const x of crossNames.slice(0,30))console.log(JSON.stringify({name:x.display,organisationCount:x.organisations.size,officerRecordCount:x.officerIds.size,contactIdCount:x.contactIds.size,examples:x.examples}));
console.log('\nConclusion guide: ContactId/OfficerId repetition across organisations would support source-level identity. Repeated names with different IDs only show possible matches and MUST NOT be automatically merged.');
