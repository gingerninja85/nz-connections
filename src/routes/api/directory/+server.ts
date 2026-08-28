import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, platform }) => {
  if (!platform?.env?.DB) return json({ error: 'Database binding is not configured.' }, { status: 503 });
  const kind = url.searchParams.get('kind') === 'officers' ? 'officers' : 'charities';
  const letter = (url.searchParams.get('letter') ?? 'A').toUpperCase();
  const validLetter = /^[A-Z]$/.test(letter) ? letter : 'A';
  const sortParam = url.searchParams.get('sort');
  const sort = sortParam === 'most' || sortParam === 'least' ? sortParam : 'az';
  const where = kind === 'officers'
    ? `e.entity_type = 'person' AND e.slug LIKE 'charities-officer-%'`
    : `e.entity_type = 'charity'`;
  const orderBy = sort === 'most'
    ? 'relationship_count DESC, e.canonical_name COLLATE NOCASE ASC'
    : sort === 'least'
      ? 'relationship_count ASC, e.canonical_name COLLATE NOCASE ASC'
      : 'e.canonical_name COLLATE NOCASE ASC';
  const result = await platform.env.DB.prepare(`
    SELECT e.id,e.canonical_name,e.entity_type,e.nzbn,e.status,
      (SELECT COUNT(*) FROM relationships r WHERE r.subject_entity_id=e.id OR r.object_entity_id=e.id) AS relationship_count
    FROM entities e
    WHERE ${where} AND UPPER(SUBSTR(LTRIM(e.canonical_name),1,1)) = ?
    ORDER BY ${orderBy}
    LIMIT 500
  `).bind(validLetter).all();
  return json({ kind, letter: validLetter, sort, results: result.results });
};
