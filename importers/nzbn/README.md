# NZBN importer

NZ Connections will use NZBN as the canonical business identity layer for the first real-data milestone.

## Source

Official NZBN bulk data is refreshed monthly and contains public NZBN information for registered businesses. Company data is available as JSON and CSV; other entity types are JSON. Access must be requested from the Companies Office and is free once approved.

Official source: https://www.nzbn.govt.nz/using-the-nzbn/nzbn-services/bulk-data/

## Import contract

The importer must:

1. Never infer a relationship that is not explicitly represented by a source record.
2. Preserve the NZBN as an external identifier and deduplication key.
3. Preserve legal/canonical name and entity type.
4. Record the source dataset, publisher, retrieval time, source record identifier/URL when available, importer version and a raw-record hash.
5. Be idempotent: importing the same snapshot twice must not create duplicate entities or relationships.
6. Separate raw source parsing from canonical database writes so source-format changes are testable.
7. Reject malformed records into an import-errors log rather than silently dropping them.

## Pipeline

`bulk file -> parser -> normalized records -> validation -> entity upsert -> source record -> relationship upsert -> import report`

## Initial scope

The first pass intentionally imports only business identity records. Director/shareholder relationships should come from the Companies Register bulk dataset because NZBN's primary purpose is business identity, not a complete relationship graph.

## Local development

A small fixture will live under `importers/nzbn/fixtures/` and contain synthetic records only. Real bulk files must not be committed to Git; they can be large and may be subject to access terms.
