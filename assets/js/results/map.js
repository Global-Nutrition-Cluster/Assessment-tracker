// Results map (CLAUDE.md 11.4.5): Leaflet (vendored, global `L`) + Natural Earth countries, no tile service.
// Each country is coloured by its national figure for the chosen indicator and source (figures.js):
//   - the indicator's phases (from the Dashboard indicators sheet: WHO 2018, GNC…); five equal steps when it has none;
//   - hatched = subnational data only; grey = no data for this indicator; light grey = no survey;
//   - dotted = survey older than 3 years (rule 11.3.5).
// Hovering shows the figure next to the cursor; clicking a country with results opens its profile.

import { escapeHtml } from '../filters.js';
import { shortCountry } from '../format.js';
import {
  phaseOf, phaseLegend, phasePill, formatValue, formatCi, isOlderThan3Years,
  continuousSteps, continuousIndex,
} from './figures.js';

const VIEW = [[-35, -19], [45, 95]]; // Africa, the Middle East and South Asia (most SMART and DHS countries)
const UN_DISCLAIMER = 'The boundaries and names shown and the designations used on this map do not imply official endorsement or acceptance by the United Nations.';
const GAP = 12; // px between the cursor and the info box
const SOURCE_NAMES = { all: 'SMART and DHS', smart: 'SMART', dhs: 'DHS' };

/**
 * @param {HTMLElement} root
 * @param {{onCountry: (iso3) => void}} handlers
 */
export async function createResultsMap(root, { onCountry }) {
  root.innerHTML = `
    <div class="card-head">
      <h2 id="map-title"></h2>
      <span class="card-note map-scope"></span>
    </div>
    <p class="card-note map-caption">Hover a country for its figure and source. Click it to open the country profile.</p>
    <div class="map-box">
      <div class="map" role="region" aria-label="Map of the latest national figure per country"></div>
      <div class="map-info map-tip res-tip" aria-hidden="true" hidden></div>
    </div>
    <div class="map-legend res-legend"></div>
    <p class="map-disclaimer">${UN_DISCLAIMER}</p>`;

  const css = getComputedStyle(document.documentElement);
  const token = (name) => css.getPropertyValue(name).trim();
  const IPC_COLORS = ['--phase-1', '--phase-2', '--phase-3', '--phase-4', '--phase-5'].map(token);   // "Phase palette" = IPC
  const STEP_COLORS = ['--cont-1', '--cont-2', '--cont-3', '--cont-4', '--cont-5'].map(token);
  const COLORS = { noSurvey: '#E8EAE6', noData: '#C2C6C0', border: '#FFFFFF', hover: token('--text') };

  const info = root.querySelector('.map-info');
  const geo = await fetch('geo/countries.geojson', { cache: 'force-cache' }).then((r) => r.json());
  const geoName = new Map(geo.features.map((f) => [f.properties.iso3, f.properties.name]));

  const map = L.map(root.querySelector('.map'), { zoomSnap: 0.25, minZoom: 1.5, maxZoom: 7, scrollWheelZoom: false });
  map.attributionControl.setPrefix(false).addAttribution('Boundaries: Natural Earth');
  map.fitBounds(VIEW);

  let view = null; // { figures, indicator, source, countryNames, steps }

  const countries = L.geoJSON(geo, {
    style: () => ({ weight: 0.8, color: COLORS.border, fillColor: COLORS.noSurvey, fillOpacity: 1 }),
    onEachFeature: (feature, layer) => {
      const iso3 = feature.properties.iso3;
      layer.on('add', () => layer.getElement()?.setAttribute('data-iso3', iso3));   // handy for tests
      layer.on('mouseover', (event) => {
        if (view?.figures.has(iso3)) layer.setStyle({ weight: 2, color: COLORS.hover });
        showInfo(iso3, event.containerPoint);
      });
      layer.on('mousemove', (event) => placeInfo(event.containerPoint));
      layer.on('mouseout', () => {
        layer.setStyle({ weight: 0.8, color: COLORS.border });
        info.hidden = true;
      });
      layer.on('click', (event) => {
        L.DomEvent.stopPropagation(event);
        if (view?.figures.has(iso3)) onCountry(iso3);
        else showInfo(iso3, event.containerPoint);   // touch: show why nothing opens
      });
    },
  }).addTo(map);
  map.on('click', () => { info.hidden = true; });

  const patterns = new Patterns(map);

  function showInfo(iso3, point) {
    info.innerHTML = tooltipHtml(iso3);
    info.hidden = false;
    placeInfo(point);
  }

  /** Bottom right of the cursor, flipping left / up when the box would leave the map (as on the Planning map). */
  function placeInfo(point) {
    if (info.hidden) return;
    const size = map.getSize();
    let x = point.x + GAP;
    let y = point.y + GAP;
    if (x + info.offsetWidth > size.x - 4) x = point.x - GAP - info.offsetWidth;
    if (y + info.offsetHeight > size.y - 4) y = point.y - GAP - info.offsetHeight;
    info.style.left = `${Math.max(4, x)}px`;
    info.style.top = `${Math.max(4, y)}px`;
  }

  // --- drawing ------------------------------------------------------------------

  /**
   * @param {object} v
   * @param {Map} v.figures      countryFigures() for the chosen indicator and source
   * @param {object} v.indicator indicator of data/results.json
   * @param {string} v.source    'all' | 'smart' | 'dhs'
   * @param {object} v.countryNames iso3 -> name (data/results.json)
   */
  return function update(v) {
    view = { ...v, steps: v.indicator.phases ? null : continuousSteps(v.figures) };
    root.querySelector('#map-title').textContent = shortLabel(v.indicator);
    root.querySelector('.map-scope').textContent = `Latest national figure per country · ${SOURCE_NAMES[v.source]}`;
    root.querySelector('.map').setAttribute('aria-label',
      `Map of the latest national figure per country for ${v.indicator.label}, ${SOURCE_NAMES[v.source]}. The same figures are in the ranked list.`);
    root.querySelector('.map-legend').innerHTML = legendHtml();

    countries.setStyle((feature) => ({
      weight: 0.8, color: COLORS.border, fillOpacity: 1, fillColor: fill(view.figures.get(feature.properties.iso3)),
    }));
  };

  function isIpc() {
    return view.indicator.phases?.palette === 'ipc';
  }

  function colourOf(main) {
    const value = main.value.value;
    if (view.indicator.phases) {
      const palette = view.indicator.phases.palette === 'ipc' ? IPC_COLORS : STEP_COLORS;
      return palette[phaseOf(view.indicator, value).colour];
    }
    return STEP_COLORS[continuousIndex(view.steps, value)];
  }

  function fill(figure) {
    if (!figure) return COLORS.noSurvey;
    if (figure.main) {
      const colour = colourOf(figure.main);
      return isOlderThan3Years(figure.main.year) ? patterns.dotted(colour) : colour;
    }
    if (figure.subnational) return patterns.hatched(isIpc() ? '#7A847E' : '#3E8196');   // never a phase colour
    return COLORS.noData;
  }

  // --- hover box --------------------------------------------------------------------

  function tooltipHtml(iso3) {
    const figure = view?.figures.get(iso3);
    const name = escapeHtml(shortCountry(view?.countryNames[iso3] || geoName.get(iso3) || iso3));
    if (!figure) return `<strong>${name}</strong><span class="tip-line mute">No survey in the tracker${view.source === 'all' ? '' : ` (${SOURCE_NAMES[view.source]})`}</span>`;

    const unit = view.indicator.unit;
    let body;
    if (figure.main) {
      body = figureLines(figure.main, unit);
    } else if (figure.subnational) {
      const s = figure.subnational;
      body = `<span class="tip-line"><span class="src">${s.source}</span> ${s.year ?? ''} · Subnational data only</span>
        <span class="tip-line mute">${s.areas} area${s.areas === 1 ? '' : 's'}, not on the national scale</span>`;
    } else {
      body = '<span class="tip-line mute">No data for this indicator</span>';
    }

    const also = figure.others.map((o) => o.subnationalOnly
      ? `<span class="src">${o.source}</span> ${o.year ?? ''} subnational data only`
      : `<span class="src">${o.value.source}</span> ${o.year ?? ''} national ${formatValue(o.value.value, unit)}${formatCi(o.value) ? ` [${formatCi(o.value)}]` : ''}${definitionOf(o.value.source) ? `, ${escapeHtml(definitionOf(o.value.source))}` : ''}`);
    const alsoHtml = also.length ? `<span class="tip-also">Also: ${also.join('<br>')}</span>` : '';
    const action = figure.main || figure.subnational || figure.others.length
      ? '<span class="tip-action">Click to open the country profile</span>' : '';
    return `<strong>${name}</strong>${body}${alsoHtml}${action}`;
  }

  function figureLines(main, unit) {
    const v = main.value;
    const pill = phasePill(view.indicator, v.value) ? ` ${phasePill(view.indicator, v.value)}` : '';
    const ci = formatCi(v);
    const old = isOlderThan3Years(main.year) ? '<span class="tip-line tip-old">Survey older than 3 years</span>' : '';
    const unitText = unit && unit !== '%' ? ` <span class="mute">${escapeHtml(unit)}</span>` : '';
    return `<span class="tip-value">${formatValue(v.value, unit)}${unitText}${pill} <span class="src">${v.source}</span></span>
      <span class="tip-line">${ci ? `95% CI ${ci}` : 'No CI published'} · National · Survey ${main.year ?? ''}</span>
      ${definitionOf(v.source) ? `<span class="tip-line mute">${escapeHtml(definitionOf(v.source))}</span>` : ''}${old}`;
  }

  function definitionOf(source) {
    return view.indicator.definition?.[source] || '';
  }

  // --- legend ---------------------------------------------------------------------

  function legendHtml() {
    let scale;
    if (view.indicator.phases) {
      scale = `<span class="lbl">Phases · ${escapeHtml(view.indicator.phases.source)}</span>${phaseLegend(view.indicator)
        .map((p) => `<span class="sev ${p.cls}">${escapeHtml(p.text)}</span>`).join('')}`;
    } else if (view.steps) {
      const { min, max, limits } = view.steps;
      const edges = [min, ...limits, max].map((x) => +x.toPrecision(3));
      scale = `<span class="lbl">${escapeHtml(view.indicator.unit || 'Value')}</span>${[0, 1, 2, 3, 4]
        .map((i) => `<span class="sev cont-${i}">${edges[i]}–${edges[i + 1]}</span>`).join('')}`;
    } else {
      scale = '<span class="mute">No national figure for this indicator and source.</span>';
    }
    return `
      <div class="legend-scale-row">${scale}</div>
      <ul class="legend">
        <li><span class="swatch sw-hatch ${isIpc() ? '' : 'sw-hatch-cont'}"></span>Subnational data only</li>
        <li><span class="swatch" style="background:${COLORS.noData}"></span>No data for this indicator</li>
        <li><span class="swatch sw-dots ${isIpc() ? '' : 'sw-dots-cont'}"></span>Dotted: survey older than 3 years</li>
        <li><span class="swatch" style="background:${COLORS.noSurvey}"></span>No survey in the tracker</li>
      </ul>`;
  }
}

/** "Wasting — GAM by weight-for-height (WHZ)" -> card title as in the mockup. */
function shortLabel(indicator) {
  return indicator.label.replace('weight-for-height', 'WHZ').replace(' (WHZ)', '').replace('WHZ (WHZ)', 'WHZ');
}

/** SVG patterns for the map: hatching (subnational only) and dots on a colour (old survey). */
class Patterns {
  constructor(map) {
    this.svg = map.getPanes().overlayPane.querySelector('svg');
    this.ns = 'http://www.w3.org/2000/svg';
    this.defs = document.createElementNS(this.ns, 'defs');
    this.svg.prepend(this.defs);
    this.made = new Set();
  }

  add(id, markup) {
    if (!this.made.has(id)) {
      const pattern = document.createElementNS(this.ns, 'pattern');
      pattern.setAttribute('id', id);
      pattern.setAttribute('patternUnits', 'userSpaceOnUse');
      pattern.innerHTML = markup.inner;
      for (const [k, v] of Object.entries(markup.attrs)) pattern.setAttribute(k, v);
      this.defs.append(pattern);
      this.made.add(id);
    }
    return `url(#${id})`;
  }

  hatched(colour) {
    return this.add(`res-hatch-${colour.replace('#', '')}`, {
      attrs: { width: 6, height: 6, patternTransform: 'rotate(45)' },
      inner: `<rect width="6" height="6" fill="#FFFFFF"></rect><rect width="2.2" height="6" fill="${colour}"></rect>`,
    });
  }

  dotted(colour) {   // white dots on the country's own colour
    const id = `res-dots-${colour.replace('#', '')}`;
    return this.add(id, {
      attrs: { width: 5, height: 5 },
      inner: `<rect width="5" height="5" fill="${colour}"></rect><circle cx="2.5" cy="2.5" r="1.1" fill="#FFFFFF"></circle>`,
    });
  }
}
