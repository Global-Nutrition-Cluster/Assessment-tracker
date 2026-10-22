// Filter bar: six dropdowns and a Reset button, as in the mockup.
// On phones the dropdowns are folded behind a "Filters" button showing how many filters are active.
// It only reads and emits state; main.js decides what to redraw.

import { defaultState, DEFAULTS } from './state.js';

const FIELDS = [
  { key: 'year', label: 'Period', width: '' },
  { key: 'region', label: 'Region', width: 'w-140' },
  { key: 'country', label: 'Country', width: '' },
  { key: 'type', label: 'Assessment type', width: 'w-180' },
  { key: 'status', label: 'Status', width: 'w-170' },
  { key: 'funding', label: 'Funding', width: 'w-170' },
];

const FILTER_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M2 4h12M4.5 8h7M7 12h2"></path></svg>';
const RESET_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M3 8a5 5 0 1 0 1.6-3.7"></path><path d="M3 2.5v2.8h2.8"></path></svg>';

/**
 * @param {HTMLFormElement} form  the <form> that receives the controls
 * @param {object} options        { year: [{value,label}], region: [...], country: [...], type, status, funding }
 *                                country options also carry `region` so the list follows the Region filter
 * @param {(state) => void} onChange
 * @returns {(state) => void}     call with the current state to refresh the controls
 */
export function createFilterBar(form, options, onChange) {
  let current = null;

  form.innerHTML = `
    <button type="button" class="btn filter-toggle" id="f-toggle" aria-expanded="false" aria-controls="filter-fields">
      ${FILTER_ICON}Filters<span class="filter-count" id="f-count"></span>
    </button>
    <div class="filter-fields" id="filter-fields">
      ${FIELDS.map((f) => `
      <div class="field ${f.width}">
        <label class="lbl" for="f-${f.key}">${f.label}</label>
        <select id="f-${f.key}" class="sel" name="${f.key}"></select>
      </div>`).join('')}
      <button type="button" class="btn" id="f-reset">${RESET_ICON}Reset</button>
    </div>`;

  const toggle = form.querySelector('#f-toggle');
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    form.classList.toggle('is-open', open);
  });

  form.addEventListener('submit', (event) => event.preventDefault());
  form.addEventListener('change', (event) => {
    const { name, value } = event.target;
    const next = { ...current, [name]: value };
    // A country outside the newly chosen region would give an empty page: drop it
    if (name === 'region' && next.country !== 'all' && !countriesFor(value).some((o) => o.value === next.country)) {
      next.country = 'all';
    }
    onChange(next);
  });
  form.querySelector('#f-reset').addEventListener('click', () => {
    onChange({ ...defaultState(), map: current.map }); // keep the map mode
  });

  function countriesFor(region) {
    return options.country.filter((o) => o.value === 'all' || region === 'all' || o.region === region);
  }

  return function update(state) {
    current = state;
    const active = FIELDS.filter((f) => state[f.key] !== DEFAULTS[f.key]).length;
    form.querySelector('#f-count').textContent = active ? ` (${active})` : '';
    for (const f of FIELDS) {
      const select = form.querySelector(`#f-${f.key}`);
      let list = f.key === 'country' ? countriesFor(state.region) : options[f.key];
      // A value from a shared link that is not in the list (e.g. a year without data) is kept visible
      if (!list.some((o) => o.value === state[f.key])) list = [{ value: state[f.key], label: state[f.key] }, ...list];
      select.innerHTML = list.map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join('');
      select.value = state[f.key];
    }
  };
}

export function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}
