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
  if (!q || q.length < 2) {
    return json({ results: [], page: 1, pageSize: DEFAULT_PAGE_SIZE, total: 0, totalPages: 1 });
  }
  if (!platform?.env?.DB) return json({ error: 'Database binding is not configured.' }, { status: 503 });

  const pageSize = Math.min(readPositiveInt(url.searchParams.get('pageSize'), DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  const requestedPage = readPositiveInt(url.searchParams.get('page'), 1);
  const terms = q.split(/\s+/).filter(Boolean).map((term) => `"${term.replaceAll('"', '""')}"*`).join(' ');

  const countResult = await platform.env.DB.prepare(`
    SELECT COUNT(*) AS total
    FROM entity_search
    WHERE entity_search MATCH ?
  `).bind(terms).first<{ total: number }>();

  const total = Number(countResult?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * pageSize;

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
    LIMIT ? OFFSET ?
  `).bind(terms, pageSize, offset).all();

  return json({ page, pageSize, total, totalPages, results: result.results });
};
