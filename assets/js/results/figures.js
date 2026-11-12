// Results page: which figure stands for each country (shared by the map and the ranked list).
// Rules from CLAUDE.md 11.3 and 11.4.5:
//   - national figure of the general population only (Rapid SMART IDP sites stay in the country profile);
//   - the 6–59 months figure when 0–59 is also given (the others carry alt = true, rule 11.3.4);
//   - per source, the most recent survey; with Source = All, the most recent of SMART and DHS,
//     SMART first when both have the same survey year;
//   - a country with only subnational values for the indicator is "subnational only".

import { matchSource } from './data.js';
import { escapeHtml } from '../filters.js';

export const CURRENT_YEAR = new Date().getFullYear();

/** Rule 11.3.5: the age of the data, from the survey year only (never a planning date). */
export function isOlderThan3Years(surveyYear, currentYear = CURRENT_YEAR) {
  return Boolean(surveyYear) && currentYear - surveyYear > 3;
}

// --- Phases (rule 11.3.7) --------------------------------------------------------------
// Each indicator's phases come from the "Dashboard indicators" Google Sheet:
// indicator.phases = { source: 'WHO 2018', thresholds: [2.5, 5, 10, 15], labels: ['Very low', …] },
// or null when the sheet says "none". 2 to 5 phases; a value equal to a threshold goes to the next phase.
// phases.colours = the colour step of each phase (see build_results.py, phase_colours).

/** Colour step (0–4, lightest to darkest) of phase i, set by build_results.py (phase_colours):
 *  the same phase number has the same colour on every indicator; reversed when a higher value is better. */
function phaseColour(phases, i) {
  return phases.colours?.at(i) ?? i;
}

/** { index, label, colour } of a value, or null when the indicator has no phases. */
export function phaseOf(indicator, value) {
  const phases = indicator?.phases;
  if (!phases || value == null) return null;
  const found = phases.thresholds.findIndex((threshold) => value < threshold);
  const index = found === -1 ? phases.thresholds.length : found;
  return { index, label: phases.labels.at(index), colour: phaseColour(phases, index) };
}

/** Legend items: "Very low < 2.5", "Low 2.5–<5", … "Very high ≥ 15", with their colour step. */
export function phaseLegend(indicator) {
  const { thresholds: t, labels } = indicator.phases;
  return labels.map((name, i) => {
    let range;
    if (i === 0) range = `< ${t[0]}`;
    else if (i === t.length) range = `≥ ${t[i - 1]}`;
    else range = `${t[i - 1]}–<${t[i]}`;
    return { text: `${name} ${range}`, colour: phaseColour(indicator.phases, i) };
  });
}

/** Pill with the phase name, coloured like the map ('' when the indicator has no phases). */
export function phasePill(indicator, value) {
  const phase = phaseOf(indicator, value);
  return phase ? `<span class="sev sev-${phase.colour}">${escapeHtml(phase.label)}</span>` : '';
}

/** Value as published, with its unit. Percentages get one decimal (10 -> 10.0%), nothing is rounded away. */
export function formatValue(value, unit) {
  if (value == null) return '';
  const digits = String(value).split('.')[1]?.length || 0;
  const text = value.toLocaleString('en-GB', {
    minimumFractionDigits: unit === '%' ? Math.max(1, digits) : digits,
    maximumFractionDigits: 6,
  });
  return unit === '%' ? `${text}%` : text;
}

export function formatCi(v) {
  if (v.ci_lower == null || v.ci_upper == null) return '';
  return `${formatValue(v.ci_lower, '')}–${formatValue(v.ci_upper, '')}`;
}

function surveyYear(value, surveysById) {
  return surveysById.get(value.survey)?.survey_year ?? null;
}

/** Most recent survey first; SMART before DHS for the same year. */
function newestFirst(a, b) {
  return (b.year ?? 0) - (a.year ?? 0) || (a.value.source === 'SMART' ? -1 : 1) - (b.value.source === 'SMART' ? -1 : 1);
}

/**
 * Figure of every country for one indicator and one source setting.
 * @returns {Map<string, object>} iso3 -> {
 *   main:   { value, year, survey } | null   national figure shown on the map and in the list
 *   others: [{ value, year, survey }]        the other source's national figure ("Also:" line), Source = All only
 *   subnational: { source, year, survey, areas } | null   when there is no national figure
 *   noData: true when the country has surveys for this source but none gives this indicator
 * }
 */
export function countryFigures(data, indicatorKey, source, surveysById) {
  const figures = new Map();
  const get = (iso3) => {
    if (!figures.has(iso3)) figures.set(iso3, { main: null, others: [], subnational: null, noData: false });
    return figures.get(iso3);
  };

  // Countries that have at least one survey for the chosen source ("no data for this indicator" vs "no survey")
  for (const s of data.surveys) if (matchSource(s, source) && s.iso3) get(s.iso3);

  const national = new Map();     // iso3 -> candidates
  const subnational = new Map();  // iso3 -> candidates
  for (const v of data.values) {
    if (v.indicator !== indicatorKey || !matchSource(v, source) || v.alt) continue;
    if (v.population && v.population !== 'General population') continue;
    const item = { value: v, year: surveyYear(v, surveysById), survey: surveysById.get(v.survey) };
    const bucket = v.area_level === 'National' ? national : subnational;
    if (!bucket.has(v.iso3)) bucket.set(v.iso3, []);
    bucket.get(v.iso3).push(item);
  }

  for (const [iso3, items] of national) {
    items.sort(newestFirst);
    const figure = get(iso3);
    figure.main = items[0];
    // "Also:" = the newest figure of each other source
    const seen = new Set([items[0].value.source]);
    for (const item of items.slice(1)) {
      if (!seen.has(item.value.source)) { figure.others.push(item); seen.add(item.value.source); }
    }
  }

  for (const [iso3, items] of subnational) {
    items.sort(newestFirst);
    const newest = items[0];
    const areas = items.filter((i) => i.value.survey === newest.value.survey).length;
    const figure = get(iso3);
    const sub = { source: newest.value.source, year: newest.year, survey: newest.survey, areas };
    if (!figure.main) figure.subnational = sub;
    else if (!figure.others.some((o) => o.value.source === sub.source) && sub.source !== figure.main.value.source) {
      figure.others.push({ subnationalOnly: true, ...sub });
    }
  }

  for (const figure of figures.values()) figure.noData = !figure.main && !figure.subnational;
  return figures;
}

/** Five equal steps between the smallest and largest national value, for indicators without phases. */
export function continuousSteps(figures) {
  const values = [...figures.values()].filter((f) => f.main).map((f) => f.main.value.value);
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const step = (max - min) / 5 || 1;
  return { min, max, limits: [1, 2, 3, 4].map((i) => min + step * i) };
}

export function continuousIndex(steps, value) {
  const index = steps.limits.findIndex((limit) => value < limit);
  return index === -1 ? 4 : index;
}
