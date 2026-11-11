// Map "SMART assessments": Leaflet (vendored, global `L`) + Natural Earth countries, no tile service.
// Two modes, switched by a segmented toggle:
//   - Status: each country coloured by its most active SMART survey (ongoing > planned > completed > released),
//     in the four status colours only. No numbers on the map.
//   - Data freshness: each country coloured by the age of its last released results (rule 4.3.10).
//     Never computed from start or end dates.
// Hovering a country shows its SMART surveys in an info box next to the cursor. Clicking does nothing
// (owner's decision, Nov 2026); on touch screens a tap only shows the box at the tapped point.

import { statusIcon, STATUS_LABELS } from './icons.js';
import { shortCountry, formatDate } from './format.js';
import { escapeHtml } from './filters.js';

// "Most active" order, as in the mockup: what is happening now comes first
const ACTIVITY_RANK = { ongoing: 0, planned: 1, completed: 2, released: 3 };
const TOOLTIP_MAX = 5; // surveys listed in the hover tooltip before "+ N more"

export const FRESH_BUCKETS = [
  { key: 'lt1', label: '< 1 year', max: 1, token: '--fresh-1' },
  { key: '1to2', label: '1–2 years', max: 2, token: '--fresh-2' },
  { key: '2to3', label: '2–3 years', max: 3, token: '--fresh-3' },
  { key: 'gt3', label: '> 3 years', max: Infinity, token: '--fresh-4' },
];

const AFRICA_VIEW = [[-35, -19], [38, 56]]; // Africa and Yemen, as in the mockup

const CAPTIONS = {
  status: 'Countries coloured by the status of their most active SMART survey in the current filters. Hover a country to see its surveys.',
  freshness: 'Countries coloured by how long ago results of a SMART survey were last released.',
};

const UN_DISCLAIMER = 'The boundaries and names shown and the designations used on this map do not imply official endorsement or acceptance by the United Nations.';

/**
 * @param {HTMLElement} root
 * @param {object} handlers  { onMode(mode) }
 * @returns {Promise<(view) => void>}  update function, see `update` below
 */
export async function createMap(root, { onMode }) {
  root.innerHTML = `
    <div class="card-head">
      <h2>SMART assessments</h2>
      <div class="segmented" role="group" aria-label="Map colouring">
        <button type="button" data-mode="status" aria-pressed="true">Status</button>
        <button type="button" data-mode="freshness" aria-pressed="false">Data freshness</button>
      </div>
    </div>
    <p class="card-note map-caption"></p>
    <div class="map-box">
      <div class="map" role="region" aria-label="Map of SMART assessments by country"></div>
      <div class="map-info map-tip" aria-hidden="true" hidden></div>
    </div>
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
    hover: color('--text'),
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
      // Hover: outline the country and show its surveys in the info box, which follows the cursor.
      // Screen readers get the same details from the survey list.
      layer.on('mouseover', (event) => {
        if (hasDetails(iso3)) layer.setStyle({ weight: 2, color: COLORS.hover });
        showInfo(feature.properties, event.containerPoint);
      });
      layer.on('mousemove', (event) => placeInfo(event.containerPoint));
      layer.on('mouseout', () => {
        layer.setStyle({ weight: 0.8, color: COLORS.border });
        info.hidden = true;
      });
      // Touch screens have no hover: a tap shows the box where the finger is (and does nothing else)
      layer.on('click', (event) => {
        L.DomEvent.stopPropagation(event);   // keep the map's own click (below) from hiding the box again
        showInfo(feature.properties, event.containerPoint);
      });
    },
  }).addTo(map);
  const geoName = new Map(geo.features.map((f) => [f.properties.iso3, f.properties.name]));

  // A tap on the sea (or anywhere off a country) hides the box on touch screens
  map.on('click', () => { info.hidden = true; });

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

  addHatchPattern(map);

  // --- drawing ------------------------------------------------------------------

  /**
   * @param {object} v
   * @param {'status'|'freshness'} v.mode
   * @param {object[]} v.surveys       SMART surveys after every filter
   * @param {object[]} v.freshSurveys  surveys of every type for the freshness mode (see main.js)
   */
  return function update(v) {
    view = { mode: v.mode, smart: groupByCountry(v.surveys), fresh: groupByCountry(v.freshSurveys) };

    root.querySelectorAll('.segmented button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === v.mode)));
    root.querySelector('.map-caption').textContent = CAPTIONS[v.mode];
    root.querySelector('.map-legend').innerHTML = v.mode === 'status' ? statusLegend() : freshnessLegend();

    countries.setStyle((feature) => {
      const iso3 = feature.properties.iso3;
      const list = (v.mode === 'status' ? view.smart : view.fresh).get(iso3);
      return {
        weight: 0.8,
        color: COLORS.border,
        fillOpacity: 1,
        fillColor: list ? (v.mode === 'status' ? statusFill(list) : freshFill(list)) : COLORS.noRecord,
      };
    });
  };

  function hasDetails(iso3) {
    return Boolean(view?.smart.get(iso3)?.length || (view?.mode === 'freshness' && view.fresh.get(iso3)));
  }

  // Only the four status colours; a country with "Not planned" surveys only stays grey
  function statusFill(list) {
    const top = mostActive(list);
    return top ? COLORS[top.display_status] : COLORS.noRecord;
  }

  function freshFill(list) {
    const last = lastReleased(list);
    if (!last) return 'url(#hatch-never)';
    return color(freshBucket(last.age).token);
  }

  // Hover: the country's SMART surveys (status, place, dates), as a preview of the detail panel
  function tooltipHtml(props) {
    const iso3 = props.iso3;
    const smart = view?.smart.get(iso3) || [];
    const name = escapeHtml(shortCountry(smart[0]?.country || view?.fresh.get(iso3)?.[0]?.country || geoName.get(iso3) || iso3));

    let freshLine = '';
    if (view?.mode === 'freshness') {
      const fresh = view.fresh.get(iso3);
      const last = fresh && lastReleased(fresh);
      freshLine = !fresh ? '<span class="mute">No SMART survey on record</span>'
        : last ? `Last results released ${formatDate(last.date)} <span class="mute">(${escapeHtml(last.survey.type_raw)}, ${freshBucket(last.age).label})</span>`
        : 'No SMART survey with released results';
      freshLine = `<span class="tip-fresh">${freshLine}</span>`;
    }

    if (!smart.length) {
      return `<strong>${name}</strong>${freshLine || '<br><span class="mute">No SMART survey in the current filters</span>'}`;
    }

    const sorted = [...smart].sort((a, b) => (ACTIVITY_RANK[a.display_status] ?? 9) - (ACTIVITY_RANK[b.display_status] ?? 9) || a.id.localeCompare(b.id));
    const rows = sorted.slice(0, TOOLTIP_MAX).map((s) => {
      const status = s.display_status || 'not_planned';
      const place = s.admin1 ? ` · ${escapeHtml(s.admin1)}` : '';
      // Short lines (ID, place, status); dates and funding are in the detail panel
      return `<span class="tip-row">${statusIcon(status, 12)}<span><strong>${escapeHtml(s.id)}</strong>${place}<span class="mute"> · ${STATUS_LABELS[status]}</span></span></span>`;
    }).join('');
    const more = smart.length > TOOLTIP_MAX ? `<span class="tip-more">+ ${smart.length - TOOLTIP_MAX} more</span>` : '';
    return `<strong>${name}</strong> <span class="mute">· ${smart.length} SMART survey${smart.length === 1 ? '' : 's'}</span>${freshLine}
      <span class="tip-list">${rows}${more}</span>`;
  }

  function statusLegend() {
    const items = ['planned', 'ongoing', 'completed', 'released'].map((key) => `
      <li><span class="swatch" style="background:${COLORS[key]}"></span>${STATUS_LABELS[key]}</li>`).join('');
    return `<ul class="legend" aria-label="Status legend">${items}</ul>`;
  }

  function freshnessLegend() {
    const items = FRESH_BUCKETS.map((b) => `<li><span class="bar" style="background:var(${b.token})"></span>${b.label}</li>`).join('');
    return `
      <div class="legend-block">
        <div class="lbl">Age of last SMART survey with released results</div>
        <ul class="legend legend-scale" aria-label="Freshness legend">${items}<li><span class="bar bar-never"></span>Never</li></ul>
        <div class="legend-note">Age is counted from the results release date (Validation column); where no date is recorded, from the survey year in the Assessment ID. Light grey = no SMART survey on record.</div>
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
