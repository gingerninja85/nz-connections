-- Additive enrichment captured from public individual GETS tender pages.
-- Keeps page-derived narrative separate from the MBIE bulk award dataset.
CREATE TABLE IF NOT EXISTS gets_rfx_detail_enrichment (
  rfx_id TEXT PRIMARY KEY REFERENCES gets_rfx_records(rfx_id) ON DELETE CASCADE,
  gets_url TEXT NOT NULL,
  overview_text TEXT,
  tender_name TEXT,
  tender_type_text TEXT,
  tender_coverage TEXT,
  contact_text TEXT,
  outcome_text TEXT,
  fetched_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  parser_version TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gets_detail_fetched_at ON gets_rfx_detail_enrichment(fetched_at);
