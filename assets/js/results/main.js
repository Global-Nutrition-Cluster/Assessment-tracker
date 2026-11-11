// Results page entry point: loads data/results.json and draws the blocks (CLAUDE.md section 11).
// Step 2 of the results-view branch: page skeleton, indicator selector, Source toggle and KPI tiles.
// The map, ranked list and country profile are added in the next steps.

import { loadResults, selectorIndicators } from './data.js';
import { readState, writeState } from './state.js';
import { createControls } from './controls.js';
import { createResultsKpis } from './kpis.js';
import { escapeHtml } from '../filters.js';

const app = { data: null, state: null, updateControls: null, updateKpis: null };

async function start() {
  try {
    app.data = await loadResults();
  } catch (error) {
    showError(error);
    return;
  }

  const indicators = selectorIndicators(app.data.indicators);
  app.state = readState(new Set(indicators.map((i) => i.key)));

  app.updateControls = createControls(document.getElementById('controls'), indicators, {
    onIndicator: (indicator) => setState({ ...app.state, indicator }),
    onSource: (source) => setState({ ...app.state, source }),
  });
  app.updateKpis = createResultsKpis(document.getElementById('kpis'));

  renderDataDate();
  writeState(app.state); // drops unknown parameters from old links
  render();
}

function setState(next) {
  app.state = next;
  writeState(next);
  render();
}

function render() {
  app.updateControls(app.state);
  app.updateKpis(app.data, app.state);
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
