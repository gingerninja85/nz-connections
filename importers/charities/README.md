# Charities Register importer

NZ Connections can ingest public records from the New Zealand Charities Register using the Charities Services OData service.

Official documentation: https://www.charities.govt.nz/charities-in-new-zealand/the-charities-register/open-data

## Source characteristics

- Publisher: Charities Services, Department of Internal Affairs
- Access: public, read-only OData; no authentication or registration required
- Licence: Creative Commons Attribution 3.0 New Zealand
- Core records: charities, officers and annual returns
- Default OData query limit: 1,000 records unless `$returnall=true` is requested

The importer deliberately excludes charity email addresses. NZ Connections does not need them for relationship mapping and Charities Services specifically restricts use of published addresses for unsolicited marketing.

## Generate SQL

For a small validation batch:

```bash
node importers/charities/to-sql.mjs --limit=100 > charities.sql
```

For the full organisation register:

```bash
node importers/charities/to-sql.mjs > charities.sql
```

Apply the schema before importing. The generated SQL is designed for D1 and records provenance in `sources` and `entity_sources`.

## Next stage: officers

Officer ingestion is intentionally separate from the first organisation import. Before creating person-to-charity relationships, the importer will be validated against the current Charities Services data dictionary/ERD so that appointment/removal dates and officer identifiers are mapped conservatively. Officer relationships will use the predicate `OFFICER_OF` and retain their Charities Register source record.

No inference should be made from a person's name alone when joining an officer to a person from another dataset. Cross-dataset person resolution requires stronger evidence or explicit review.
