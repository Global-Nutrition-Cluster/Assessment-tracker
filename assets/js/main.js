// Entry point: loads the data, builds the filter bar and redraws every block when filters change.
// Each block (KPIs, map, timeline, matrix, list) gets its own module in the next steps.

import {
  loadData, applyFilters, regionOptions, countryOptions, yearOptions,
  TYPE_OPTIONS, STATUS_OPTIONS, FUNDING_OPTIONS,
} from './data.js';
import { readState, writeState } from './state.js';
import { createFilterBar, escapeHtml } from './filters.js';

const app = {
  surveys: [],
  meta: {},
  state: readState(),
  updateFilters: null,
};

async function start() {
  try {
    const { surveys, meta } = await loadData();
    app.surveys = surveys;
    app.meta = meta;
  } catch (error) {
    showError(error);
    return;
  }

  app.updateFilters = createFilterBar(document.getElementById('filters'), {
    years: yearOptions(app.surveys),
    region: regionOptions(app.surveys),
    country: countryOptions(app.surveys),
    type: TYPE_OPTIONS,
    status: STATUS_OPTIONS,
    funding: FUNDING_OPTIONS,
  }, setState);

  renderFooter();
  render();
}

function setState(next) {
  app.state = next;
  writeState(next);
  render();
}

function render() {
  const filtered = applyFilters(app.surveys, app.state);
  app.updateFilters(app.state);

  const n = filtered.length;
  document.getElementById('result-line').innerHTML =
    `<strong>${n}</strong> ${n === 1 ? 'assessment matches' : 'assessments match'} the current filters.`;

  // Temporary preview of the counts until the KPI tiles arrive (step 3)
  const counts = Object.fromEntries(STATUS_OPTIONS.map((o) => [o.value, 0]));
  filtered.forEach((s) => { if (s.display_status in counts) counts[s.display_status] += 1; });
  document.querySelectorAll('[data-kpi]').forEach((tile) => {
    tile.querySelector('.kpi-value').textContent = counts[tile.dataset.kpi];
  });
}

function renderFooter() {
  const updated = app.meta.updated_at ? new Date(app.meta.updated_at) : null;
  document.getElementById('data-updated').textContent = updated
    ? `Data updated ${updated.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`
    : 'Data update date unavailable';
}

function showError(error) {
  console.error(error);
  document.getElementById('result-line').outerHTML = `
    <div class="notice" role="alert">
      <strong>The data could not be loaded.</strong> Please try again later.
      <br><small>${escapeHtml(error.message)}</small>
    </div>`;
}

start();
