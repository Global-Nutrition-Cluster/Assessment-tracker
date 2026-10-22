// Entry point: loads the data, builds the filter bar and redraws every block when filters change.
// Map, timeline, matrix and list get their own modules in the next steps.

import {
  loadData, applyFilters, yearOptions, regionOptions, countryOptions,
  TYPE_OPTIONS, STATUS_OPTIONS, FUNDING_OPTIONS,
} from './data.js';
import { readState, writeState } from './state.js';
import { createFilterBar, escapeHtml } from './filters.js';
import { createKpis } from './kpis.js';

const app = {
  surveys: [],
  meta: {},
  state: readState(),
  updateFilters: null,
  updateKpis: null,
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
    year: yearOptions(app.surveys),
    region: regionOptions(app.surveys),
    country: countryOptions(app.surveys),
    type: TYPE_OPTIONS,
    status: STATUS_OPTIONS,
    funding: FUNDING_OPTIONS,
  }, setState);

  app.updateKpis = createKpis(document.getElementById('kpis'),
    (status) => setState({ ...app.state, status }));

  renderDataDate();
  render();
}

function setState(next) {
  app.state = next;
  writeState(next);
  render();
}

function render() {
  const { state, surveys } = app;
  const filtered = applyFilters(surveys, state);

  app.updateFilters(state);
  app.updateKpis(applyFilters(surveys, state, ['status']), state.status);

  // Temporary until the survey list arrives (step 4)
  document.getElementById('list-count').textContent =
    `${filtered.length} ${filtered.length === 1 ? 'survey matches' : 'surveys match'} the current filters`;
}

function renderDataDate() {
  const updated = app.meta.updated_at ? new Date(app.meta.updated_at) : null;
  document.getElementById('data-date').textContent = updated
    ? updated.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : 'unknown';
}

function showError(error) {
  console.error(error);
  document.getElementById('kpis').outerHTML = `
    <div class="notice" role="alert">
      <strong>The data could not be loaded.</strong> Please try again later.
      <br><small>${escapeHtml(error.message)}</small>
    </div>`;
}

start();
