# NZ Records architecture

## Mission

Make relationships in New Zealand public-interest records easy to explore while preserving the evidence behind every displayed fact.

## Product rule

**Evidence, not conclusions.** The application reports what public records say and where they say it. It must not assign suspicion, corruption scores, risk labels, or inferred motives.

## MVP

1. Search a company, person or public agency.
2. Open an entity record.
3. See first-degree relationships such as `DIRECTOR_OF` and `AWARDED_CONTRACT`.
4. Traverse to connected entities.
5. Inspect provenance for every relationship.
6. Open the original public source.

## Runtime architecture

- SvelteKit + TypeScript
- Cloudflare Workers
- Cloudflare D1
- Wrangler for local development, schema migration and deployment
- GitHub as source of truth

Cloudflare currently documents SvelteKit as a supported full-stack Workers framework. The official Cloudflare adapter produces the Worker and static assets, and D1 is exposed through a Worker binding.

## Canonical model

`entities` stores nodes. `relationships` stores directed edges. `sources` stores provenance.

A relationship cannot exist without a `source_id`. This is intentional: provenance is a database constraint, not merely a UI convention.

### Entity examples

- person
- company
- public_agency
- charity
- contract

### Relationship examples

- `DIRECTOR_OF`
- `SHAREHOLDER_OF`
- `AWARDED_CONTRACT`
- `CONTRACTED_BY`
- `OFFICER_OF`
- `MENTIONED_IN`

Predicates describe records, not interpretations.

## Data ingestion order

1. NZ Companies Register / NZBN
2. Government procurement / GETS
3. Charities Register
4. FYI OIA records
5. Parliamentary and electoral public datasets

Each importer must retain source record identifiers, retrieval timestamps, publication/effective dates where available, and an importer version.

## Scale strategy

D1 is deliberately the MVP store. The canonical entity/relationship model does not depend on graph-database-specific features. If shortest-path and high-degree graph queries later exceed D1's practical envelope, a graph read model can be introduced without discarding the canonical provenance store.

## Deployment

Initial deployment target: Cloudflare Workers, optionally using a generated `workers.dev` address before attaching the production custom domain `nzrecords.co.nz`. Production runs on Cloudflare Workers backed by Cloudflare D1.

Development is separate from production and does not require deploying to Cloudflare: it runs Vite (on port 5173) behind Nginx, published as `dev.nzrecords.co.nz` through a Cloudflare Tunnel on the Ubuntu development server.
