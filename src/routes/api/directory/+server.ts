import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

function readPositiveInt(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const GET: RequestHandler = async ({ url, platform }) => {
  if (!platform?.env?.DB) return json({ error: 'Database binding is not configured.' }, { status: 503 });

  const kind = url.searchParams.get('kind') === 'officers' ? 'officers' : 'charities';
  const letter = (url.searchParams.get('letter') ?? 'A').toUpperCase();
  const validLetter = /^[A-Z]$/.test(letter) ? letter : 'A';
  const sortParam = url.searchParams.get('sort');
  const sort = sortParam === 'most' || sortParam === 'least' ? sortParam : 'az';
  const pageSize = Math.min(readPositiveInt(url.searchParams.get('pageSize'), DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  const requestedPage = readPositiveInt(url.searchParams.get('page'), 1);

  const where = kind === 'officers'
    ? `e.entity_type = 'person' AND e.slug LIKE 'charities-officer-%'`
    : `e.entity_type = 'charity'`;
  const firstLetterClause = `UPPER(SUBSTR(LTRIM(e.canonical_name),1,1)) = ?`;
  const orderBy = sort === 'most'
    ? 'relationship_count DESC, e.canonical_name COLLATE NOCASE ASC'
    : sort === 'least'
      ? 'relationship_count ASC, e.canonical_name COLLATE NOCASE ASC'
      : 'e.canonical_name COLLATE NOCASE ASC';

  const countResult = await platform.env.DB.prepare(`
    SELECT COUNT(*) AS total
    FROM entities e
    WHERE ${where} AND ${firstLetterClause}
  `).bind(validLetter).first<{ total: number }>();

  const total = Number(countResult?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * pageSize;

  const result = await platform.env.DB.prepare(`
    SELECT e.id,e.canonical_name,e.entity_type,e.nzbn,e.status,
      (SELECT COUNT(*) FROM relationships r WHERE r.subject_entity_id=e.id OR r.object_entity_id=e.id) AS relationship_count
    FROM entities e
    WHERE ${where} AND ${firstLetterClause}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `).bind(validLetter, pageSize, offset).all();

  return json({
    kind,
    letter: validLetter,
    sort,
    page,
    pageSize,
    total,
    totalPages,
    results: result.results
  });
};
