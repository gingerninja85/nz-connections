-- NZ Records GETS production-pilot additive migration.
-- Purpose: add only GETS-specific tables/indexes for the approved 10-RFx pilot.
-- Safe/idempotent: CREATE TABLE/INDEX IF NOT EXISTS only.
-- Non-actions: no DROP, DELETE, UPDATE, ALTER, TRUNCATE, FTS rebuild, or existing table rewrite.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS gets_rfx_records (
  rfx_id TEXT PRIMARY KEY,
  entity_id INTEGER NOT NULL UNIQUE REFERENCES entities(id) ON DELETE CASCADE,
  agency_entity_id INTEGER NOT NULL REFERENCES entities(id),
  posting_agency TEXT NOT NULL,
  title TEXT NOT NULL,
  rfx_type TEXT,
  competition_type TEXT,
  reference_number TEXT,
  open_date TEXT,
  close_date TEXT,
  awarded_date TEXT,
  award_type TEXT NOT NULL,
  awarded_amount_raw TEXT,
  awarded_amount_decimal_text TEXT,
  awarded_amount_numeric REAL,
  report_date TEXT,
  source_filename TEXT NOT NULL,
  source_line_number INTEGER NOT NULL,
  row_hash TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_gets_rfx_agency ON gets_rfx_records(agency_entity_id);
CREATE INDEX IF NOT EXISTS idx_gets_rfx_award_type ON gets_rfx_records(award_type);

CREATE TABLE IF NOT EXISTS gets_supplier_records (
  supplier_record_key TEXT PRIMARY KEY,
  entity_id INTEGER NOT NULL UNIQUE REFERENCES entities(id) ON DELETE CASCADE,
  rfx_id TEXT NOT NULL REFERENCES gets_rfx_records(rfx_id) ON DELETE CASCADE,
  row_ordinal_for_rfx INTEGER NOT NULL,
  business_name TEXT NOT NULL,
  raw_supplier_nzbn TEXT,
  nzbn_quality TEXT NOT NULL CHECK(nzbn_quality IN ('VALID_FULL','MISSING','SCIENTIFIC_NOTATION_LOSSY','MALFORMED','OTHER_UNUSABLE')),
  full_address TEXT,
  country TEXT,
  website TEXT,
  report_date TEXT,
  source_filename TEXT NOT NULL,
  source_line_number INTEGER NOT NULL,
  row_hash TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_gets_supplier_rfx ON gets_supplier_records(rfx_id);
CREATE INDEX IF NOT EXISTS idx_gets_supplier_name ON gets_supplier_records(business_name);
CREATE INDEX IF NOT EXISTS idx_gets_supplier_nzbn_quality ON gets_supplier_records(nzbn_quality);

CREATE TABLE IF NOT EXISTS gets_rfx_regions (
  rfx_id TEXT NOT NULL REFERENCES gets_rfx_records(rfx_id) ON DELETE CASCADE,
  region TEXT NOT NULL,
  report_date TEXT,
  source_filename TEXT NOT NULL,
  source_line_number INTEGER NOT NULL,
  row_hash TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  PRIMARY KEY (rfx_id, region, source_line_number)
);

CREATE INDEX IF NOT EXISTS idx_gets_regions_region ON gets_rfx_regions(region);

CREATE TABLE IF NOT EXISTS gets_rfx_unspsc_categories (
  rfx_id TEXT NOT NULL REFERENCES gets_rfx_records(rfx_id) ON DELETE CASCADE,
  unspsc_code TEXT NOT NULL,
  unspsc_description TEXT,
  report_date TEXT,
  source_filename TEXT NOT NULL,
  source_line_number INTEGER NOT NULL,
  row_hash TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  PRIMARY KEY (rfx_id, unspsc_code, source_line_number)
);

CREATE INDEX IF NOT EXISTS idx_gets_unspsc_code ON gets_rfx_unspsc_categories(unspsc_code);
