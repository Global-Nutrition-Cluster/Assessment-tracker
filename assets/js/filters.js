// Filter bar: year select, multi-selects, removable chips and Reset.
// It only reads and emits state; main.js decides what to redraw.

import { defaultState } from './state.js';

const FIELDS = [
  { key: 'region', label: 'Region', all: 'All regions' },
  { key: 'country', label: 'Country', all: 'All countries' },
  { key: 'type', label: 'Assessment type', all: 'All types' },
  { key: 'status', label: 'Status', all: 'All statuses' },
  { key: 'funding', label: 'Funding', all: 'All' },
];

/**
 * @param {HTMLElement} root   element that receives the filter bar
 * @param {object} options     { years: string[], region: [], country: [], type: [], status: [], funding: [] }
 * @param {(state) => void} onChange
 * @returns {(state) => void}  call with the current state to refresh the controls
 */
export function createFilterBar(root, options, onChange) {
  let current = null;

  root.innerHTML = `
    <div class="filter-row">
      <div class="field">
        <label class="field-label" for="f-year">Period</label>
        <select id="f-year"></select>
      </div>
      ${FIELDS.map((f) => `
        <div class="field">
          <span class="field-label" id="lbl-${f.key}">${f.label}</span>
          <details class="ms" data-key="${f.key}">
            <summary aria-labelledby="lbl-${f.key} sum-${f.key}"><span id="sum-${f.key}"></span></summary>
            <fieldset class="ms-panel">
              <legend class="visually-hidden">${f.label}</legend>
              ${options[f.key].map((o) => `
                <label><input type="checkbox" value="${escapeHtml(o.value)}"> ${escapeHtml(o.label)}</label>`).join('')}
            </fieldset>
          </details>
        </div>`).join('')}
      <div class="filter-actions">
        <button type="button" class="link-button" id="f-reset">Reset filters</button>
      </div>
    </div>
    <div class="chips" aria-label="Active filters"></div>`;

  const yearSelect = root.querySelector('#f-year');
  const chips = root.querySelector('.chips');

  // --- events ---------------------------------------------------------------
  yearSelect.addEventListener('change', () => emit({ year: yearSelect.value }));

  root.querySelectorAll('.ms').forEach((details) => {
    const key = details.dataset.key;
    details.addEventListener('change', () => {
      const checked = [...details.querySelectorAll('input:checked')].map((i) => i.value);
      emit({ [key]: checked });
    });
    details.addEventListener('toggle', () => {
      if (details.open) root.querySelectorAll('.ms[open]').forEach((d) => { if (d !== details) d.open = false; });
    });
  });

  // Close an open dropdown on outside click or Escape
  document.addEventListener('click', (event) => {
    root.querySelectorAll('.ms[open]').forEach((d) => { if (!d.contains(event.target)) d.open = false; });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    root.querySelectorAll('.ms[open]').forEach((d) => { d.open = false; d.querySelector('summary').focus(); });
  });

  chips.addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (!chip) return;
    const { key, value } = chip.dataset;
    emit({ [key]: current[key].filter((v) => v !== value) });
  });

  root.querySelector('#f-reset').addEventListener('click', () => {
    emit({ ...defaultState(), map: current.map }); // keep the map mode
  });

  function emit(patch) {
    onChange({ ...current, ...patch });
  }

  // --- refresh --------------------------------------------------------------
  return function update(state) {
    current = state;

    const years = options.years.includes(state.year) || state.year === 'all'
      ? options.years : [state.year, ...options.years];
    yearSelect.innerHTML = [`<option value="all">All years</option>`,
      ...years.map((y) => `<option value="${y}">${y}</option>`)].join('');
    yearSelect.value = state.year;

    for (const f of FIELDS) {
      const details = root.querySelector(`.ms[data-key="${f.key}"]`);
      const selected = state[f.key];
      details.querySelectorAll('input').forEach((input) => { input.checked = selected.includes(input.value); });
      const summary = root.querySelector(`#sum-${f.key}`);
      summary.innerHTML = selected.length === 0 ? f.all
        : selected.length === 1 ? escapeHtml(labelOf(f.key, selected[0]))
        : `${f.label}<span class="ms-count">${selected.length}</span>`;
    }

    chips.innerHTML = FIELDS.flatMap((f) => state[f.key].map((value) => `
      <button type="button" class="chip" data-key="${f.key}" data-value="${escapeHtml(value)}"
        aria-label="Remove filter ${escapeHtml(f.label)}: ${escapeHtml(labelOf(f.key, value))}">
        ${escapeHtml(labelOf(f.key, value))}<span class="chip-x" aria-hidden="true">×</span>
      </button>`)).join('');
  };

  function labelOf(key, value) {
    return options[key].find((o) => o.value === value)?.label ?? value;
  }
}

export function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}
