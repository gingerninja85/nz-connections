export type RelationshipDirection = 'out' | 'in' | string;

const labels: Record<string, { out: string; in: string }> = {
  OFFICER_OF: { out: 'Officer of', in: 'Officer' },
  ISSUED: { out: 'Government tender issued', in: 'Issued by' },
  AWARDED_TO: { out: 'Successful supplier', in: 'Successful supplier for' }
};

export function relationshipLabel(predicate: unknown, direction: RelationshipDirection): string {
  const key = String(predicate ?? '').toUpperCase();
  const known = labels[key];
  if (known) return direction === 'out' ? known.out : known.in;
  const fallback = String(predicate ?? 'connected to')
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());
  return direction === 'out' ? fallback : `Connected by ${fallback.toLowerCase()}`;
}

export function relationshipVerb(predicate: unknown): string {
  const key = String(predicate ?? '').toUpperCase();
  if (key === 'ISSUED') return 'issued';
  if (key === 'AWARDED_TO') return 'named as a successful supplier';
  if (key === 'OFFICER_OF') return 'recorded as an officer of';
  return 'connected to';
}

export type ProcurementExplanation = {
  agency?: unknown;
  tender?: unknown;
  supplier?: unknown;
  supplierCount?: unknown;
};

function text(value: unknown, fallback: string): string {
  const result = String(value ?? '').trim();
  return result || fallback;
}

export function successfulSupplierSentence(input: ProcurementExplanation): string {
  const agency = text(input.agency, 'The issuing government agency');
  const tender = text(input.tender, 'this government tender');
  const supplier = text(input.supplier, 'this supplier');
  const count = Number(input.supplierCount ?? 0);
  const oneOf = Number.isFinite(count) && count > 1 ? ` as one of ${count} successful suppliers` : ' as a successful supplier';
  return `${agency} named ${supplier}${oneOf} for the “${tender}” government tender.`;
}

export function issuedTenderSentence(input: Pick<ProcurementExplanation, 'agency' | 'tender' | 'supplierCount'>): string {
  const agency = text(input.agency, 'The government agency');
  const tender = text(input.tender, 'this tender');
  const count = Number(input.supplierCount ?? 0);
  const suppliers = Number.isFinite(count) && count > 0 ? ` The published award information names ${count} successful supplier${count === 1 ? '' : 's'}.` : '';
  return `${agency} issued the “${tender}” government tender.${suppliers}`;
}
