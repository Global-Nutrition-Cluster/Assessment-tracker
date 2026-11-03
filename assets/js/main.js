// Entry point: loads the data and draws the blocks.
// compact-layout branch: no filter bar, timeline or coverage matrix on the page (their modules stay in
// assets/js/ so they can be put back). The page shows the default view: SMART surveys of the current year;
// the KPI tiles still filter by status. No detail panel (removed by the owner, Nov 2026).

import { loadData, applyFilters } from './data.js';
import { readState, writeState } from './state.js';
import { escapeHtml } from './filters.js';
import { createKpis } from './kpis.js';
import { createList } from './list.js';
import { createMap } from './map.js';

const app = {
  surveys: [],
  meta: {},
  state: readState(),
  updateKpis: null,
  updateList: null,
  updateMap: null,
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


  app.updateKpis = createKpis(document.getElementById('kpis'),
    (status) => setState({ ...app.state, status }));

  app.updateList = createList(document.getElementById('list-card'));

  try {
    app.updateMap = await createMap(document.getElementById('map-card'), {
      onMode: (map) => setState({ ...app.state, map }),
    });
  } catch (error) {
    console.error(error);
    document.getElementById('map-card').innerHTML = '<div class="notice" role="alert">The map could not be loaded.</div>';
  }

  renderDataDate();
  writeState(app.state); // drops parameters that no longer exist (e.g. country, type) from old shared links
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

  app.updateKpis(applyFilters(surveys, state, ['status']), state.status);
  app.updateList(filtered);
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
