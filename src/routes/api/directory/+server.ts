import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const DEFAULT_PROCUREMENT_PAGE_SIZE = 25;
const MAX_PROCUREMENT_PAGE_SIZE = 50;

type DirectoryKind = 'charities' | 'officers' | 'procurement';

function readPositiveInt(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function dateToIsoExpression(column: string) {
  return `
    CASE
      WHEN ${column} IS NOT NULL
        AND TRIM(${column}) <> ''
        AND instr(${column}, '/') > 1
        AND instr(substr(${column}, instr(${column}, '/') + 1), '/') > 1
        AND length(${column}) >= 8
      THEN printf('%04d-%02d-%02d',
        CAST(substr(${column}, length(${column}) - 3, 4) AS INTEGER),
        CAST(substr(substr(${column}, instr(${column}, '/') + 1), 1, instr(substr(${column}, instr(${column}, '/') + 1), '/') - 1) AS INTEGER),
        CAST(substr(${column}, 1, instr(${column}, '/') - 1) AS INTEGER)
      )
      ELSE ''
    END
  `;
}

async function readProcurementDirectory(url: URL, platform: App.Platform) {
  const pageSize = Math.min(readPositiveInt(url.searchParams.get('pageSize'), DEFAULT_PROCUREMENT_PAGE_SIZE), MAX_PROCUREMENT_PAGE_SIZE);
  const requestedPage = readPositiveInt(url.searchParams.get('page'), 1);
  const q = url.searchParams.get('q')?.trim() ?? '';
  const statusParam = url.searchParams.get('status')?.trim().toLowerCase() ?? 'all';
  const status = statusParam === 'awarded' ? 'Awarded' : statusParam === 'not awarded' || statusParam === 'not-awarded' ? 'Not Awarded' : 'All';
  const rawYear = url.searchParams.get('year')?.trim() ?? '';
  const year = /^\d{4}$/.test(rawYear) ? rawYear : '';
  const sortParam = url.searchParams.get('sort') ?? 'newest';
  const sort = sortParam === 'oldest' || sortParam === 'title' ? sortParam : 'newest';
  const dateExpr = dateToIsoExpression('COALESCE(NULLIF(r.close_date, \'\'), NULLIF(r.open_date, \'\'), NULLIF(r.report_date, \'\'))');

  const where: string[] = [];
  const bindings: unknown[] = [];

  if (q.length > 0) {
    where.push(`(r.rfx_id LIKE ? ESCAPE '\\' OR r.title LIKE ? ESCAPE '\\' OR r.posting_agency LIKE ? ESCAPE '\\')`);
    const like = `%${escapeLike(q)}%`;
    bindings.push(like, like, like);
  }

  if (status !== 'All') {
    where.push('r.award_type = ?');
    bindings.push(status);
  }

  if (year) {
    where.push(`(substr(r.close_date, length(r.close_date) - 3, 4) = ? OR substr(r.open_date, length(r.open_date) - 3, 4) = ?)`);
    bindings.push(year, year);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const orderBy = sort === 'oldest'
    ? `${dateExpr} ASC, CAST(r.rfx_id AS INTEGER) ASC`
    : sort === 'title'
      ? 'r.title COLLATE NOCASE ASC, CAST(r.rfx_id AS INTEGER) DESC'
      : `${dateExpr} DESC, CAST(r.rfx_id AS INTEGER) DESC`;

  const countResult = await platform.env.DB.prepare(`
    SELECT COUNT(*) AS total
    FROM gets_rfx_records r
    ${whereSql}
  `).bind(...bindings).first<{ total: number }>();

  const total = Number(countResult?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * pageSize;

  const result = await platform.env.DB.prepare(`
    SELECT
      r.entity_id,
      r.rfx_id,
      r.title,
      r.award_type,
      r.posting_agency,
      r.agency_entity_id,
      r.open_date,
      r.close_date,
      r.awarded_amount_raw AS reported_value_raw,
      ${dateExpr} AS sort_date,
      (SELECT COUNT(*) FROM gets_supplier_records s WHERE s.rfx_id = r.rfx_id) AS supplier_count,
      (SELECT COUNT(DISTINCT region) FROM gets_rfx_regions gr WHERE gr.rfx_id = r.rfx_id) AS region_count,
      (SELECT COUNT(DISTINCT unspsc_code) FROM gets_rfx_unspsc_categories gu WHERE gu.rfx_id = r.rfx_id) AS category_count
    FROM gets_rfx_records r
    ${whereSql}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `).bind(...bindings, pageSize, offset).all();

  return json({
    kind: 'procurement',
    q,
    status,
    year,
    sort,
    page,
    pageSize,
    total,
    totalPages,
    results: result.results
  });
}

export const GET: RequestHandler = async ({ url, platform }) => {
  if (!platform?.env?.DB) return json({ error: 'Database binding is not configured.' }, { status: 503 });

  const kindParam = url.searchParams.get('kind');
  const kind: DirectoryKind = kindParam === 'officers' ? 'officers' : kindParam === 'procurement' ? 'procurement' : 'charities';
  if (kindParam === 'procurement') return readProcurementDirectory(url, platform);

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
