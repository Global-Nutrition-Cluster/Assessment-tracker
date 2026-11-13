// Results page entry point: loads data/results.json and draws the blocks (CLAUDE.md section 11).
// Blocks: indicator selector + Source toggle, KPI tiles, map and ranked list (same figures, figures.js).
// The country profile opens under them (profile.js).

import { loadResults, selectorIndicators, indexSurveys } from './data.js';
import { countryFigures } from './figures.js';
import { createResultsMap } from './map.js';
import { createRankedList } from './ranked.js';
import { createProfile } from './profile.js';
import { readState, writeState } from './state.js';
import { createControls } from './controls.js';
import { createResultsKpis } from './kpis.js';
import { escapeHtml } from '../format.js';

const app = { data: null, state: null, surveysById: null, indicators: null,
  updateControls: null, updateKpis: null, updateMap: null, updateRanked: null, updateProfile: null };

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

  app.updateRanked = createRankedList(document.getElementById('rank-card'), {
    onCountry: (country) => openCountry(country),
  });

  app.updateProfile = createProfile(document.getElementById('profile'), {
    onClose: () => setState({ ...app.state, country: null }),
  });

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
  app.updateKpis(data);   // fixed totals: same tiles whatever the indicator and the source
  app.updateMap?.({ figures, indicator, source: state.source, countryNames: data.countries });
  app.updateRanked({ figures, indicator, countryNames: data.countries });
  app.updateProfile(state.country, data, app.indicators);
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
