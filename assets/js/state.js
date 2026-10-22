// Filter state <-> URL query string, so any view can be shared by link.
// Example: ?year=2026&country=MLI,NER&type=SMART&status=planned&map=freshness
// Values equal to the defaults are left out of the URL to keep links short.

const CURRENT_YEAR = String(new Date().getFullYear());

export const DEFAULTS = Object.freeze({
  year: CURRENT_YEAR,            // a year, or 'all'
  region: [],
  country: [],                   // ISO3 codes
  type: ['SMART', 'Rapid SMART'],
  status: [],                    // display_status values
  funding: [],                   // 'funded' | 'gap' | 'unknown'
  map: 'status',                 // 'status' | 'freshness'
});

const LIST_KEYS = ['region', 'country', 'type', 'status', 'funding'];

export function readState(search = window.location.search) {
  const params = new URLSearchParams(search);
  const state = structuredClone(DEFAULTS);

  if (params.has('year')) state.year = params.get('year');
  for (const key of LIST_KEYS) {
    if (params.has(key)) state[key] = params.get(key).split(',').map((v) => v.trim()).filter(Boolean);
  }
  if (params.get('map') === 'freshness') state.map = 'freshness';
  return state;
}

export function writeState(state) {
  const params = new URLSearchParams();
  if (state.year !== DEFAULTS.year) params.set('year', state.year);
  for (const key of LIST_KEYS) {
    if (!sameList(state[key], DEFAULTS[key])) params.set(key, state[key].join(','));
  }
  if (state.map !== DEFAULTS.map) params.set('map', state.map);

  const query = params.toString();
  const url = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
  window.history.replaceState(null, '', url);
}

export function defaultState() {
  return structuredClone(DEFAULTS);
}

function sameList(a, b) {
  return a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');
}
