// Loading the generated data files and filtering the surveys of the Planning view.
// The business rules behind each field are in CLAUDE.md section 4.3. surveys.json holds SMART and
// Rapid SMART surveys only (rule 4.3.1), so there is no type filter here.

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

/** KPI tile selection. "Completed" = every completed survey, released or not. */
export function matchStatus(survey, status) {
  if (status === 'all') return true;
  if (status === 'completed') return survey.display_status === 'completed' || survey.display_status === 'released';
  return survey.display_status === status;
}

/**
 * Surveys of the current year matching the page state (KPI status, country chosen on the map).
 * `ignore` lists the selections to skip, e.g. ['status'] so the KPI tiles keep showing every status
 * while a status is selected.
 */
export function applyFilters(surveys, state, ignore = []) {
  const skip = new Set(ignore);
  return surveys.filter((s) =>
    String(s.survey_year) === state.year &&
    (skip.has('status') || matchStatus(s, state.status)) &&
    (skip.has('country') || state.country === 'all' || s.iso3 === state.country)
  );
}
