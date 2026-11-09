// Page state <-> URL query string, so a view can be shared by link.
// Example: ?status=planned&map=freshness
// Since Nov 2026 there is no filter bar: year, region and funding stay at their defaults (SMART surveys of the
// current year) and only the KPI status selection and the map mode come from the URL. Old parameters are ignored.
// Values equal to the defaults are left out of the URL to keep links short.

const CURRENT_YEAR = String(new Date().getFullYear());

export const DEFAULTS = Object.freeze({
  year: CURRENT_YEAR,   // a survey year, or 'all'
  region: 'all',        // a region code, or 'all'
  status: 'all',        // 'all' | 'planned' | 'ongoing' | 'completed' | 'released' | 'not_planned'
  funding: 'all',       // 'all' | 'funded' | 'gap' | 'partial' | 'unfunded'
  map: 'status',        // 'status' | 'freshness'
});

const KEYS = ['status', 'map']; // the only parts of the state that can change on the page

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
