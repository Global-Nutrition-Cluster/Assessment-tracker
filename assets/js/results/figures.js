// Results page: which figure stands for each country (shared by the map and the ranked list).
// Rules from CLAUDE.md 11.3 and 11.4.5:
//   - national figure of the general population only (Rapid SMART IDP sites stay in the country profile);
//   - the 6–59 months figure when 0–59 is also given (the others carry alt = true, rule 11.3.4);
//   - per source, the most recent survey; with Source = All, the most recent of SMART and DHS,
//     SMART first when both have the same survey year;
//   - a country with only subnational values for the indicator is "subnational only".

import { matchSource } from './data.js';

export const CURRENT_YEAR = new Date().getFullYear();

export const WHO_CLASSES = ['Very low', 'Low', 'Medium', 'High', 'Very high'];

/** Rule 11.3.5: the age of the data, from the survey year only (never a planning date). */
export function isOlderThan3Years(surveyYear, currentYear = CURRENT_YEAR) {
  return Boolean(surveyYear) && currentYear - surveyYear > 3;
}

/** Rule 11.3.7: index 0–4 of the WHO 2018 class, or null when the indicator has no classes. */
export function whoClass(indicator, value) {
  if (!indicator?.classes || value == null) return null;
  const index = indicator.classes.findIndex((threshold) => value < threshold);
  return index === -1 ? indicator.classes.length : index;
}

/** Thresholds as legend labels: "< 2.5%", "2.5–<5", … "≥ 15". */
export function classLabels(indicator) {
  const t = indicator.classes;
  return WHO_CLASSES.map((name, i) => {
    if (i === 0) return `${name} < ${t[0]}%`;
    if (i === t.length) return `${name} ≥ ${t[i - 1]}`;
    return `${name} ${t[i - 1]}–<${t[i]}`;
  });
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

/** Five equal steps between the smallest and largest national value, for indicators without WHO classes. */
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
