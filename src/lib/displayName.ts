// Presentation-only cleanup for source-system names. Never use this value as evidence or identity.
export function humanDisplayName(value: unknown): string {
  const original = String(value ?? '').trim();
  if (!original) return 'Record';

  let s = original
    .replace(/^Supplier record\s*[—-]\s*/i, '')
    .replace(/^Procurement record RFx\s+[^—-]+\s*[—-]\s*/i, '')
    .replace(/\s+[—-]\s+RFx\s+\d+.*$/i, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // GETS titles often begin with an agency/project reference such as:
  // 766-24-234-GS - Title
  // 746-23-616-PS Title
  // TTEPS 746-22-228-TTG Title
  // Remove only code-shaped leading tokens that contain multiple numeric groups.
  const separated = s.match(/^((?:[A-Z][A-Z0-9&]*\s+)?\d{2,4}(?:-\d{2,4}){2,}(?:-[A-Z][A-Z0-9]*)?)\s+-\s+(.+)$/i);
  if (separated) s = separated[2].trim();
  else {
    const attached = s.match(/^(?:[A-Z][A-Z0-9&]*\s+)?\d{2,4}(?:-\d{2,4}){2,}(?:-[A-Z][A-Z0-9]*)?\s+(.+)$/i);
    if (attached) s = attached[1].trim();
  }

  return s || original;
}

export function publishedNameDiffers(value: unknown): boolean {
  const original = String(value ?? '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return Boolean(original && humanDisplayName(value) !== original);
}
