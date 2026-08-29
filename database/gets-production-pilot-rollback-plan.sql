-- NZ Records GETS production-pilot rollback plan.
-- REVIEW ONLY. Do not execute unless Stuart/ChatGPT explicitly approves.
-- Goal: remove only the approved 10-RFx pilot rows using deterministic GETS dataset/source identifiers.
-- Never delete by broad entity_type such as `contract`.

PRAGMA foreign_keys = ON;

BEGIN TRANSACTION;

-- Investigation preview: counts to be affected.
SELECT 'relationships_to_delete' AS metric, COUNT(*) AS value
FROM relationships
WHERE json_extract(metadata_json,'$.rfx_id') IN (SELECT rfx_id FROM gets_rfx_records);
SELECT 'entity_sources_to_delete' AS metric, COUNT(*) AS value
FROM entity_sources es JOIN entities e ON e.id=es.entity_id
WHERE e.slug LIKE 'gets-rfx-%' OR e.slug LIKE 'gets-agency-%' OR e.slug LIKE 'gets-supplier-%';
SELECT 'supplier_records_to_delete' AS metric, COUNT(*) AS value FROM gets_supplier_records;
SELECT 'rfx_records_to_delete' AS metric, COUNT(*) AS value FROM gets_rfx_records;
SELECT 'sources_to_delete' AS metric, COUNT(*) AS value FROM sources WHERE dataset='MBIE_GETS_AWARD_NOTICES_SAMPLE';
SELECT 'entities_to_delete' AS metric, COUNT(*) AS value
FROM entities
WHERE slug LIKE 'gets-rfx-%'
   OR slug LIKE 'gets-supplier-%'
   OR (slug LIKE 'gets-agency-%' AND json_extract(metadata_json,'$.gets.identity_scope')='GETS_SOURCE_NAME');

-- Destructive section. Keep commented until explicitly approved.
-- DELETE FROM relationships
-- WHERE json_extract(metadata_json,'$.rfx_id') IN (SELECT rfx_id FROM gets_rfx_records);
--
-- DELETE FROM entity_sources
-- WHERE entity_id IN (
--   SELECT id FROM entities
--   WHERE slug LIKE 'gets-rfx-%'
--      OR slug LIKE 'gets-supplier-%'
--      OR (slug LIKE 'gets-agency-%' AND json_extract(metadata_json,'$.gets.identity_scope')='GETS_SOURCE_NAME')
-- )
-- OR source_id IN (SELECT id FROM sources WHERE dataset='MBIE_GETS_AWARD_NOTICES_SAMPLE');
--
-- DELETE FROM gets_rfx_unspsc_categories;
-- DELETE FROM gets_rfx_regions;
-- DELETE FROM gets_supplier_records;
-- DELETE FROM gets_rfx_records;
--
-- DELETE FROM entities
-- WHERE slug LIKE 'gets-rfx-%'
--    OR slug LIKE 'gets-supplier-%'
--    OR (slug LIKE 'gets-agency-%' AND json_extract(metadata_json,'$.gets.identity_scope')='GETS_SOURCE_NAME');
--
-- DELETE FROM sources WHERE dataset='MBIE_GETS_AWARD_NOTICES_SAMPLE';
--
-- DELETE FROM import_runs WHERE dataset='MBIE_GETS_AWARD_NOTICES_SAMPLE';
-- DELETE FROM import_errors WHERE import_run_id NOT IN (SELECT id FROM import_runs);

-- Default for this file: no destructive action.
ROLLBACK;
