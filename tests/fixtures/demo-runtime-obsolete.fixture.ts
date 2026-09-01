export type DemoEntity = {
  id: string;
  type: 'company' | 'person' | 'agency' | 'contract';
  name: string;
  subtitle: string;
  identifiers?: { label: string; value: string }[];
};

export type DemoRelationship = {
  from: string;
  to: string;
  label: string;
  source: string;
  sourceUrl: string;
  note: string;
};

// Deliberately fictional records for the UI prototype. No relationship below
// should be interpreted as a statement about a real person or organisation.
export const demoEntities: DemoEntity[] = [
  { id: 'southern-cross-digital', type: 'company', name: 'Southern Cross Digital Limited', subtitle: 'NZ company · DEMO RECORD', identifiers: [{ label: 'Company number', value: 'DEMO-1042' }, { label: 'NZBN', value: 'DEMO-9429000001042' }] },
  { id: 'maia-rangi', type: 'person', name: 'Maia Rangi', subtitle: 'Person · DEMO RECORD' },
  { id: 'harbour-infrastructure', type: 'company', name: 'Harbour Infrastructure Limited', subtitle: 'NZ company · DEMO RECORD' },
  { id: 'department-civic-services', type: 'agency', name: 'Department of Civic Services', subtitle: 'Public agency · DEMO RECORD' },
  { id: 'contract-2026-017', type: 'contract', name: 'Digital Records Platform', subtitle: 'Government contract · DEMO RECORD', identifiers: [{ label: 'Contract ID', value: 'DEMO-2026-017' }] }
];

export const demoRelationships: DemoRelationship[] = [
  { from: 'maia-rangi', to: 'southern-cross-digital', label: 'DIRECTOR OF', source: 'Companies Register — demonstration source', sourceUrl: 'https://companies-register.companiesoffice.govt.nz/', note: 'Fictional relationship used only to demonstrate source-backed graph navigation.' },
  { from: 'southern-cross-digital', to: 'harbour-infrastructure', label: 'SHAREHOLDER OF', source: 'Companies Register — demonstration source', sourceUrl: 'https://companies-register.companiesoffice.govt.nz/', note: 'Fictional relationship used only to demonstrate source-backed graph navigation.' },
  { from: 'department-civic-services', to: 'contract-2026-017', label: 'AWARDED', source: 'GETS — demonstration source', sourceUrl: 'https://www.gets.govt.nz/', note: 'Fictional procurement record used only for the prototype.' },
  { from: 'contract-2026-017', to: 'southern-cross-digital', label: 'AWARDED TO', source: 'GETS — demonstration source', sourceUrl: 'https://www.gets.govt.nz/', note: 'Fictional procurement record used only for the prototype.' }
];

export function findDemoEntities(query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return demoEntities;
  return demoEntities.filter((entity) => `${entity.name} ${entity.subtitle} ${entity.type}`.toLowerCase().includes(q));
}

export function getDemoEntity(id: string) {
  return demoEntities.find((entity) => entity.id === id);
}

export function getDemoConnections(id: string) {
  return demoRelationships.filter((relationship) => relationship.from === id || relationship.to === id).map((relationship) => ({
    ...relationship,
    direction: relationship.from === id ? 'out' : 'in',
    entity: getDemoEntity(relationship.from === id ? relationship.to : relationship.from)!
  }));
}