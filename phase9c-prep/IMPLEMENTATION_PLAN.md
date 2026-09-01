# Phase 9C-1 implementation plan

1. Keep production untouched: only local files, local tests, read-only SELECTs for suffixed record review.
2. Add a reusable `importers/charities/phase9c-prep.mjs` module/CLI for snapshot paging, validation, manifests, rejects, SQL chunk generation, and local-only command planning.
3. Preserve existing importers where possible; add compatibility wrappers/docs rather than production execution paths.
4. Add fixture-driven Node tests that prove validation/quarantine, OfficerId source-scoped identity, no name merge, body corporate typing, provenance/direct URLs, deterministic chunks, and idempotency SQL shape.
5. Update README/package scripts and gitignore large snapshot/chunk outputs.
6. Produce `phase9c-prep/SUFFIXED_CHARITY_RECORDS_REVIEW.md` from read-only D1 SELECTs.
7. Run required checks, then commit and push `feature/phase9c-full-charities-import-prep` without committing generated full-corpus data or evidence dumps.
