// Entry point: loads the data and draws the blocks.
// No filter bar, timeline or coverage matrix on the page (their modules stay in assets/js/ so they can be put
// back). The page shows SMART surveys of the current year. Two selections remain (Nov 2026): the KPI tiles
// filter by status, and a click on a map country filters the KPI tiles and the survey list to that country.

import { loadData, applyFilters } from './data.js';
import { readState, writeState } from './state.js';
import { escapeHtml } from './filters.js';
import { createKpis } from './kpis.js';
import { createList } from './list.js';
import { createMap } from './map.js';
import { formatDate } from './format.js';

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

  app.updateList = createList(document.getElementById('list-card'), {
    onClearCountry: () => setState({ ...app.state, country: 'all' }),
  });

  try {
    app.updateMap = await createMap(document.getElementById('map-card'), {
      onCountry: (country) => setState({ ...app.state, country }),
    });
  } catch (error) {
    console.error(error);
    document.getElementById('map-card').innerHTML = '<div class="notice" role="alert">The map could not be loaded.</div>';
  }

  renderDataDate();
  writeState(app.state); // drops parameters that no longer exist (e.g. map, type) from old shared links
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
  const countryName = surveys.find((s) => s.iso3 === state.country)?.country || state.country;
  app.updateList(filtered, state.country, countryName);
  app.updateMap?.({
    surveys: applyFilters(surveys, state, ['country']),            // colours: KPI status applies
    allSurveys: applyFilters(surveys, state, ['country', 'status']), // hover summary: every status
    country: state.country,
  });
}

// "Data as of": the date set in the Settings tab of the planning sheet (meta.data_as_of, Nov 2026),
// else the date of the last data update
function renderDataDate() {
  const { data_as_of: asOf, updated_at: updated } = app.meta;
  document.getElementById('data-date').textContent = asOf ? formatDate(asOf)
    : updated ? new Date(updated).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
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
