#!/usr/bin/env node

/** Audit whether Charities Register ContactId is stable across officer appointments. No writes. */
const BASE='http://www.odata.charities.govt.nz';
const arg=(name)=>process.argv.find(v=>v.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const limit=Math.max(1,Number(arg('limit'))||50000);
const skip=Math.max(0,Number(arg('skip'))||0);
function values(p){if(Array.isArray(p?.value))return p.value;if(Array.isArray(p?.d))return p.d;if(Array.isArray(p?.d?.results))return p.d.results;return[];}
function pick(o,...ks){for(const k of ks)if(o?.[k]!==undefined&&o?.[k]!==null&&o?.[k]!=='')return o[k];return null;}
function norm(v){return String(v??'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-NZ');}
async function fetchJson(path){const u=new URL(path,BASE);u.searchParams.set('$format','json');const r=await fetch(u,{headers:{accept:'application/json'}});if(!r.ok)throw new Error(`${r.status} ${r.statusText}: ${u}`);return r.json();}
const path=`/Officers?$top=${limit}&$skip=${skip}`;
const rows=values(await fetchJson(path));
if(!rows.length)throw new Error('No officer rows returned.');
const byContact=new Map(); let missingContact=0;
for(const row of rows){
 const contact=pick(row,'ContactId','ContactID'); if(!contact){missingContact++;continue;}
 const name=pick(row,'FullName','Name','BodyCorporateName')??[pick(row,'FirstName'),pick(row,'MiddleName'),pick(row,'LastName')].filter(Boolean).join(' ');
 const org=String(pick(row,'OrganisationId','OrganisationID')??'');
 const officer=String(pick(row,'OfficerId','OfficerID','Id','ID')??'');
 const key=String(contact).toLowerCase();
 if(!byContact.has(key))byContact.set(key,{contactId:String(contact),names:new Set(),organisations:new Set(),officerIds:new Set(),examples:[]});
 const x=byContact.get(key); if(name)x.names.add(norm(name)); if(org)x.organisations.add(org); if(officer)x.officerIds.add(officer); if(x.examples.length<5)x.examples.push({officerId:officer,organisationId:org,name});
}
const repeated=[...byContact.values()].filter(x=>x.officerIds.size>1);
const crossOrg=repeated.filter(x=>x.organisations.size>1);
const nameConflicts=crossOrg.filter(x=>x.names.size>1);
const stableName=crossOrg.filter(x=>x.names.size===1);
const summary={rows:rows.length,skip,missingContact,uniqueContactIds:byContact.size,repeatedContactIds:repeated.length,contactIdsAcrossMultipleOrganisations:crossOrg.length,crossOrganisationStableName:stableName.length,crossOrganisationNameVariants:nameConflicts.length};
console.log(JSON.stringify(summary,null,2));
console.log('\nExamples: same ContactId across multiple organisations');
for(const x of crossOrg.slice(0,20))console.log(JSON.stringify({contactId:x.contactId,organisationCount:x.organisations.size,officerRecordCount:x.officerIds.size,names:[...x.names],examples:x.examples}));
console.log('\nInterpretation: a ContactId recurring across distinct OrganisationIds is strong empirical evidence that ContactId identifies a contact independently of an officer appointment. Name variants must still be reviewed before production migration.');
