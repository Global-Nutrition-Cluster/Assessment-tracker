// Map "Where assessments stand": Leaflet (vendored, global `L`) + Natural Earth countries, no tile service.
// Two modes, switched by a segmented toggle:
//   - Status: each country coloured by its most active survey (ongoing > planned > completed > released),
//     with count markers: filled = funded (or funding not reported), hollow = funding gap.
//   - Data freshness: each country coloured by the age of its last released results (rule 4.3.10),
//     with a marker showing the release year. Never computed from start or end dates.

import { statusIcon, STATUS_LABELS } from './icons.js';
import { shortCountry, formatDate } from './format.js';
import { escapeHtml } from './filters.js';

// "Most active" order, as in the mockup: what is happening now comes first
const ACTIVITY_RANK = { ongoing: 0, planned: 1, completed: 2, released: 3 };

export const FRESH_BUCKETS = [
  { key: 'lt1', label: '< 1 year', max: 1, token: '--fresh-1' },
  { key: '1to2', label: '1–2 years', max: 2, token: '--fresh-2' },
  { key: '2to3', label: '2–3 years', max: 3, token: '--fresh-3' },
  { key: 'gt3', label: '> 3 years', max: Infinity, token: '--fresh-4' },
];

const AFRICA_VIEW = [[-35, -19], [38, 56]]; // Africa and Yemen, as in the mockup

const CAPTIONS = {
  status: 'Countries coloured by the status of their most active survey in the current filters. Markers count surveys: filled = funded, hollow = funding gap.',
  freshness: 'Countries coloured by how long ago results of an assessment were last released (all assessment types unless one type is selected).',
};

const UN_DISCLAIMER = 'The boundaries and names shown and the designations used on this map do not imply official endorsement or acceptance by the United Nations.';

/**
 * @param {HTMLElement} root
 * @param {object} handlers  { onCountry(iso3), onOpen(survey), onMode(mode) }
 * @returns {Promise<(view) => void>}  update function, see `update` below
 */
export async function createMap(root, { onCountry, onOpen, onMode }) {
  root.innerHTML = `
    <div class="card-head">
      <h2>Where assessments stand</h2>
      <div class="segmented" role="group" aria-label="Map colouring">
        <button type="button" data-mode="status" aria-pressed="true">Status</button>
        <button type="button" data-mode="freshness" aria-pressed="false">Data freshness</button>
      </div>
    </div>
    <p class="card-note map-caption"></p>
    <div class="map-box"><div class="map" role="region" aria-label="Map of assessments by country"></div></div>
    <div class="map-legend"></div>
    <p class="map-disclaimer">${UN_DISCLAIMER}</p>`;

  root.querySelector('.segmented').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-mode]');
    if (button) onMode(button.dataset.mode);
  });

  const css = getComputedStyle(document.documentElement);
  const color = (token) => css.getPropertyValue(token).trim();
  const COLORS = {
    planned: color('--status-planned'),
    ongoing: color('--status-ongoing'),
    completed: color('--status-completed'),
    released: color('--status-released'),
    noRecord: '#E3E6E1',
    border: '#FFFFFF',
    selected: color('--text'),
  };

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
      layer.on('click', () => {
        if (view?.byCountry.has(feature.properties.iso3)) onCountry(feature.properties.iso3);
      });
      layer.bindTooltip(() => tooltipHtml(feature.properties), { sticky: true, direction: 'top', className: 'map-tip' });
    },
  }).addTo(map);
  const markers = L.layerGroup().addTo(map);
  const labelPoint = new Map(geo.features.map((f) => [f.properties.iso3, [f.properties.label_y, f.properties.label_x]]));
  const geoName = new Map(geo.features.map((f) => [f.properties.iso3, f.properties.name]));

  addHatchPattern(map);

  // --- drawing ------------------------------------------------------------------

  /**
   * @param {object} v
   * @param {'status'|'freshness'} v.mode
   * @param {object[]} v.surveys       surveys after every filter (status mode)
   * @param {object[]} v.freshSurveys  surveys for the freshness mode (see main.js)
   * @param {string}   v.country       selected ISO3 or 'all'
   * @param {Set}      v.markerCountries  freshness mode: countries that get a year marker (the others are only coloured)
   */
  return function update(v) {
    view = { ...v, byCountry: groupByCountry(v.mode === 'status' ? v.surveys : v.freshSurveys) };

    root.querySelectorAll('.segmented button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === v.mode)));
    root.querySelector('.map-caption').textContent = CAPTIONS[v.mode];
    root.querySelector('.map-legend').innerHTML = v.mode === 'status' ? statusLegend() : freshnessLegend();

    countries.setStyle((feature) => {
      const iso3 = feature.properties.iso3;
      const list = view.byCountry.get(iso3);
      const selected = v.country === iso3;
      return {
        weight: selected ? 2.5 : 0.8,
        color: selected ? COLORS.selected : COLORS.border,
        fillOpacity: 1,
        fillColor: list ? (v.mode === 'status' ? statusFill(list) : freshFill(list)) : COLORS.noRecord,
      };
    });
    countries.eachLayer((layer) => {
      if (v.country === layer.feature.properties.iso3) layer.bringToFront();
    });

    markers.clearLayers();
    for (const [iso3, list] of view.byCountry) {
      const point = labelPoint.get(iso3);
      if (!point) continue;
      if (v.mode === 'status') addStatusMarkers(iso3, list, point);
      else if (v.markerCountries.has(iso3)) addFreshMarker(iso3, list, point);
    }
  };

  function statusFill(list) {
    const top = mostActive(list);
    return top ? COLORS[top.display_status] : COLORS.noRecord;
  }

  function freshFill(list) {
    const last = lastReleased(list);
    if (!last) return 'url(#hatch-never)';
    return color(freshBucket(last.age).token);
  }

  function addStatusMarkers(iso3, list, point) {
    const active = list.filter((s) => s.display_status in ACTIVITY_RANK);
    const parts = [active.filter((s) => s.funding_gap !== true), active.filter((s) => s.funding_gap === true)]
      .filter((part) => part.length);
    parts.forEach((part, i) => {
      const gap = part[0].funding_gap === true;
      const top = mostActive(part);
      const c = COLORS[top.display_status];
      const offset = parts.length > 1 ? (i === 0 ? -17 : 17) : 0;
      const label = `${countryName(iso3)}: ${part.length} survey${part.length === 1 ? '' : 's'}, ${gap ? 'funding gap' : 'funded or funding not reported'}, most active status ${STATUS_LABELS[top.display_status]}`;
      const style = `--dx:${offset}px;` + (gap ? `background:#FFFFFF;border:3px solid ${c}` : `background:${c};border:1.5px solid #1F2421`);
      const icon = L.divIcon({
        className: 'map-marker-wrap',
        html: `<span class="map-marker" style="${style}">${statusIcon(top.display_status, 12)}${part.length}</span>`,
        iconSize: null,           // the pill is centred on the point by CSS (.map-marker)
        iconAnchor: [0, 0],
      });
      L.marker(point, { icon, title: label, alt: label, keyboard: true, riseOnHover: true })
        .on('click', () => onOpen(top))
        .addTo(markers);
    });
  }

  function addFreshMarker(iso3, list, point) {
    const last = lastReleased(list);
    const text = last ? String(last.date).slice(0, 4) : 'Never';
    const label = last
      ? `${countryName(iso3)}: last results released ${formatDate(last.date)} (${last.survey.type_raw}, ${freshBucket(last.age).label})`
      : `${countryName(iso3)}: no assessment with released results`;
    const icon = L.divIcon({
      className: 'map-marker-wrap',
      html: `<span class="map-marker map-marker-fresh">${text}</span>`,
      iconSize: null,
      iconAnchor: [0, 0],
    });
    L.marker(point, { icon, title: label, alt: label, keyboard: true, riseOnHover: true })
      .on('click', () => { if (last) onOpen(last.survey); })
      .addTo(markers);
  }

  function tooltipHtml(props) {
    const iso3 = props.iso3;
    const name = escapeHtml(countryName(iso3));
    const list = view?.byCountry.get(iso3);
    if (!list) return `<strong>${name}</strong><br><span class="mute">No assessment on record</span>`;

    if (view.mode === 'freshness') {
      const last = lastReleased(list);
      return last
        ? `<strong>${name}</strong><br>Last results released ${formatDate(last.date)}<br><span class="mute">${escapeHtml(last.survey.type_raw)} · ${freshBucket(last.age).label}</span>`
        : `<strong>${name}</strong><br>No assessment with released results`;
    }
    const counts = Object.keys(ACTIVITY_RANK)
      .map((key) => [key, list.filter((s) => s.display_status === key).length])
      .filter(([, n]) => n > 0)
      .map(([key, n]) => `<span class="tip-row">${statusIcon(key, 12)}${n} ${STATUS_LABELS[key].toLowerCase()}</span>`);
    return `<strong>${name}</strong><br>${counts.join('') || '<span class="mute">Not planned</span>'}<span class="tip-hint">Click to filter the page</span>`;
  }

  function countryName(iso3) {
    const fromData = view?.byCountry.get(iso3)?.[0]?.country;
    return shortCountry(fromData || geoName.get(iso3) || iso3);
  }

  function statusLegend() {
    const items = ['planned', 'ongoing', 'completed', 'released'].map((key) => `
      <li><span class="swatch" style="background:${COLORS[key]}"></span>${statusIcon(key, 14)}${STATUS_LABELS[key]}</li>`).join('');
    return `
      <ul class="legend" aria-label="Status legend">${items}</ul>
      <ul class="legend" aria-label="Funding legend">
        <li><span class="dot dot-filled"></span>Funded or not reported</li>
        <li><span class="dot dot-hollow"></span>Funding gap</li>
      </ul>`;
  }

  function freshnessLegend() {
    const items = FRESH_BUCKETS.map((b) => `<li><span class="bar" style="background:var(${b.token})"></span>${b.label}</li>`).join('');
    return `
      <div class="legend-block">
        <div class="lbl">Age of last assessment with released results</div>
        <ul class="legend legend-scale" aria-label="Freshness legend">${items}<li><span class="bar bar-never"></span>Never</li></ul>
        <div class="legend-note">Age is counted from the results release date (Validation column); where no date is recorded, from the survey year in the Assessment ID. Markers show the release year for countries with SMART surveys on record. Light grey = no assessment on record.</div>
      </div>`;
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

function mostActive(list) {
  return list.filter((s) => s.display_status in ACTIVITY_RANK)
    .sort((a, b) => ACTIVITY_RANK[a.display_status] - ACTIVITY_RANK[b.display_status])[0] || null;
}

/**
 * Rule 4.3.10: the most recent released result, dated by its release date,
 * else 1 July of its survey year. Never uses start or end dates.
 */
export function lastReleased(list, today = new Date()) {
  const dated = list
    .filter((s) => s.display_status === 'released')
    .map((s) => ({ survey: s, date: s.release_date || (s.survey_year ? `${s.survey_year}-07-01` : null) }))
    .filter((r) => r.date)
    .sort((a, b) => b.date.localeCompare(a.date));
  if (!dated.length) return null;
  const last = dated[0];
  return { ...last, age: (today - new Date(`${last.date}T00:00:00Z`)) / (365.25 * 864e5) };
}

export function freshBucket(age) {
  return FRESH_BUCKETS.find((b) => age < b.max);
}

// Diagonal hatch used for "Never" in the freshness mode
function addHatchPattern(map) {
  const svg = map.getPanes().overlayPane.querySelector('svg');
  if (!svg || svg.querySelector('#hatch-never')) return;
  const ns = 'http://www.w3.org/2000/svg';
  const defs = document.createElementNS(ns, 'defs');
  defs.innerHTML = '<pattern id="hatch-never" patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)">'
    + '<rect width="5" height="5" fill="#B5B5B5"></rect><rect width="2" height="5" fill="#6E6E6E"></rect></pattern>';
  svg.prepend(defs);
}
