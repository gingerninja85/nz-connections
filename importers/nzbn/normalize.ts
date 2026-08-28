export type NzbnInput = Record<string, unknown>;

export type NormalizedBusiness = {
  nzbn: string;
  canonicalName: string;
  entityType: 'company' | 'public_agency' | 'other';
  status: string | null;
  sourceRecordId: string;
  raw: NzbnInput;
};

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function first(record: NzbnInput, keys: string[]): string | null {
  for (const key of keys) {
    const value = text(record[key]);
    if (value) return value;
  }
  return null;
}

export function normalizeNzbnRecord(record: NzbnInput): NormalizedBusiness {
  // NZBN exports have evolved over time. Keep aliases isolated here so the
  // canonical writer does not depend directly on one snapshot's column names.
  const nzbn = first(record, ['nzbn', 'NZBN', 'nzbnNumber']);
  const canonicalName = first(record, ['entityName', 'legalName', 'name', 'EntityName']);
  const entityTypeRaw = first(record, ['entityType', 'businessType', 'EntityType'])?.toLowerCase() ?? '';
  const status = first(record, ['entityStatus', 'status', 'EntityStatus']);

  if (!nzbn) throw new Error('NZBN record is missing an NZBN');
  if (!/^94\d{11}$/.test(nzbn)) throw new Error(`Invalid NZBN: ${nzbn}`);
  if (!canonicalName) throw new Error(`NZBN ${nzbn} is missing a canonical name`);

  const entityType = entityTypeRaw.includes('company')
    ? 'company'
    : entityTypeRaw.includes('public') || entityTypeRaw.includes('government')
      ? 'public_agency'
      : 'other';

  return {
    nzbn,
    canonicalName,
    entityType,
    status,
    sourceRecordId: nzbn,
    raw: record
  };
}
