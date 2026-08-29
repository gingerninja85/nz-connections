-- NZ Records GETS post-migration validation.
-- Phase: AFTER applying database/migrations/0001_gets_pilot_additive.sql, BEFORE pilot import.
-- Read-only. This file intentionally references gets_* tables and must not be run before the GETS migration.
-- Intended command after explicit approval only:
--   npx wrangler d1 execute nz-connections-db --remote --file=database/gets-production-post-migration-validation.sql

SELECT 'gets_rfx_records_exists_zero' AS metric, COUNT(*) AS value FROM gets_rfx_records;
SELECT 'gets_supplier_records_exists_zero' AS metric, COUNT(*) AS value FROM gets_supplier_records;
SELECT 'gets_rfx_regions_exists_zero' AS metric, COUNT(*) AS value FROM gets_rfx_regions;
SELECT 'gets_rfx_unspsc_categories_exists_zero' AS metric, COUNT(*) AS value FROM gets_rfx_unspsc_categories;

-- Existing production graph/search sanity after additive migration.
SELECT 'charity_entities_after_migration' AS metric, COUNT(*) AS value FROM entities WHERE entity_type='charity';
SELECT 'person_entities_after_migration' AS metric, COUNT(*) AS value FROM entities WHERE entity_type='person';
SELECT 'sources_after_migration' AS metric, COUNT(*) AS value FROM sources;
SELECT 'entity_sources_after_migration' AS metric, COUNT(*) AS value FROM entity_sources;
SELECT 'relationships_after_migration' AS metric, COUNT(*) AS value FROM relationships;
SELECT 'entity_search_after_migration' AS metric, COUNT(*) AS value FROM entity_search;

-- Collision preflight remains mandatory before pilot import.
SELECT 'preexisting_gets_slug_prefixes_before_import' AS metric, COUNT(*) AS value FROM entities WHERE slug LIKE 'gets-%';
SELECT 'preexisting_gets_sample_sources_before_import' AS metric, COUNT(*) AS value FROM sources WHERE dataset='MBIE_GETS_AWARD_NOTICES_SAMPLE';
