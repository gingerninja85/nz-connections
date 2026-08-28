import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, platform }) => {
  const q = url.searchParams.get('q')?.trim();
  if (!q || q.length < 2) return json({ results: [] });
  if (!platform?.env?.DB) return json({ error: 'Database binding is not configured.' }, { status: 503 });

  const terms = q.split(/\s+/).filter(Boolean).map((term) => `"${term.replaceAll('"', '""')}"*`).join(' ');
  const result = await platform.env.DB.prepare(`
    SELECT
      e.id,
      e.canonical_name,
      e.entity_type,
      e.nzbn,
      e.company_number,
      e.status,
      (
        SELECT COUNT(*)
        FROM relationships r
        WHERE r.subject_entity_id = e.id OR r.object_entity_id = e.id
      ) AS relationship_count
    FROM entity_search s
    JOIN entities e ON e.id = s.rowid
    WHERE entity_search MATCH ?
    ORDER BY bm25(entity_search)
    LIMIT 20
  `).bind(terms).all();

  return json({ results: result.results });
};
