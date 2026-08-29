-- NZ Records GETS production baseline validation.
-- Phase: BEFORE any GETS migration or pilot import.
-- Read-only. Safe before GETS tables exist: this file intentionally contains no gets_* table references.
-- Intended command after explicit approval only:
--   npx wrangler d1 execute nz-connections-db --remote --file=database/gets-production-baseline.sql

SELECT 'baseline_entities' AS metric, COUNT(*) AS value FROM entities;
SELECT 'baseline_charity_entities' AS metric, COUNT(*) AS value FROM entities WHERE entity_type='charity';
SELECT 'baseline_person_entities' AS metric, COUNT(*) AS value FROM entities WHERE entity_type='person';
SELECT 'baseline_public_agency_entities' AS metric, COUNT(*) AS value FROM entities WHERE entity_type='public_agency';
SELECT 'baseline_other_entities' AS metric, COUNT(*) AS value FROM entities WHERE entity_type='other';
SELECT 'baseline_sources' AS metric, COUNT(*) AS value FROM sources;
SELECT 'baseline_entity_sources' AS metric, COUNT(*) AS value FROM entity_sources;
SELECT 'baseline_relationships' AS metric, COUNT(*) AS value FROM relationships;
SELECT 'baseline_entity_search_rows' AS metric, COUNT(*) AS value FROM entity_search;

-- Collision preflight: these should normally be zero before the GETS pilot.
-- If either returns rows, STOP and inspect before migration/import.
SELECT 'preexisting_gets_slug_prefixes' AS metric, COUNT(*) AS value FROM entities WHERE slug LIKE 'gets-%';
SELECT 'preexisting_gets_sample_sources' AS metric, COUNT(*) AS value FROM sources WHERE dataset='MBIE_GETS_AWARD_NOTICES_SAMPLE';
