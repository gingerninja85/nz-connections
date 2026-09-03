# NZ Records

Open-source relationship explorer for New Zealand public-interest data.

> **Evidence, not conclusions.** NZ Records connects public records and shows the provenance behind every relationship. It does not assign suspicion or infer wrongdoing.

## Status

Early prototype. The first milestone is company/person/public-agency search backed by a provenance-first relationship model.

## Stack

- SvelteKit + TypeScript
- Cloudflare Workers
- Cloudflare D1
- Wrangler

## Development

```bash
npm install
npm run dev
```

The D1 schema lives in `database/schema.sql`. A D1 binding named `DB` is already declared in `wrangler.jsonc`; it can be used once the Cloudflare database exists and is connected.

## Deploy (production)

```bash
npm run build
npm run deploy
```

The Worker is deployed to Cloudflare Workers. The initial deployment can use its `workers.dev` address, then the production custom domain `nzrecords.co.nz` is attached once the project is connected. Production runs on Cloudflare Workers backed by a Cloudflare D1 database.

## Development (local)

Development runs separately from production and does not require deploying to Cloudflare:

```bash
npm install
npm run dev
```

The Vite server listens on `0.0.0.0:5173`. On the separate Ubuntu development server, Nginx proxies to that port and a Cloudflare Tunnel publishes it as `dev.nzrecords.co.nz`. This is independent of the production Worker and its custom domains.

## Documentation

See `docs/architecture.md` for the MVP architecture, product principles, canonical data model and ingestion plan.

## Licence

GNU Affero General Public License v3.0 (AGPL-3.0).
