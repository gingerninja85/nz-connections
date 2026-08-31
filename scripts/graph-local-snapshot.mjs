import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const REMOTE_DB = 'nz-connections-db';
const LOCAL_BINDING = 'DB';
const ROOT_ID = 11102; // Auckland Transport
const TENDER_IDS = [39089, 44414, 38723, 43963, 30015, 31357, 39134];
const tenderList = TENDER_IDS.join(',');

function wrangler(args, opts = {}) {
  return execFileSync('npx', ['wrangler', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opts });
}

function remoteSelect(sql) {
  if (!/^\s*(SELECT|WITH)\b/i.test(sql)) throw new Error('Safety stop: remote query is not read-only SELECT/WITH SQL.');
  const raw = wrangler(['d1', 'execute', REMOTE_DB, '--remote', '--json', '--command', sql]);
  const parsed = JSON.parse(raw);
  const blocks = Array.isArray(parsed) ? parsed : [parsed];
  return blocks.flatMap((b) => b?.results ?? b?.result?.results ?? []);
}

function q(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  return `'${String(v).replaceAll("'", "''")}'`;
}

function insert(table, rows, mode = 'INSERT OR IGNORE') {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  return rows.map((r) => `${mode} INTO ${table} (${cols.map((c)=>`"${c}"`).join(',')}) VALUES (${cols.map((c)=>q(r[c])).join(',')});`).join('\n');
}

console.log('Reading a small Auckland Transport graph slice from production (SELECT only)...');

const relationships = remoteSelect(`
  SELECT r.* FROM relationships r
  WHERE (r.subject_entity_id = ${ROOT_ID} AND r.object_entity_id IN (${tenderList}))
     OR (r.subject_entity_id IN (${tenderList}) AND r.predicate = 'AWARDED_TO')
  ORDER BY r.id
`);

const entityIds = new Set([ROOT_ID, ...TENDER_IDS]);
const sourceIds = new Set();
for (const r of relationships) {
  entityIds.add(Number(r.subject_entity_id));
  entityIds.add(Number(r.object_entity_id));
  sourceIds.add(Number(r.source_id));
}
const entityList = [...entityIds].sort((a,b)=>a-b).join(',');
const sourceList = [...sourceIds].sort((a,b)=>a-b).join(',') || '0';

const entities = remoteSelect(`SELECT * FROM entities WHERE id IN (${entityList}) ORDER BY id`);
const sources = remoteSelect(`SELECT * FROM sources WHERE id IN (${sourceList}) ORDER BY id`);
const entitySources = remoteSelect(`SELECT * FROM entity_sources WHERE entity_id IN (${entityList}) AND source_id IN (${sourceList}) ORDER BY entity_id, source_id`);
const rfx = remoteSelect(`SELECT * FROM gets_rfx_records WHERE entity_id IN (${tenderList}) ORDER BY entity_id`);
const rfxIds = rfx.map((r)=>q(r.rfx_id)).join(',') || "''";
const suppliers = remoteSelect(`SELECT * FROM gets_supplier_records WHERE entity_id IN (${entityList}) AND rfx_id IN (${rfxIds}) ORDER BY rfx_id, row_ordinal_for_rfx`);
const regions = remoteSelect(`SELECT * FROM gets_rfx_regions WHERE rfx_id IN (${rfxIds}) ORDER BY rfx_id, region`);
const categories = remoteSelect(`SELECT * FROM gets_rfx_unspsc_categories WHERE rfx_id IN (${rfxIds}) ORDER BY rfx_id, unspsc_code`);

const sql = [
  'PRAGMA foreign_keys = ON;',
  'BEGIN TRANSACTION;',
  insert('entities', entities, 'INSERT OR REPLACE'),
  insert('sources', sources, 'INSERT OR REPLACE'),
  insert('entity_sources', entitySources, 'INSERT OR REPLACE'),
  insert('gets_rfx_records', rfx, 'INSERT OR REPLACE'),
  insert('relationships', relationships, 'INSERT OR REPLACE'),
  insert('gets_supplier_records', suppliers, 'INSERT OR REPLACE'),
  insert('gets_rfx_regions', regions, 'INSERT OR REPLACE'),
  insert('gets_rfx_unspsc_categories', categories, 'INSERT OR REPLACE'),
  'COMMIT;'
].filter(Boolean).join('\n\n');

mkdirSync('.graph-preview', { recursive: true });
writeFileSync('.graph-preview/auckland-transport.sql', sql);

console.log(`Fetched ${entities.length} entities, ${relationships.length} relationships, ${sources.length} sources.`);
console.log(`GETS: ${rfx.length} tenders, ${suppliers.length} supplier records, ${regions.length} regions, ${categories.length} categories.`);
console.log('Initialising isolated local D1 schema...');
wrangler(['d1', 'execute', LOCAL_BINDING, '--local', '--file=database/schema.sql'], { stdio: 'inherit' });
console.log('Loading snapshot into local D1...');
wrangler(['d1', 'execute', LOCAL_BINDING, '--local', '--file=.graph-preview/auckland-transport.sql'], { stdio: 'inherit' });
console.log('\nDone. Auckland Transport is available locally at /record/11102.');
console.log('Production was queried with SELECT statements only; all writes were to Wrangler local D1.');
