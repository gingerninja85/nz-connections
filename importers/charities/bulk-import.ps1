param(
  [int]$Charities = 5000,
  [int]$Officers = 5000,
  [string]$Database = 'nz-connections-db'
)
$ErrorActionPreference = 'Stop'
Write-Host "Generating $Charities charities..."
node .\importers\charities\to-sql.mjs --limit=$Charities | Out-File .\charities-bulk.sql -Encoding utf8
Write-Host "Generating $Officers officers..."
node .\importers\charities\officers-to-sql.mjs --limit=$Officers | Out-File .\charity-officers-bulk.sql -Encoding utf8
$charityStatements=(Select-String .\charities-bulk.sql -Pattern 'INSERT INTO entities').Count
$officerStatements=(Select-String .\charity-officers-bulk.sql -Pattern 'INSERT INTO entities').Count
$relationshipStatements=(Select-String .\charity-officers-bulk.sql -Pattern 'INSERT INTO relationships').Count
Write-Host "Generated: charities=$charityStatements officers=$officerStatements relationships=$relationshipStatements"
if($charityStatements -lt 1 -or $officerStatements -lt 1){ throw 'Generated SQL failed sanity check.' }
Write-Host 'Importing charities...'
npx wrangler d1 execute $Database --remote --file=charities-bulk.sql
if($LASTEXITCODE -ne 0){throw 'Charity import failed.'}
Write-Host 'Importing officers and relationships...'
npx wrangler d1 execute $Database --remote --file=charity-officers-bulk.sql
if($LASTEXITCODE -ne 0){throw 'Officer import failed.'}
Write-Host 'Verifying production counts...'
npx wrangler d1 execute $Database --remote --command "SELECT (SELECT COUNT(*) FROM entities WHERE entity_type='charity') AS charities,(SELECT COUNT(*) FROM entities WHERE entity_type='person') AS people,(SELECT COUNT(*) FROM sources) AS sources,(SELECT COUNT(*) FROM relationships WHERE predicate='OFFICER_OF') AS officer_of,(SELECT COUNT(*) FROM import_runs) AS import_runs;"
