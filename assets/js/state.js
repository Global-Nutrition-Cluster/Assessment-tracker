// Filter state <-> URL query string, so any view can be shared by link.
// Example: ?year=2026&country=MLI&type=all&status=planned&map=freshness&survey=MLI-2026-SMART-01
// Values equal to the defaults are left out of the URL to keep links short.

const CURRENT_YEAR = String(new Date().getFullYear());

export const DEFAULTS = Object.freeze({
  year: CURRENT_YEAR,   // a survey year, or 'all'
  region: 'all',        // a region code, or 'all'
  country: 'all',       // an ISO3 code, or 'all'
  type: 'smart',        // 'smart' = SMART + Rapid SMART, 'all', or one type group
  status: 'all',        // 'all' | 'planned' | 'ongoing' | 'completed' | 'released' | 'not_planned'
  funding: 'all',       // 'all' | 'funded' | 'gap' | 'partial' | 'unfunded'
  map: 'status',        // 'status' | 'freshness'
  survey: '',           // Assessment ID shown in the detail panel, '' when closed
});

const KEYS = Object.keys(DEFAULTS);

export function readState(search = window.location.search) {
  const params = new URLSearchParams(search);
  const state = { ...DEFAULTS };
  for (const key of KEYS) {
    const value = params.get(key);
    if (value) state[key] = value;
  }
  if (state.map !== 'freshness') state.map = 'status';
  return state;
}

export function writeState(state) {
  const params = new URLSearchParams();
  for (const key of KEYS) {
    if (state[key] !== DEFAULTS[key]) params.set(key, state[key]);
  }
  const query = params.toString();
  const url = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
  window.history.replaceState(null, '', url);
}

export function defaultState() {
  return { ...DEFAULTS };
}
