import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, platform }) => {
  if (!platform?.env?.DB) error(503, 'Public-record database is not connected yet.');
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) error(404, 'Record not found');

  const entity = await platform.env.DB.prepare(`SELECT id, entity_type, canonical_name, slug, nzbn, company_number, status, metadata_json FROM entities WHERE id = ?1`).bind(id).first();
  if (!entity) error(404, 'Record not found');

  const connections = await platform.env.DB.prepare(`
    SELECT r.id, r.predicate, r.valid_from, r.valid_to, r.observed_at,
      CASE WHEN r.subject_entity_id = ?1 THEN 'out' ELSE 'in' END AS direction,
      e.id AS connected_id, e.canonical_name AS connected_name, e.entity_type AS connected_type, e.status AS connected_status,
      s.dataset, s.publisher, s.record_id, s.source_url, s.published_at, s.retrieved_at, s.licence
    FROM relationships r
    JOIN entities e ON e.id = CASE WHEN r.subject_entity_id = ?1 THEN r.object_entity_id ELSE r.subject_entity_id END
    JOIN sources s ON s.id = r.source_id
    WHERE r.subject_entity_id = ?1 OR r.object_entity_id = ?1
    ORDER BY r.predicate, e.canonical_name
    LIMIT 250
  `).bind(id).all();

  return { entity, connections: connections.results };
};