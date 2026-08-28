# NZ Connections

Open-source relationship explorer for New Zealand public-interest data.

> **Evidence, not conclusions.** NZ Connections connects public records and shows the provenance behind every relationship. It does not assign suspicion or infer wrongdoing.

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

The D1 schema lives in `database/schema.sql`. A production D1 binding will be added to `wrangler.jsonc` after the Cloudflare database is created.

## Deploy

```bash
npm run build
npm run deploy
```

The initial Worker can use its `workers.dev` address. The intended test/public hostname is `connections.askhermie.dev` once the Cloudflare project is connected.

## Documentation

See `docs/architecture.md` for the MVP architecture, product principles, canonical data model and ingestion plan.

## Licence

GNU Affero General Public License v3.0 (AGPL-3.0).
