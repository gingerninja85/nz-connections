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
