import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';

const LOCAL_BINDING='DB';
const PARSER_VERSION='gets-detail-v1';
const agencyCode=process.argv.find(a=>a.startsWith('--agency='))?.split('=')[1]||'AT';

function wrangler(args,opts={}){return execFileSync('npx',['wrangler',...args],{encoding:'utf8',stdio:['ignore','pipe','inherit'],...opts});}
function localSelect(sql){if(!/^\s*(SELECT|WITH)\b/i.test(sql))throw new Error('Safety stop: localSelect only accepts SELECT/WITH.');const parsed=JSON.parse(wrangler(['d1','execute',LOCAL_BINDING,'--local','--json','--command',sql]));const blocks=Array.isArray(parsed)?parsed:[parsed];return blocks.flatMap(b=>b?.results??b?.result?.results??[]);}
function q(v){return v==null?'NULL':`'${String(v).replaceAll("'","''")}'`;}
function decode(s){return s.replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/p\s*>/gi,'\n\n').replace(/<\/li\s*>/gi,'\n').replace(/<li[^>]*>/gi,'• ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/[ \t]+\n/g,'\n').replace(/\n[ \t]+/g,'\n').replace(/[ \t]{2,}/g,' ').replace(/\n{3,}/g,'\n\n').trim();}
function section(html,start,end){const re=new RegExp(`(?:<[^>]+>\\s*)*${start}\\s*(?:<[^>]+>)*([\\s\\S]*?)(?=(?:<[^>]+>\\s*)*${end}\\b)`,'i');const m=html.match(re);return m?decode(m[1]):null;}
function field(html,label){const text=decode(html);const m=text.match(new RegExp(`${label}\\s*:\\s*([^\\n]+)`,'i'));return m?.[1]?.trim()||null;}

const rows=localSelect('SELECT rfx_id,title FROM gets_rfx_records ORDER BY rfx_id');
if(!rows.length)throw new Error('No local GETS tenders found. Run scripts/graph-local-snapshot.mjs first.');
console.log(`Enriching ${rows.length} local GETS tender page(s) from public GETS detail pages...`);
const enriched=[];
for(const row of rows){
  const url=`https://www.gets.govt.nz/${agencyCode}/ExternalTenderDetails.htm?id=${encodeURIComponent(row.rfx_id)}`;
  const res=await fetch(url,{headers:{'user-agent':'NZ Records public-data research pilot (+https://nzrecords.co.nz)'}});
  if(!res.ok){console.warn(`RFx ${row.rfx_id}: HTTP ${res.status}; skipped`);continue;}
  const html=await res.text();
  const overview=section(html,'Overview','RFx Outcome');
  if(!overview)console.warn(`RFx ${row.rfx_id}: no Overview parsed`);
  enriched.push({rfx_id:String(row.rfx_id),gets_url:url,overview_text:overview,tender_name:field(html,'Tender Name'),tender_type_text:field(html,'Tender Type'),tender_coverage:field(html,'Tender Coverage'),contact_text:field(html,'Contact'),outcome_text:section(html,'RFx Outcome','Award Date'),fetched_at:new Date().toISOString(),content_hash:createHash('sha256').update(html).digest('hex'),parser_version:PARSER_VERSION});
  console.log(`RFx ${row.rfx_id}: ${overview?`overview ${overview.length} chars`:'no overview'}`);
  await new Promise(r=>setTimeout(r,350));
}
mkdirSync('.graph-preview',{recursive:true});
const sql=['BEGIN TRANSACTION;',...enriched.map(r=>`INSERT OR REPLACE INTO gets_rfx_detail_enrichment (rfx_id,gets_url,overview_text,tender_name,tender_type_text,tender_coverage,contact_text,outcome_text,fetched_at,content_hash,parser_version) VALUES (${q(r.rfx_id)},${q(r.gets_url)},${q(r.overview_text)},${q(r.tender_name)},${q(r.tender_type_text)},${q(r.tender_coverage)},${q(r.contact_text)},${q(r.outcome_text)},${q(r.fetched_at)},${q(r.content_hash)},${q(r.parser_version)});`),'COMMIT;'].join('\n');
writeFileSync('.graph-preview/gets-detail-enrichment.sql',sql);
wrangler(['d1','execute',LOCAL_BINDING,'--local','--file=.graph-preview/gets-detail-enrichment.sql'],{stdio:'inherit'});
console.log(`Done. Stored ${enriched.length} local GETS detail enrichment record(s). No production database writes were made.`);
