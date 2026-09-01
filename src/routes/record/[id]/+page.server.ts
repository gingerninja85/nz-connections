import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

type D1DatabaseLike = {
  prepare: (query: string) => { bind: (...values: unknown[]) => { first: () => Promise<unknown>; all: () => Promise<{ results: unknown[] }> } };
};

function isMissingGetsTableError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return /no such table:\s*gets_/i.test(message);
}

async function getsFirst(db: D1DatabaseLike, query: string, ...values: unknown[]) {
  try {
    return await db.prepare(query).bind(...values).first();
  } catch (err) {
    if (isMissingGetsTableError(err)) return null;
    throw err;
  }
}

async function getsAll(db: D1DatabaseLike, query: string, ...values: unknown[]) {
  try {
    return (await db.prepare(query).bind(...values).all()).results;
  } catch (err) {
    if (isMissingGetsTableError(err)) return [];
    throw err;
  }
}

export const load: PageServerLoad = async ({ params, platform }) => {
  if (!platform?.env?.DB) error(503, 'Public-record database is not connected yet.');
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) error(404, 'Record not found');

  const entity = await platform.env.DB.prepare(`
    SELECT id, entity_type, canonical_name, slug, nzbn, company_number, status, metadata_json
    FROM entities
    WHERE id = ?1
  `).bind(id).first();
  if (!entity) error(404, 'Record not found');

  const connections = await platform.env.DB.prepare(`
    SELECT r.id, r.predicate, r.valid_from, r.valid_to, r.observed_at, r.metadata_json AS relationship_metadata_json,
      CASE WHEN r.subject_entity_id = ?1 THEN 'out' ELSE 'in' END AS direction,
      e.id AS connected_id, e.canonical_name AS connected_name, e.entity_type AS connected_type, e.status AS connected_status, e.slug AS connected_slug, e.metadata_json AS connected_metadata_json,
      gr.entity_id AS connected_gets_rfx_entity_id,
      gs.entity_id AS connected_gets_supplier_entity_id,
      s.publisher, s.record_id, s.source_url, s.published_at, s.retrieved_at, s.licence
    FROM relationships r
    JOIN entities e ON e.id = CASE WHEN r.subject_entity_id = ?1 THEN r.object_entity_id ELSE r.subject_entity_id END
    LEFT JOIN gets_rfx_records gr ON gr.entity_id = e.id
    LEFT JOIN gets_supplier_records gs ON gs.entity_id = e.id
    JOIN sources s ON s.id = r.source_id
    WHERE r.subject_entity_id = ?1 OR r.object_entity_id = ?1
    ORDER BY r.predicate, e.canonical_name
    LIMIT 250
  `).bind(id).all();

  const getsRfx = (await getsFirst(platform.env.DB, `
    SELECT * FROM gets_rfx_records WHERE entity_id = ?1
  `, id)) as Record<string, any> | null;

  const getsSupplier = (await getsFirst(platform.env.DB, `
    SELECT * FROM gets_supplier_records WHERE entity_id = ?1
  `, id)) as Record<string, any> | null;

  let getsRegions: unknown[] = [];
  let getsCategories: unknown[] = [];
  let getsSuppliers: unknown[] = [];
  let getsRelatedRfx: unknown[] = [];
  let getsAgency = false;

  const recordSourceEvidence = await platform.env.DB.prepare(`
    SELECT CASE WHEN s.dataset = 'charities-register' THEN 'charity' ELSE 'public' END AS source_kind, s.publisher, s.record_id, s.source_url, s.published_at, s.retrieved_at, s.licence
    FROM entity_sources es
    JOIN sources s ON s.id = es.source_id
    WHERE es.entity_id = ?1
    ORDER BY s.retrieved_at DESC, s.id DESC
    LIMIT 1
  `).bind(id).first();

  if (getsRfx) {
    getsRegions = await getsAll(platform.env.DB, `
      SELECT region FROM gets_rfx_regions WHERE rfx_id = ?1 ORDER BY region
    `, getsRfx.rfx_id);
    getsCategories = await getsAll(platform.env.DB, `
      SELECT unspsc_code, unspsc_description FROM gets_rfx_unspsc_categories WHERE rfx_id = ?1 ORDER BY unspsc_code, unspsc_description
    `, getsRfx.rfx_id);
    getsSuppliers = await getsAll(platform.env.DB, `
      SELECT g.business_name, g.nzbn_quality, g.raw_supplier_nzbn, e.id AS entity_id
      FROM gets_supplier_records g
      JOIN entities e ON e.id = g.entity_id
      WHERE g.rfx_id = ?1
      ORDER BY g.row_ordinal_for_rfx
    `, getsRfx.rfx_id);
  }

  if (getsSupplier) {
    getsRelatedRfx = await getsAll(platform.env.DB, `
      SELECT g.rfx_id, g.title, g.award_type, e.id AS entity_id
      FROM gets_rfx_records g
      JOIN entities e ON e.id = g.entity_id
      WHERE g.rfx_id = ?1
    `, getsSupplier.rfx_id);
  }

  getsAgency = !!(await getsFirst(platform.env.DB, `
    SELECT 1 FROM gets_rfx_records WHERE agency_entity_id = ?1 LIMIT 1
  `, id));

  return {
    entity,
    connections: connections.results,
    gets: {
      rfx: getsRfx,
      supplier: getsSupplier,
      regions: getsRegions,
      categories: getsCategories,
      suppliers: getsSuppliers,
      relatedRfx: getsRelatedRfx,
      agency: getsAgency
    },
    sourceEvidence: recordSourceEvidence
  };
};
