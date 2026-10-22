// Loading the generated data files and filtering the surveys.
// The business rules behind each field are in CLAUDE.md section 4.3.

export const TYPE_OPTIONS = [
  { value: 'SMART', label: 'SMART' },
  { value: 'Rapid SMART', label: 'Rapid SMART' },
  { value: 'MICS', label: 'MICS' },
  { value: 'DHS', label: 'DHS' },
  { value: 'IPC AMN', label: 'IPC AMN' },
  { value: 'Other', label: 'Other (MSNA, NVA…)' },
];

// display_status values (rule 4.3.3). "Not planned" is only offered in filters and the list.
export const STATUS_OPTIONS = [
  { value: 'planned', label: 'Planned' },
  { value: 'ongoing', label: 'Ongoing' },
  { value: 'completed', label: 'Completed (awaiting release)' },
  { value: 'released', label: 'Results released' },
  { value: 'not_planned', label: 'Not planned' },
];

// Funding (rule 4.3.7). "gap" = partially funded or unfunded.
export const FUNDING_OPTIONS = [
  { value: 'funded', label: 'Funded' },
  { value: 'gap', label: 'Funding gap' },
  { value: 'unknown', label: 'Not specified' },
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

export function fundingKey(survey) {
  if (survey.funding_gap === true) return 'gap';
  if (survey.funding === 'funded') return 'funded';
  return 'unknown';
}

/**
 * Return the surveys matching the filter state.
 * `ignore` lists filter names to skip, e.g. ['status'] so the KPI tiles can
 * show every status while a status filter is active.
 */
export function applyFilters(surveys, state, ignore = []) {
  const skip = new Set(ignore);
  const keep = (name, list, value) => skip.has(name) || list.length === 0 || list.includes(value);

  return surveys.filter((s) =>
    (skip.has('year') || state.year === 'all' || String(s.survey_year) === state.year) &&
    keep('region', state.region, s.region || '') &&
    keep('country', state.country, s.iso3 || '') &&
    keep('type', state.type, s.type_group) &&
    keep('status', state.status, s.display_status) &&
    keep('funding', state.funding, fundingKey(s))
  );
}

/** Distinct values for the Region and Country dropdowns, sorted by label. */
export function regionOptions(surveys) {
  const values = [...new Set(surveys.map((s) => s.region).filter(Boolean))].sort();
  return values.map((v) => ({ value: v, label: v }));
}

export function countryOptions(surveys) {
  const byIso = new Map();
  for (const s of surveys) if (s.iso3) byIso.set(s.iso3, s.country || s.iso3);
  return [...byIso].map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function yearOptions(surveys) {
  const years = [...new Set(surveys.map((s) => s.survey_year).filter(Boolean))].sort((a, b) => b - a);
  return years.map(String);
}
