// Page state <-> URL query string, so a view can be shared by link.
// Example: ?status=planned&country=MLI
// The page always shows the SMART surveys of the current year. Only the KPI status selection and the
// country chosen on the map come from the URL (Nov 2026).
// Old parameters (map, year, region, type, funding, survey) are ignored and dropped on load.
// Values equal to the defaults are left out of the URL to keep links short.

const CURRENT_YEAR = String(new Date().getFullYear());

export const DEFAULTS = Object.freeze({
  year: CURRENT_YEAR,   // the current calendar year (not in the URL)
  status: 'all',        // 'all' | 'planned' | 'ongoing' | 'completed' | 'released' | 'not_planned'
  country: 'all',       // an ISO3 code chosen by clicking the map, or 'all'
});

const KEYS = ['status', 'country']; // the only parts of the state that can change on the page

export function readState(search = window.location.search) {
  const params = new URLSearchParams(search);
  const state = { ...DEFAULTS };
  for (const key of KEYS) {
    const value = params.get(key);
    if (value) state[key] = value;
  }
  if (!/^[A-Z]{3}$/.test(state.country)) state.country = 'all';
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
