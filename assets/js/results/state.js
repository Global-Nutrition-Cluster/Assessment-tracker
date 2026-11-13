// Results page state <-> URL, so a view can be shared by link (CLAUDE.md 11.4).
// Example: results.html?indicator=STUNT&source=dhs#country=MLI
// Values equal to the defaults are left out of the URL to keep links short.

export const DEFAULTS = Object.freeze({
  indicator: 'GAM_WHZ',   // an indicator key of data/results.json
  source: 'all',          // 'all' | 'smart' | 'dhs'
  country: null,          // ISO3 of the open country profile, or null
});

const SOURCES = ['all', 'smart', 'dhs'];

/**
 * @param {Set<string>} indicatorKeys  keys of the selector indicators, to drop unknown ones
 */
export function readState(indicatorKeys, location = window.location) {
  const params = new URLSearchParams(location.search);
  const state = { ...DEFAULTS };

  const indicator = params.get('indicator');
  if (indicator && indicatorKeys.has(indicator)) state.indicator = indicator;

  const source = (params.get('source') || '').toLowerCase();
  if (SOURCES.includes(source)) state.source = source;

  const country = new URLSearchParams(location.hash.slice(1)).get('country');
  if (country && /^[A-Za-z]{3}$/.test(country)) state.country = country.toUpperCase();

  return state;
}

export function writeState(state) {
  const params = new URLSearchParams();
  if (state.indicator !== DEFAULTS.indicator) params.set('indicator', state.indicator);
  if (state.source !== DEFAULTS.source) params.set('source', state.source);
  const query = params.toString();
  const hash = state.country ? `#country=${state.country}` : '';
  window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${hash}`);
}
