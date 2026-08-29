-- NZ Records GETS post-pilot validation.
-- Phase: AFTER additive GETS migration AND AFTER exactly the approved 10-RFx pilot import.
-- Read-only. This file intentionally references gets_* tables and must not be run before migration/import.
-- Intended command after explicit approval only:
--   npx wrangler d1 execute nz-connections-db --remote --file=database/gets-production-post-pilot-validation.sql

SELECT 'gets_rfx_records' AS metric, COUNT(*) AS value FROM gets_rfx_records;
SELECT 'gets_agency_entities' AS metric, COUNT(*) AS value FROM entities WHERE entity_type='public_agency' AND slug LIKE 'gets-agency-%';
SELECT 'gets_supplier_records' AS metric, COUNT(*) AS value FROM gets_supplier_records;
SELECT 'gets_supplier_entities' AS metric, COUNT(*) AS value FROM entities WHERE entity_type='other' AND json_extract(metadata_json,'$.gets.kind')='supplier_record';
SELECT 'gets_issued_relationships' AS metric, COUNT(*) AS value FROM relationships WHERE predicate='ISSUED' AND json_extract(metadata_json,'$.rfx_id') IN (SELECT rfx_id FROM gets_rfx_records);
SELECT 'gets_awarded_to_relationships' AS metric, COUNT(*) AS value FROM relationships WHERE predicate='AWARDED_TO' AND json_extract(metadata_json,'$.rfx_id') IN (SELECT rfx_id FROM gets_rfx_records);
SELECT 'gets_not_awarded_records' AS metric, COUNT(*) AS value FROM gets_rfx_records WHERE award_type='Not Awarded';
SELECT 'rfx_11613326_awarded_to_count' AS metric, COUNT(*) AS value
FROM relationships r JOIN gets_rfx_records g ON g.entity_id=r.subject_entity_id
WHERE g.rfx_id='11613326' AND r.predicate='AWARDED_TO';
SELECT 'gets_supplier_entities_with_verified_nzbn' AS metric, COUNT(*) AS value
FROM entities WHERE entity_type='other' AND json_extract(metadata_json,'$.gets.kind')='supplier_record' AND nzbn IS NOT NULL;
SELECT 'duplicate_supplier_names_distinct_entities' AS metric, business_name, COUNT(*) AS records, COUNT(DISTINCT entity_id) AS entities
FROM gets_supplier_records WHERE business_name IN ('School Support Ltd','WSP NZ Ltd') GROUP BY business_name;

-- Search/FTS checks after import.
SELECT 'search_procurement_rfx_10199365' AS metric, COUNT(*) AS value FROM entity_search WHERE entity_search MATCH '"10199365"*';
SELECT 'search_gets_agency_auckland' AS metric, COUNT(*) AS value FROM entity_search WHERE entity_search MATCH '"Auckland"*';
SELECT 'search_gets_supplier_evidence_wsp' AS metric, COUNT(*) AS value FROM entity_search WHERE entity_search MATCH '"WSP"*';

-- Identify exactly which rows belong to the 10-RFx pilot for investigation/rollback planning.
SELECT 'pilot_rfx' AS rowset, rfx_id, entity_id FROM gets_rfx_records ORDER BY rfx_id;
SELECT 'pilot_suppliers' AS rowset, supplier_record_key, entity_id, rfx_id, business_name FROM gets_supplier_records ORDER BY rfx_id, business_name, supplier_record_key;
SELECT 'pilot_sources' AS rowset, id, record_id, raw_hash FROM sources WHERE dataset='MBIE_GETS_AWARD_NOTICES_SAMPLE' ORDER BY id;
SELECT 'pilot_relationships' AS rowset, id, predicate, json_extract(metadata_json,'$.rfx_id') AS rfx_id FROM relationships WHERE json_extract(metadata_json,'$.rfx_id') IN (SELECT rfx_id FROM gets_rfx_records) ORDER BY id;
