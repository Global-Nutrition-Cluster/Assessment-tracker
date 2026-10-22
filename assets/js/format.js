// Small formatting helpers shared by the list, the detail panel and the CSV export.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-02-26' -> '26 Feb 2026'. Parsed by hand so the day never shifts with the time zone. */
export function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export const FUNDING_LABELS = { funded: 'Funded', partial: 'Partially funded', unfunded: 'Unfunded' };

export function fundingLabel(survey) {
  return FUNDING_LABELS[survey.funding] || '';
}

/** Validation text as entered in the tracker, e.g. "Results released (18 Nov 2025)". */
export function validationLabel(survey) {
  if (!survey.sub_stage) return '';
  return survey.release_date ? `${survey.sub_stage} (${formatDate(survey.release_date)})` : survey.sub_stage;
}

/** Short country name used in tight places. */
export function shortCountry(name) {
  return name === 'Democratic Republic of the Congo' ? 'DR Congo' : (name || '');
}
