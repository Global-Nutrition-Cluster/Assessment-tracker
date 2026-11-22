// KPI tiles of the Results page (CLAUDE.md 11.4.4). Read-only totals of what the page holds.
// They follow neither the indicator nor the Source toggle (owner's decision, 13 Nov 2026: the tiles sit
// above the indicator bar, which drives only the map and the list).

const number = (n) => n.toLocaleString('en-GB');

function yearRange(surveys) {
  const years = surveys.map((s) => s.survey_year).filter(Boolean);
  if (!years.length) return '';
  const min = Math.min(...years);
  const max = Math.max(...years);
  return min === max ? String(min) : `${min}–${max}`;
}

function tile(tag, label, value, sub, extraClass = '') {
  return `
    <div class="kpi res-kpi ${extraClass}">
      <span class="kpi-label"><span class="src src-${tag.toLowerCase()}">${tag}</span>${label}</span>
      <span class="kpi-value">${value}</span>
      <span class="kpi-sub">${sub}</span>
    </div>`;
}

/** @param {HTMLElement} root */
export function createResultsKpis(root) {
  return function update(data) {
    // Counted from the surveys: each carries its number of values (value_count, build_results.py),
    // so the tiles need no value file
    const surveys = data.surveys.filter((s) => (s.value_count ?? 0) > 0);
    const smartSurveys = surveys.filter((s) => s.source === 'SMART');
    const dhsSurveys = surveys.filter((s) => s.source === 'DHS');
    const smartValues = smartSurveys.reduce((total, s) => total + s.value_count, 0);

    const countriesOf = (list) => new Set(list.map((s) => s.iso3));
    const all = countriesOf(surveys);
    const smartCountries = countriesOf(smartSurveys);
    const dhsCountries = countriesOf(dhsSurveys);
    const both = [...smartCountries].filter((c) => dhsCountries.has(c)).length;

    root.innerHTML = [
      tile('ALL', 'Countries with results', all.size, `${both} with both SMART and DHS`),
      tile('SMART', 'SMART surveys', smartSurveys.length,
        `${smartCountries.size} countries · ${number(smartValues)} values · ${yearRange(smartSurveys)}`),
      tile('DHS', 'DHS surveys', dhsSurveys.length, `Latest standard DHS, ${yearRange(dhsSurveys)}`),
      tile('MICS', 'MICS surveys', '--', '', 'is-soon'),   // MICS results not available yet
    ].join('');
  };
}
