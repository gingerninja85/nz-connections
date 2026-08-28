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
  raw_hash TEXT,
  UNIQUE(dataset, record_id, source_url)
);

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
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(subject_entity_id, predicate, object_entity_id, source_id, valid_from)
);

CREATE INDEX IF NOT EXISTS idx_relationships_subject ON relationships(subject_entity_id);
CREATE INDEX IF NOT EXISTS idx_relationships_object ON relationships(object_entity_id);
CREATE INDEX IF NOT EXISTS idx_relationships_predicate ON relationships(predicate);

CREATE VIRTUAL TABLE IF NOT EXISTS entity_search USING fts5(
  canonical_name,
  entity_type,
  nzbn,
  company_number,
  content='entities',
  content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS entities_ai AFTER INSERT ON entities BEGIN
  INSERT INTO entity_search(rowid, canonical_name, entity_type, nzbn, company_number)
  VALUES (new.id, new.canonical_name, new.entity_type, new.nzbn, new.company_number);
END;
CREATE TRIGGER IF NOT EXISTS entities_ad AFTER DELETE ON entities BEGIN
  INSERT INTO entity_search(entity_search, rowid, canonical_name, entity_type, nzbn, company_number)
  VALUES ('delete', old.id, old.canonical_name, old.entity_type, old.nzbn, old.company_number);
END;
CREATE TRIGGER IF NOT EXISTS entities_au AFTER UPDATE ON entities BEGIN
  INSERT INTO entity_search(entity_search, rowid, canonical_name, entity_type, nzbn, company_number)
  VALUES ('delete', old.id, old.canonical_name, old.entity_type, old.nzbn, old.company_number);
  INSERT INTO entity_search(rowid, canonical_name, entity_type, nzbn, company_number)
  VALUES (new.id, new.canonical_name, new.entity_type, new.nzbn, new.company_number);
END;
