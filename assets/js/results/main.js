// Results page entry point: loads data/results.json and draws the blocks (CLAUDE.md section 11).
// Blocks: indicator selector + Source toggle, KPI tiles, map. The ranked list and the full
// country profile are added in the next steps of the results-view branch.

import { loadResults, selectorIndicators, indexSurveys } from './data.js';
import { countryFigures } from './figures.js';
import { createResultsMap } from './map.js';
import { readState, writeState } from './state.js';
import { createControls } from './controls.js';
import { createResultsKpis } from './kpis.js';
import { escapeHtml } from '../filters.js';

const app = { data: null, state: null, surveysById: null, indicators: null,
  updateControls: null, updateKpis: null, updateMap: null };

async function start() {
  try {
    app.data = await loadResults();
  } catch (error) {
    showError(error);
    return;
  }

  const indicators = selectorIndicators(app.data.indicators);
  app.indicators = new Map(app.data.indicators.map((i) => [i.key, i]));
  app.surveysById = indexSurveys(app.data.surveys);
  app.state = readState(new Set(indicators.map((i) => i.key)));

  app.updateControls = createControls(document.getElementById('controls'), indicators, {
    onIndicator: (indicator) => setState({ ...app.state, indicator }),
    onSource: (source) => setState({ ...app.state, source }),
  });
  app.updateKpis = createResultsKpis(document.getElementById('kpis'));

  try {
    app.updateMap = await createResultsMap(document.getElementById('map-card'), {
      onCountry: (country) => openCountry(country),
    });
  } catch (error) {
    console.error(error);
    document.getElementById('map-card').innerHTML = '<div class="notice" role="alert">The map could not be loaded.</div>';
  }

  // Back / forward or an edited link (#country=XXX) opens or closes the profile
  window.addEventListener('hashchange', () => {
    app.state = readState(new Set(indicators.map((i) => i.key)));
    render();
  });

  renderDataDate();
  writeState(app.state); // drops unknown parameters from old links
  render();
}

function setState(next) {
  app.state = next;
  writeState(next);
  render();
}

function openCountry(country) {
  setState({ ...app.state, country });
  document.getElementById('profile').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function render() {
  const { state, data } = app;
  const indicator = app.indicators.get(state.indicator);
  const figures = countryFigures(data, state.indicator, state.source, app.surveysById);

  app.updateControls(state);
  app.updateKpis(data, state);
  app.updateMap?.({ figures, indicator, source: state.source, countryNames: data.countries });
  renderProfile();
}

/** Placeholder until the country profile step: name, Copy link and Close. */
function renderProfile() {
  const root = document.getElementById('profile');
  const iso3 = app.state.country;
  if (!iso3) { root.hidden = true; return; }
  const name = app.data.countries[iso3] || iso3;
  root.hidden = false;
  root.innerHTML = `
    <div class="card-head">
      <div><span class="lbl">Country profile</span><h2>${escapeHtml(name)}</h2></div>
      <button type="button" class="btn" id="profile-close">Close</button>
    </div>
    <p class="card-note">The full profile (surveys, every area and indicator, confidence intervals) comes in a later step.</p>`;
  root.querySelector('#profile-close').addEventListener('click', () => setState({ ...app.state, country: null }));
}

function renderDataDate() {
  const updated = app.data.meta.updated_at ? new Date(app.data.meta.updated_at) : null;
  document.getElementById('data-date').textContent = updated
    ? updated.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : 'unknown';
}

function showError(error) {
  console.error(error);
  document.getElementById('controls').outerHTML = `
    <div class="notice" role="alert">
      <strong>The results could not be loaded.</strong> Please try again later.
      <br><small>${escapeHtml(error.message)}</small>
    </div>`;
}

start();
