// Results page entry point: loads data/results.json and draws the blocks (CLAUDE.md section 11).
// Blocks: HNRP switch, KPI tiles, indicator selector + Source toggle, map and "Latest results by country"
// (same figures, figures.js). The country profile opens under them (profile.js).

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
  setUpHnrpSwitch();

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
  const hnrp = state.hnrp ? hnrpCountries() : null;   // ISO3 -> name, or null when the switch is off
  const shown = hnrp ? onlyCountries(data, hnrp) : data;
  const figures = countryFigures(shown, state.indicator, state.source, app.surveysById);
  const countryNames = hnrp ? { ...Object.fromEntries(hnrp), ...data.countries } : data.countries;
  if (hnrp) {
    // An HNRP country with no survey at all still gets a row ("No data for this indicator"): it shows the gaps
    for (const iso3 of hnrp.keys()) {
      if (!figures.has(iso3)) figures.set(iso3, { main: null, others: [], subnational: null, noData: true, noSurvey: true });
    }
  }

  updateHnrpSwitch(state.hnrp);
  app.updateControls(state);
  app.updateKpis(shown);   // totals of the countries shown: all, or the HNRP countries; not the indicator or the source
  app.updateMap?.({ figures, indicator, source: state.source, countryNames, hnrp: hnrp && new Set(hnrp.keys()) });
  app.updateRanked({ figures, indicator, countryNames });
  app.updateProfile(state.country, data, app.indicators);
}

// --- HNRP switch -------------------------------------------------------------------------------
// The list comes from the HNRP sheet (results.json "hnrp": { year: { ISO3: name } }). The page picks the
// current calendar year itself, so it switches to the new year on 1 January (owner's decision, Nov 2026).

const CURRENT_YEAR = String(new Date().getFullYear());

function hnrpCountries() {
  return new Map(Object.entries(app.data.hnrp?.[CURRENT_YEAR] || {}));
}

function onlyCountries(data, countries) {
  return {
    ...data,
    surveys: data.surveys.filter((s) => countries.has(s.iso3)),
    values: data.values.filter((v) => countries.has(v.iso3)),
  };
}

function setUpHnrpSwitch() {
  const button = document.getElementById('hnrp-switch');
  const count = hnrpCountries().size;
  button.disabled = count === 0;
  button.title = count
    ? `Show only the ${count} countries of the ${CURRENT_YEAR} Humanitarian Needs and Response Plans (HNRP)`
    : `No HNRP country list for ${CURRENT_YEAR} yet`;
  if (!count && app.state.hnrp) app.state = { ...app.state, hnrp: false };
  button.addEventListener('click', () => setState({ ...app.state, hnrp: !app.state.hnrp }));
}

function updateHnrpSwitch(on) {
  document.getElementById('hnrp-switch').setAttribute('aria-checked', String(on));
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
