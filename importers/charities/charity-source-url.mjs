const DIRECT_CHARITY_BASE_URL = 'https://www.register.charities.govt.nz/Charity/';
const VALID_CHARITY_REGISTRATION_RE = /^CC[0-9]+$/;

export function normalizeCharityRegistrationNumber(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

export function isValidCharityRegistrationNumber(value) {
  const normalized = normalizeCharityRegistrationNumber(value);
  return normalized !== null && VALID_CHARITY_REGISTRATION_RE.test(normalized);
}

export function buildCharityRegisterUrl(value) {
  const normalized = normalizeCharityRegistrationNumber(value);
  if (!isValidCharityRegistrationNumber(normalized)) return null;
  return `${DIRECT_CHARITY_BASE_URL}${normalized}`;
}

export { DIRECT_CHARITY_BASE_URL, VALID_CHARITY_REGISTRATION_RE };
