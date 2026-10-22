// Entry point: loads the data, builds the filter bar and redraws every block when filters change.
// Timeline and matrix get their own modules in the next steps.

import {
  loadData, applyFilters, matchType, yearOptions, regionOptions, countryOptions,
  TYPE_OPTIONS, STATUS_OPTIONS, FUNDING_OPTIONS,
} from './data.js';
import { readState, writeState } from './state.js';
import { createFilterBar, escapeHtml } from './filters.js';
import { createKpis } from './kpis.js';
import { createList } from './list.js';
import { createPanel } from './panel.js';
import { createMap } from './map.js';

const app = {
  surveys: [],
  meta: {},
  state: readState(),
  updateFilters: null,
  updateKpis: null,
  updateList: null,
  updateMap: null,
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
    country: countryOptions(app.surveys),
    type: TYPE_OPTIONS,
    status: STATUS_OPTIONS,
    funding: FUNDING_OPTIONS,
  }, setState);

  app.updateKpis = createKpis(document.getElementById('kpis'),
    (status) => setState({ ...app.state, status }));

  app.panel = createPanel(document.getElementById('panel'),
    (survey) => { app.state = { ...app.state, survey: survey || '' }; writeState(app.state); });
  app.updateList = createList(document.getElementById('list-card'),
    (survey, opener) => app.panel.open(survey, opener));

  try {
    app.updateMap = await createMap(document.getElementById('map-card'), {
      // Clicking a country filters the page to it; clicking it again clears the filter
      onCountry: (iso3) => setState({ ...app.state, country: app.state.country === iso3 ? 'all' : iso3 }),
      onOpen: (survey) => app.panel.open(survey),
      onMode: (map) => setState({ ...app.state, map }),
    });
  } catch (error) {
    console.error(error);
    document.getElementById('map-card').innerHTML = '<div class="notice" role="alert">The map could not be loaded.</div>';
  }

  renderDataDate();
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
  app.updateMap?.({
    mode: state.map,
    // The map ignores the Country filter so other countries stay clickable; the selected one is outlined
    surveys: applyFilters(surveys, state, ['country']),
    freshSurveys: freshnessSurveys(surveys, state),
    country: state.country,
    markerCountries: smartCountries(surveys),
  });
}

/** Countries with at least one SMART or Rapid SMART survey on record (cluster countries). */
function smartCountries(surveys) {
  return new Set(surveys.filter((s) => matchType(s, 'smart')).map((s) => s.iso3));
}

/**
 * Surveys used by the "Data freshness" map (rule 4.3.10). Freshness looks at the latest release
 * ever, so Period, Status and Funding are ignored. Assessment type is applied only when one
 * type is chosen; with the default (SMART + Rapid SMART) or "All types", every type counts.
 */
function freshnessSurveys(surveys, state) {
  const base = applyFilters(surveys, state, ['year', 'status', 'funding', 'type', 'country']);
  if (state.type === 'smart' || state.type === 'all') return base;
  return base.filter((s) => matchType(s, state.type));
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
