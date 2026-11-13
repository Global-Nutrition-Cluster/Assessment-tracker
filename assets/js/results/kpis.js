// KPI tiles of the Results page (CLAUDE.md 11.4.4). Read-only: they count what the page holds.
// "Countries with results" follows the Source toggle; the SMART and DHS tiles are dimmed when
// the other source is selected.

import { matchSource } from './data.js';

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
  return function update(data, state) {
    const { surveys, values } = data;
    const smartSurveys = surveys.filter((s) => s.source === 'SMART');
    const dhsSurveys = surveys.filter((s) => s.source === 'DHS');
    const smartValues = values.filter((v) => v.source === 'SMART');

    const countriesOf = (list) => new Set(list.map((v) => v.iso3));
    const shown = countriesOf(values.filter((v) => matchSource(v, state.source)));
    const smartCountries = countriesOf(smartValues);
    const dhsCountries = countriesOf(values.filter((v) => v.source === 'DHS'));
    const both = [...smartCountries].filter((c) => dhsCountries.has(c)).length;

    const countriesSub = state.source === 'all'
      ? `${both} with both SMART and DHS`
      : `With ${state.source.toUpperCase()} results`;

    root.innerHTML = [
      tile(state.source === 'all' ? 'ALL' : state.source.toUpperCase(), 'Countries with results', shown.size, countriesSub),
      tile('SMART', 'SMART surveys', smartSurveys.length,
        `${smartCountries.size} countries · ${number(smartValues.length)} values · ${yearRange(smartSurveys)}`,
        state.source === 'dhs' ? 'is-off' : ''),
      tile('DHS', 'DHS surveys', dhsSurveys.length, `Latest standard DHS, ${yearRange(dhsSurveys)}`,
        state.source === 'smart' ? 'is-off' : ''),
      tile('MICS', 'MICS surveys', '--', '', 'is-soon'),   // MICS results not available yet
    ].join('');
  };
}
