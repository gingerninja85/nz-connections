import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 50;

function readPositiveInt(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const GET: RequestHandler = async ({ url, platform }) => {
  const q = url.searchParams.get('q')?.trim();
  if (!q || q.length < 2) return json({ results: [], page: 1, pageSize: DEFAULT_PAGE_SIZE, total: 0, totalPages: 1 });
  if (!platform?.env?.DB) return json({ error: 'Database binding is not configured.' }, { status: 503 });

  const pageSize = Math.min(readPositiveInt(url.searchParams.get('pageSize'), DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  const requestedPage = readPositiveInt(url.searchParams.get('page'), 1);
  const terms = q.split(/\s+/).filter(Boolean).map((term) => `"${term.replaceAll('"', '""')}"*`).join(' ');

  const countResult = await platform.env.DB.prepare(`SELECT COUNT(*) AS total FROM entity_search WHERE entity_search MATCH ?`).bind(terms).first<{ total: number }>();
  const total = Number(countResult?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * pageSize;

  const result = await platform.env.DB.prepare(`
    SELECT
      e.id,
      CASE
        WHEN gr.entity_id IS NOT NULL THEN gr.title
        WHEN gs.entity_id IS NOT NULL THEN gs.business_name
        ELSE e.canonical_name
      END AS canonical_name,
      CASE
        WHEN gr.entity_id IS NOT NULL THEN 'Government tender'
        WHEN gs.entity_id IS NOT NULL THEN 'GETS supplier record'
        WHEN json_extract(e.metadata_json, '$.gets.kind') = 'agency' THEN 'Government agency'
        WHEN e.slug LIKE 'charities-officer-%' THEN 'Charity officer record'
        WHEN e.entity_type = 'charity' THEN 'Charity'
        WHEN e.entity_type = 'company' THEN 'Company'
        WHEN e.entity_type = 'person' THEN 'Person'
        ELSE 'Public record'
      END AS entity_type,
      e.nzbn,
      e.company_number,
      e.status,
      CASE
        WHEN gr.entity_id IS NOT NULL THEN 'Government tender'
        WHEN gs.entity_id IS NOT NULL THEN 'GETS supplier record'
        WHEN json_extract(e.metadata_json, '$.gets.kind') = 'agency' THEN 'Government agency'
        WHEN e.slug LIKE 'charities-officer-%' THEN 'Charity officer record'
        WHEN e.entity_type = 'charity' THEN 'Charity'
        WHEN e.entity_type = 'company' THEN 'Company'
        WHEN e.entity_type = 'person' THEN 'Person'
        ELSE 'Public record'
      END AS public_type,
      gr.award_type AS tender_outcome,
      gr.rfx_id,
      gs.rfx_id AS supplier_rfx_id,
      (
        SELECT COUNT(*) FROM relationships r
        WHERE r.subject_entity_id = e.id OR r.object_entity_id = e.id
      ) AS relationship_count
    FROM entity_search s
    JOIN entities e ON e.id = s.rowid
    LEFT JOIN gets_rfx_records gr ON gr.entity_id = e.id
    LEFT JOIN gets_supplier_records gs ON gs.entity_id = e.id
    WHERE entity_search MATCH ?
    ORDER BY bm25(entity_search)
    LIMIT ? OFFSET ?
  `).bind(terms, pageSize, offset).all();

  return json({ page, pageSize, total, totalPages, results: result.results });
};
