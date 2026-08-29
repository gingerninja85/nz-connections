PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('person','company','public_agency','charity','contract','other')),
  canonical_name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  nzbn TEXT,
  company_number TEXT,
  status TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(canonical_name);
CREATE INDEX IF NOT EXISTS idx_entities_nzbn ON entities(nzbn);
CREATE INDEX IF NOT EXISTS idx_entities_company_number ON entities(company_number);
-- NZBN is indexed for matching but is deliberately not unique here. A public
-- source may contain multiple register records carrying the same NZBN; entity
-- reconciliation is a separate evidence-backed process, not an ingest rule.
DROP INDEX IF EXISTS idx_entities_unique_nzbn;

CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset TEXT NOT NULL,
  publisher TEXT NOT NULL,
  record_id TEXT,
  source_url TEXT NOT NULL,
  published_at TEXT,
  retrieved_at TEXT NOT NULL,
  licence TEXT,
  importer_version TEXT,
  raw_hash TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sources_identity
ON sources(dataset, COALESCE(record_id, ''), source_url);

CREATE TABLE IF NOT EXISTS entity_sources (
  entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (entity_id, source_id)
);
CREATE INDEX IF NOT EXISTS idx_entity_sources_source ON entity_sources(source_id);

CREATE TABLE IF NOT EXISTS relationships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_entity_id INTEGER NOT NULL REFERENCES entities(id),
  predicate TEXT NOT NULL,
  object_entity_id INTEGER NOT NULL REFERENCES entities(id),
  source_id INTEGER NOT NULL REFERENCES sources(id),
  valid_from TEXT,
  valid_to TEXT,
  observed_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_relationships_subject ON relationships(subject_entity_id);
CREATE INDEX IF NOT EXISTS idx_relationships_object ON relationships(object_entity_id);
CREATE INDEX IF NOT EXISTS idx_relationships_predicate ON relationships(predicate);
CREATE UNIQUE INDEX IF NOT EXISTS idx_relationships_identity ON relationships(subject_entity_id, predicate, object_entity_id, source_id, COALESCE(valid_from, ''));

CREATE TABLE IF NOT EXISTS import_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset TEXT NOT NULL,
  source_snapshot TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','completed','failed')),
  rows_seen INTEGER NOT NULL DEFAULT 0,
  rows_written INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS import_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_run_id INTEGER NOT NULL REFERENCES import_runs(id) ON DELETE CASCADE,
  row_reference TEXT,
  error_message TEXT NOT NULL,
  raw_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_import_errors_run ON import_errors(import_run_id);

CREATE VIRTUAL TABLE IF NOT EXISTS entity_search USING fts5(canonical_name,entity_type,nzbn,company_number,content='entities',content_rowid='id');
CREATE TRIGGER IF NOT EXISTS entities_ai AFTER INSERT ON entities BEGIN
  INSERT INTO entity_search(rowid,canonical_name,entity_type,nzbn,company_number) VALUES(new.id,new.canonical_name,new.entity_type,new.nzbn,new.company_number);
END;
CREATE TRIGGER IF NOT EXISTS entities_ad AFTER DELETE ON entities BEGIN
  INSERT INTO entity_search(entity_search,rowid,canonical_name,entity_type,nzbn,company_number) VALUES('delete',old.id,old.canonical_name,old.entity_type,old.nzbn,old.company_number);
END;
CREATE TRIGGER IF NOT EXISTS entities_au AFTER UPDATE ON entities BEGIN
  INSERT INTO entity_search(entity_search,rowid,canonical_name,entity_type,nzbn,company_number) VALUES('delete',old.id,old.canonical_name,old.entity_type,old.nzbn,old.company_number);
  INSERT INTO entity_search(rowid,canonical_name,entity_type,nzbn,company_number) VALUES(new.id,new.canonical_name,new.entity_type,new.nzbn,new.company_number);
END;

-- MBIE/GETS local integration extension.
-- Non-destructive source-ingestion layer for local validation. Regions and
-- UNSPSC remain structured source associations, not graph entities.

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
