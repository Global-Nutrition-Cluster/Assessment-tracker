// Indicator selector and Source toggle (CLAUDE.md 11.4.3).

import { SOURCES, indicatorSources } from './data.js';
import { escapeHtml } from '../format.js';

/** Label in the selector: single-source indicators say so, unless the label already names the source. */
function optionLabel(indicator) {
  const sources = indicatorSources(indicator);
  if (sources.length !== 1 || /\((SMART|DHS)\)/.test(indicator.label)) return indicator.label;
  return `${indicator.label} (${sources[0]} only)`;
}

function selectHtml(indicators) {
  const groups = new Map();
  for (const i of indicators) {
    if (!groups.has(i.group)) groups.set(i.group, []);
    groups.get(i.group).push(i);
  }
  return [...groups].map(([group, items]) => `
    <optgroup label="${escapeHtml(group)}">
      ${items.map((i) => `<option value="${escapeHtml(i.key)}">${escapeHtml(optionLabel(i))}</option>`).join('')}
    </optgroup>`).join('');
}

/** "SMART: … DHS: …" for the sources shown (definitions only; the phases are in the map legend). */
export function definitionText(indicator, source) {
  const parts = Object.entries(indicator.definition || {})
    .filter(([src]) => source === 'all' || src === source.toUpperCase())
    .map(([src, text]) => `${src}: ${text}.`);
  return parts.join(' ');
}

/**
 * @param {HTMLElement} root
 * @param {object[]} indicators  selector indicators
 * @param {{onIndicator: (key) => void, onSource: (source) => void}} handlers
 */
export function createControls(root, indicators, handlers) {
  root.innerHTML = `
    <div class="res-indicator">
      <div class="field">
        <label for="indicator-select">Indicator</label>
        <select id="indicator-select" class="sel">${selectHtml(indicators)}</select>
      </div>
      <p class="res-definition" id="indicator-definition"></p>
    </div>
    <div class="field">
      <span class="field-label" id="source-label">Source</span>
      <div class="segmented" role="group" aria-labelledby="source-label">
        ${SOURCES.map((s) => `<button type="button" data-source="${s.value}" aria-pressed="false">${s.label}</button>`).join('')}
        <button type="button" disabled title="MICS results are not available yet">MICS</button>
      </div>
    </div>`;

  const select = root.querySelector('#indicator-select');
  select.addEventListener('change', () => handlers.onIndicator(select.value));
  root.querySelector('.segmented').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-source]');
    if (button) handlers.onSource(button.dataset.source);
  });

  const byKey = new Map(indicators.map((i) => [i.key, i]));
  return function update(state) {
    select.value = state.indicator;
    const definition = root.querySelector('#indicator-definition');
    definition.textContent = definitionText(byKey.get(state.indicator), state.source);
    definition.title = definition.textContent;   // the line is cut after two lines; the full text on hover
    root.querySelectorAll('button[data-source]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.source === state.source));
    });
  };
}
