// Results page: loading data/results.json and small helpers shared by the blocks.
// The data rules are in CLAUDE.md section 11.3 and scripts/build_results.py.

export const SOURCES = [
  { value: 'all', label: 'All' },
  { value: 'smart', label: 'SMART' },
  { value: 'dhs', label: 'DHS' },
];

export async function loadResults() {
  const [results, meta] = await Promise.all([
    fetchJson('data/results.json'),
    fetchJson('data/results_meta.json').catch(() => ({})), // the page still works without meta
  ]);
  return { ...results, meta };
}

async function fetchJson(path) {
  const response = await fetch(path, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

/** Indicators shown in the selector, in the order of build_results.py (INDICATORS). */
export function selectorIndicators(indicators) {
  return indicators.filter((i) => i.selector);
}

/** 'SMART', 'DHS' or both, for one indicator. */
export function indicatorSources(indicator) {
  return [indicator.smart_code && 'SMART', indicator.dhs_id && 'DHS'].filter(Boolean);
}

/** Source toggle: 'smart' keeps SMART and Rapid SMART values, 'dhs' keeps DHS values. */
export function matchSource(record, source) {
  if (source === 'all') return true;
  return record.source === source.toUpperCase();
}

/** Survey id -> survey, for quick look-ups. */
export function indexSurveys(surveys) {
  return new Map(surveys.map((s) => [s.id, s]));
}
