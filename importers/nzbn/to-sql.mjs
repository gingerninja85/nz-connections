#!/usr/bin/env node
import { createReadStream, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { basename } from 'node:path';

const [inputPath, outputPath = 'database/nzbn-import.sql'] = process.argv.slice(2);
if (!inputPath) {
  console.error('Usage: node importers/nzbn/to-sql.mjs <records.ndjson> [output.sql]');
  process.exit(1);
}

const out = createWriteStream(outputPath, { encoding: 'utf8' });
const retrievedAt = new Date().toISOString();
let accepted = 0;
let rejected = 0;

function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function first(record, keys) { for (const key of keys) { const value = text(record[key]); if (value) return value; } return null; }
function quote(value) { return value == null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`; }
function slug(name, nzbn) { const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70); return `${base || 'entity'}-${nzbn}`; }

function normalize(record) {
  const nzbn = first(record, ['nzbn', 'NZBN', 'nzbnNumber']);
  const canonicalName = first(record, ['entityName', 'legalName', 'name', 'EntityName']);
  const entityTypeRaw = first(record, ['entityType', 'businessType', 'EntityType'])?.toLowerCase() ?? '';
  const status = first(record, ['entityStatus', 'status', 'EntityStatus']);
  if (!nzbn || !/^94\d{11}$/.test(nzbn)) throw new Error('missing/invalid NZBN');
  if (!canonicalName) throw new Error('missing canonical name');
  const entityType = entityTypeRaw.includes('company') ? 'company' : entityTypeRaw.includes('public') || entityTypeRaw.includes('government') ? 'public_agency' : 'other';
  return { nzbn, canonicalName, entityType, status };
}

out.write(`-- Generated from ${basename(inputPath)} at ${retrievedAt}\nPRAGMA foreign_keys = ON;\n`);

const lines = createInterface({ input: createReadStream(inputPath), crlfDelay: Infinity });
for await (const line of lines) {
  if (!line.trim()) continue;
  try {
    const record = JSON.parse(line);
    const n = normalize(record);
    const metadata = JSON.stringify({ source: 'NZBN bulk data' });
    out.write(`INSERT INTO entities (entity_type, canonical_name, slug, nzbn, status, metadata_json) VALUES (${quote(n.entityType)}, ${quote(n.canonicalName)}, ${quote(slug(n.canonicalName, n.nzbn))}, ${quote(n.nzbn)}, ${quote(n.status)}, ${quote(metadata)}) ON CONFLICT(slug) DO UPDATE SET canonical_name=excluded.canonical_name, entity_type=excluded.entity_type, nzbn=excluded.nzbn, status=excluded.status, metadata_json=excluded.metadata_json, updated_at=CURRENT_TIMESTAMP;\n`);
    out.write(`INSERT INTO sources (dataset, publisher, record_id, source_url, retrieved_at, licence, importer_version) VALUES ('NZBN bulk data', 'Ministry of Business, Innovation and Employment', ${quote(n.nzbn)}, 'https://www.nzbn.govt.nz/', ${quote(retrievedAt)}, 'NZBN data terms', 'nzbn-v0.1') ON CONFLICT(dataset, record_id, source_url) DO UPDATE SET retrieved_at=excluded.retrieved_at, importer_version=excluded.importer_version;\n`);
    accepted++;
  } catch (error) {
    rejected++;
    console.error(`Rejected line ${accepted + rejected}: ${error.message}`);
  }
}
out.end();
await new Promise((resolve, reject) => { out.on('finish', resolve); out.on('error', reject); });
console.log(JSON.stringify({ input: inputPath, output: outputPath, accepted, rejected, retrievedAt }, null, 2));
if (rejected) process.exitCode = 2;
