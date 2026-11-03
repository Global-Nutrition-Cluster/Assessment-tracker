// Entry point: loads the data, builds the filter bar and redraws every block when filters change.
// Each block lives in its own module: kpis, map, timeline, matrix, list, panel.

import {
  loadData, applyFilters, yearOptions, regionOptions,
  STATUS_OPTIONS, FUNDING_OPTIONS,
} from './data.js';
import { readState, writeState } from './state.js';
import { createFilterBar, escapeHtml } from './filters.js';
import { createKpis } from './kpis.js';
import { createList } from './list.js';
import { createPanel } from './panel.js';
import { createMap } from './map.js';
import { createTimeline } from './timeline.js';
import { createMatrix } from './matrix.js';

const app = {
  surveys: [],
  meta: {},
  state: readState(),
  updateFilters: null,
  updateKpis: null,
  updateList: null,
  updateMap: null,
  updateTimeline: null,
  updateMatrix: null,
  panel: null,
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
    status: STATUS_OPTIONS,
    funding: FUNDING_OPTIONS,
  }, setState);

  app.updateKpis = createKpis(document.getElementById('kpis'),
    (status) => setState({ ...app.state, status }));

  app.panel = createPanel(document.getElementById('panel'),
    (survey) => { app.state = { ...app.state, survey: survey || '' }; writeState(app.state); });
  app.updateTimeline = createTimeline(document.getElementById('timeline-card'),
    (survey, opener) => app.panel.open(survey, opener));
  app.updateMatrix = createMatrix(document.getElementById('matrix-card'),
    (survey, opener) => app.panel.open(survey, opener));
  app.updateList = createList(document.getElementById('list-card'),
    (survey, opener) => app.panel.open(survey, opener));

  try {
    app.updateMap = await createMap(document.getElementById('map-card'), {
      // Clicking a country opens its SMART surveys in the detail panel (no filtering)
      onCountry: (surveys) => app.panel.openCountry(surveys),
      onOpen: (survey) => app.panel.open(survey),
      onMode: (map) => setState({ ...app.state, map }),
    });
  } catch (error) {
    console.error(error);
    document.getElementById('map-card').innerHTML = '<div class="notice" role="alert">The map could not be loaded.</div>';
  }

  renderDataDate();
  writeState(app.state); // drops parameters that no longer exist (e.g. country, type) from old shared links
  render();

  // A shared link can point at one survey: open its panel
  const linked = app.surveys.find((s) => s.id === app.state.survey);
  if (linked) app.panel.open(linked);
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
  app.updateList(filtered);
  app.updateTimeline(filtered);
  // The matrix shows the latest survey of each type (SMART, Rapid SMART, MICS, DHS), so only Region restricts it
  app.updateMatrix(applyFilters(surveys, state, ['year', 'type', 'status', 'funding']), state);
  app.updateMap?.({
    mode: state.map,
    surveys: filtered,
    freshSurveys: freshnessSurveys(surveys, state),
  });
}

/**
 * Surveys used by the "Data freshness" map (rule 4.3.10): every assessment type, latest release ever,
 * so only the Region filter applies (Period, Status and Funding are ignored).
 */
function freshnessSurveys(surveys, state) {
  return applyFilters(surveys, state, ['year', 'status', 'funding', 'type']);
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
