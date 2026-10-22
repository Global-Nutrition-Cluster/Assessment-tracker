// Loading the generated data files and filtering the surveys.
// The business rules behind each field are in CLAUDE.md section 4.3.

// Options of the filter bar (labels as in the mockup)
export const TYPE_OPTIONS = [
  { value: 'smart', label: 'SMART + Rapid SMART' },
  { value: 'all', label: 'All types' },
  { value: 'SMART', label: 'SMART' },
  { value: 'Rapid SMART', label: 'Rapid SMART' },
  { value: 'MICS', label: 'MICS' },
  { value: 'DHS', label: 'DHS' },
  { value: 'IPC AMN', label: 'IPC AMN' },
  { value: 'Other', label: 'Other (MSNA, NVA…)' },
];

// "Completed" = every completed survey, released or not (as in the mockup);
// "Results released" narrows it to those with released results.
export const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'planned', label: 'Planned' },
  { value: 'ongoing', label: 'Ongoing' },
  { value: 'completed', label: 'Completed' },
  { value: 'released', label: 'Results released' },
  { value: 'not_planned', label: 'Not planned' },
];

export const FUNDING_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'funded', label: 'Funded' },
  { value: 'gap', label: 'Funding gap (partial + unfunded)' },
  { value: 'partial', label: 'Partially funded' },
  { value: 'unfunded', label: 'Unfunded' },
];

export async function loadData() {
  const [surveys, meta] = await Promise.all([
    fetchJson('data/surveys.json'),
    fetchJson('data/meta.json').catch(() => ({})), // the page still works without meta
  ]);
  return { surveys, meta };
}

async function fetchJson(path) {
  const response = await fetch(path, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

// --- single-filter tests -----------------------------------------------------

export function matchType(survey, type) {
  if (type === 'all') return true;
  if (type === 'smart') return survey.type_group === 'SMART' || survey.type_group === 'Rapid SMART';
  return survey.type_group === type;
}

export function matchStatus(survey, status) {
  if (status === 'all') return true;
  if (status === 'completed') return survey.display_status === 'completed' || survey.display_status === 'released';
  return survey.display_status === status;
}

export function matchFunding(survey, funding) {
  if (funding === 'all') return true;
  if (funding === 'gap') return survey.funding_gap === true; // rule 4.3.7
  return survey.funding === funding;
}

/**
 * Return the surveys matching the filter state.
 * `ignore` lists filter names to skip, e.g. ['status'] so the KPI tiles
 * keep showing every status while a status filter is active.
 */
export function applyFilters(surveys, state, ignore = []) {
  const skip = new Set(ignore);
  return surveys.filter((s) =>
    (skip.has('year') || state.year === 'all' || String(s.survey_year) === state.year) &&
    (skip.has('region') || state.region === 'all' || s.region === state.region) &&
    (skip.has('country') || state.country === 'all' || s.iso3 === state.country) &&
    (skip.has('type') || matchType(s, state.type)) &&
    (skip.has('status') || matchStatus(s, state.status)) &&
    (skip.has('funding') || matchFunding(s, state.funding))
  );
}

// --- options built from the data ---------------------------------------------

export function yearOptions(surveys) {
  const years = [...new Set(surveys.map((s) => s.survey_year).filter(Boolean))].sort((a, b) => b - a);
  return [
    ...years.map((y) => ({ value: String(y), label: `Calendar year ${y}` })),
    { value: 'all', label: 'All years' },
  ];
}

export function regionOptions(surveys) {
  const values = [...new Set(surveys.map((s) => s.region).filter(Boolean))].sort();
  return [{ value: 'all', label: 'All regions' }, ...values.map((v) => ({ value: v, label: v }))];
}

export function countryOptions(surveys) {
  const byIso = new Map();
  for (const s of surveys) {
    if (!s.iso3) continue;
    const known = byIso.get(s.iso3);
    byIso.set(s.iso3, { label: s.country || s.iso3, region: known?.region || s.region || '' });
  }
  const list = [...byIso].map(([value, o]) => ({ value, label: o.label, region: o.region }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [{ value: 'all', label: 'All countries' }, ...list];
}
