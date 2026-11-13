// Map "SMART assessments": Leaflet (vendored, global `L`) + Natural Earth countries, no tile service.
// One colour only (owner's decision, Nov 2026): a country with at least one SMART survey in the current
// selection is GNC green, the others light grey. The status colours stay in the KPI tiles and the list,
// so the map is never read as a status map. No numbers or markers on the map.
//   - Hover: the country is outlined and a box next to the cursor counts its surveys by status.
//   - Click: the survey list is filtered to that country (click it again, or the sea, to clear).
//     On touch screens a tap does both: it shows the box and filters the list.

import { shortCountry, escapeHtml } from './format.js';
import { statusLabel, countByStatus, SUMMARY_ORDER, SHORT_LABELS } from './status-label.js';

const AFRICA_VIEW = [[-35, -19], [38, 56]]; // Africa and Yemen, as in the mockup

const CAPTION = 'Countries with at least one SMART survey this year. Hover a country for its surveys by status; click it to show only its surveys in the list.';

const UN_DISCLAIMER = 'The boundaries and names shown and the designations used on this map do not imply official endorsement or acceptance by the United Nations.';

/**
 * @param {HTMLElement} root
 * @param {object} handlers  { onCountry(iso3 | 'all') }
 * @returns {Promise<(view) => void>}  update function, see `update` below
 */
export async function createMap(root, { onCountry }) {
  root.innerHTML = `
    <div class="card-head">
      <h2>SMART assessments</h2>
    </div>
    <p class="card-note map-caption">${CAPTION}</p>
    <div class="map-box">
      <div class="map" role="region" aria-label="Map of countries with SMART assessments. Click a country to filter the survey list; the list gives the same information."></div>
      <div class="map-info map-tip" aria-hidden="true" hidden></div>
    </div>
    <div class="map-legend"></div>
    <p class="map-disclaimer">${UN_DISCLAIMER}</p>`;

  const css = getComputedStyle(document.documentElement);
  const color = (token) => css.getPropertyValue(token).trim();
  const COLORS = {
    survey: color('--gnc-green'),
    noRecord: '#E3E6E1',
    border: '#FFFFFF',
    hover: color('--text'),
    selected: color('--gnc-slate'),
  };

  const info = root.querySelector('.map-info');
  const geo = await fetch('geo/countries.geojson', { cache: 'force-cache' }).then((r) => r.json());

  const map = L.map(root.querySelector('.map'), {
    zoomSnap: 0.25,
    minZoom: 1.5,
    maxZoom: 7,
    scrollWheelZoom: false,       // the page scrolls normally; zoom with the +/– buttons or double click
    attributionControl: true,
  });
  map.attributionControl.setPrefix(false).addAttribution('Boundaries: Natural Earth');
  map.fitBounds(AFRICA_VIEW);

  let view = null; // last data passed to update()

  const countries = L.geoJSON(geo, {
    style: () => ({ weight: 0.8, color: COLORS.border, fillColor: COLORS.noRecord, fillOpacity: 1 }),
    onEachFeature: (feature, layer) => {
      const iso3 = feature.properties.iso3;
      layer.on('add', () => layer.getElement()?.setAttribute('data-iso3', iso3));   // handy for tests
      layer.on('mouseover', (event) => {
        if (view?.shown.has(iso3)) layer.setStyle({ weight: 2, color: COLORS.hover });
        showInfo(feature.properties, event.containerPoint);
      });
      layer.on('mousemove', (event) => placeInfo(event.containerPoint));
      layer.on('mouseout', () => {
        layer.setStyle(outline(iso3));
        info.hidden = true;
      });
      layer.on('click', (event) => {
        L.DomEvent.stopPropagation(event);   // keep the map's own click (below) from clearing the filter
        showInfo(feature.properties, event.containerPoint);   // touch screens: the box at the tapped point
        // A second click on the selected country, or a click on a country without survey, clears the filter
        const pick = view?.shown.has(iso3) && view.country !== iso3 ? iso3 : 'all';
        onCountry(pick);
      });
    },
  }).addTo(map);
  const geoName = new Map(geo.features.map((f) => [f.properties.iso3, f.properties.name]));

  // A click on the sea (or anywhere off a country) clears the country filter and hides the box
  map.on('click', () => {
    info.hidden = true;
    if (view?.country !== 'all') onCountry('all');
  });

  const GAP = 12; // px between the cursor and the box

  function showInfo(props, point) {
    info.innerHTML = tooltipHtml(props);
    info.hidden = false;
    placeInfo(point);
  }

  /** Put the box at the bottom right of the cursor, flipping left / up when it would leave the map. */
  function placeInfo(point) {
    if (info.hidden) return;
    const size = map.getSize();
    const w = info.offsetWidth;
    const h = info.offsetHeight;
    let x = point.x + GAP;
    let y = point.y + GAP;
    if (x + w > size.x - 4) x = point.x - GAP - w;   // too close to the right edge: go left
    if (y + h > size.y - 4) y = point.y - GAP - h;   // too close to the bottom: go up
    info.style.left = `${Math.max(4, x)}px`;
    info.style.top = `${Math.max(4, y)}px`;
  }

  // The selected country keeps a dark outline
  function outline(iso3) {
    return iso3 === view?.country
      ? { weight: 2.5, color: COLORS.selected }
      : { weight: 0.8, color: COLORS.border };
  }

  // --- drawing ------------------------------------------------------------------

  /**
   * @param {object} v
   * @param {object[]} v.surveys     SMART surveys of the current selection (KPI status applied): they colour the map
   * @param {object[]} v.allSurveys  SMART surveys of the year, every status: they fill the hover summary
   * @param {string}   v.country     ISO3 chosen by a click, or 'all'
   */
  return function update(v) {
    // A country is green when it has at least one survey in the selection ("Not planned" ones do not count)
    const shown = new Set(v.surveys.filter((s) => s.iso3 && s.display_status !== 'not_planned').map((s) => s.iso3));
    view = { shown, all: groupByCountry(v.allSurveys), country: v.country };

    root.querySelector('.map-legend').innerHTML = `
      <ul class="legend" aria-label="Map legend">
        <li><span class="swatch" style="background:${COLORS.survey}"></span>SMART survey(s) this year</li>
        <li><span class="swatch swatch-none"></span>No survey</li>
      </ul>`;

    countries.setStyle((feature) => {
      const iso3 = feature.properties.iso3;
      return { ...outline(iso3), fillOpacity: 1, fillColor: shown.has(iso3) ? COLORS.survey : COLORS.noRecord };
    });
    // Keep the selected outline on top of its neighbours' white borders
    countries.eachLayer((layer) => { if (layer.feature.properties.iso3 === v.country) layer.bringToFront(); });
  };

  // Hover: the country's surveys counted by status, e.g. "Planned 2 · Ongoing 1"
  function tooltipHtml(props) {
    const iso3 = props.iso3;
    const surveys = view?.all.get(iso3) || [];
    const name = escapeHtml(shortCountry(surveys[0]?.country || geoName.get(iso3) || iso3));
    if (!surveys.length) {
      return `<strong>${name}</strong><br><span class="mute">No SMART survey this year</span>`;
    }
    const counts = countByStatus(surveys);
    const lines = SUMMARY_ORDER.filter((key) => counts[key])
      .map((key) => `<span class="tip-row">${statusLabel(key, SHORT_LABELS[key])}<strong>${counts[key]}</strong></span>`).join('');
    const hint = view.country === iso3 ? 'Click again to show every country' : 'Click to show its surveys in the list';
    return `<strong>${name}</strong> <span class="mute">· ${surveys.length} SMART survey${surveys.length === 1 ? '' : 's'}</span>
      <span class="tip-list">${lines}</span><span class="tip-hint">${hint}</span>`;
  }
}

// --- pure helpers (no Leaflet) ----------------------------------------------------

function groupByCountry(surveys) {
  const byCountry = new Map();
  for (const s of surveys) {
    if (!s.iso3) continue;
    if (!byCountry.has(s.iso3)) byCountry.set(s.iso3, []);
    byCountry.get(s.iso3).push(s);
  }
  return byCountry;
}
