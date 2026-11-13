// Country profile (CLAUDE.md 11.4.8): every survey and every value of one country, under the map.
// Opened by a click on the map or the ranked list; shareable as results.html#country=MLI.
//
// Layout, from the Mali and Niger mockups in design/results/:
//   1. title, Copy link, Close (no "older than 3 years" banner since 13 Nov 2026: the age shows on the map legend only)
//   2. survey cards: one per SMART survey (+ its Rapid SMART component), DHS (or "No recent survey")
//   3. indicator group tabs (Acute malnutrition, Mortality, Morbidity, Stunting, Underweight)
//   4. per SMART survey: a dot plot of one indicator by area (national, admin 1 › admin 2, 95% CI),
//      with a toggle between the indicators of the group, and every indicator of the group in a table
//   5. Rapid SMART IDP sites in their own block; DHS national figures as tiles
//   6. DHS "More indicators" (folded), "Notes from the data"
// Values are shown as published; every value carries the "As published" badge (rule 11.3.6).

import { escapeHtml } from '../filters.js';
import { phaseOf, phasePill, formatValue, formatCi } from './figures.js';

const TABS = [
  { key: 'acute', label: 'Acute malnutrition', groups: ['Acute malnutrition', 'Overweight'] },
  { key: 'mortality', label: 'Mortality', groups: ['Mortality'] },
  { key: 'morbidity', label: 'Morbidity', groups: ['Morbidity'] },
  { key: 'stunting', label: 'Stunting', groups: ['Stunting'] },
  { key: 'underweight', label: 'Underweight', groups: ['Underweight'] },
];
const GENERAL = 'General population';
const LEVEL_ORDER = { National: 0, 'Admin 1': 1, 'Admin 2': 2, Stratum: 2 };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// --- small formatting helpers ------------------------------------------------------------

/** '2022-06-06' -> '6 Jun 2022'; '2022-02' -> 'Feb 2022'. Parsed by hand: no time-zone shift. */
function formatDay(text) {
  if (!text) return '';
  const [y, m, d] = text.split('-').map(Number);
  return d ? `${d} ${MONTHS[m - 1]} ${y}` : `${MONTHS[m - 1]} ${y}`;
}

/** Data collection period: '6 Jun – 12 Jul 2022' (year shown once when it is the same). */
function formatPeriod(start, end) {
  if (!start && !end) return '';
  if (!start || !end) return formatDay(start || end);
  const a = formatDay(start);
  const b = formatDay(end);
  return start.slice(0, 4) === end.slice(0, 4) ? `${a.replace(` ${start.slice(0, 4)}`, '')} – ${b}` : `${a} – ${b}`;
}

const esc = escapeHtml;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const pill = phasePill;   // phase name, coloured like the map (rule 11.3.7)

// --- the profile ----------------------------------------------------------------------------

/**
 * @param {HTMLElement} root
 * @param {{onClose: () => void}} handlers
 */
export function createProfile(root, { onClose }) {
  const ui = { tab: 'acute' };
  let current = null; // { iso3, data, indicators }

  root.addEventListener('click', (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.id === 'profile-close') onClose();
    else if (target.id === 'profile-copy') copyLink(target);
    else if (target.dataset.tab) { ui.tab = target.dataset.tab; draw(); focusTab(); }
    else if (target.dataset.plot) { plotChoice.set(target.dataset.block, target.dataset.plot); draw(); }
  });
  // Arrow keys move between tabs (WAI-ARIA tabs pattern)
  root.addEventListener('keydown', (event) => {
    if (!event.target.matches('[role="tab"]') || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const tabs = [...root.querySelectorAll('[role="tab"]')];
    const next = tabs[(tabs.indexOf(event.target) + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    ui.tab = next.dataset.tab;
    draw();
    focusTab();
  });

  function focusTab() {
    root.querySelector('[role="tab"][aria-selected="true"]')?.focus();
  }

  /**
   * @param {string|null} iso3
   * @param {object} data        data/results.json
   * @param {Map} indicators     key -> indicator
   */
  return function update(iso3, data, indicators) {
    if (!iso3) { root.hidden = true; root.innerHTML = ''; current = null; return; }
    if (current?.iso3 !== iso3) { ui.tab = 'acute'; plotChoice.clear(); }
    current = { iso3, data, indicators };
    root.hidden = false;
    draw();
  };

  function draw() {
    const { iso3, data, indicators } = current;
    const name = data.countries[iso3] || iso3;
    const surveys = data.surveys.filter((s) => s.iso3 === iso3)
      .sort((a, b) => (b.survey_year ?? 0) - (a.survey_year ?? 0));
    const values = data.values.filter((v) => v.iso3 === iso3);

    if (!surveys.length) {
      root.innerHTML = `${headerHtml(name, 'No survey results in the tracker for this country.')}`;
      return;
    }

    const tabs = TABS.filter((t) => values.some((v) => t.groups.includes(indicators.get(v.indicator)?.group)));
    if (!tabs.some((t) => t.key === ui.tab)) ui.tab = tabs[0]?.key;
    const tab = tabs.find((t) => t.key === ui.tab);

    root.innerHTML = `
      ${headerHtml(name, subtitle(surveys, values))}
      <h3 class="pf-h">Surveys</h3>
      <div class="pf-cards">${surveyCards(name, surveys, values)}</div>
      ${tabs.length ? `
        <div class="pf-tabs" role="tablist" aria-label="Indicator groups">
          ${tabs.map((t) => `<button type="button" role="tab" id="tab-${t.key}" data-tab="${t.key}" aria-controls="pf-panel"
            aria-selected="${t.key === ui.tab}" tabindex="${t.key === ui.tab ? 0 : -1}">${t.label}</button>`).join('')}
        </div>
        <div class="pf-panel" id="pf-panel" role="tabpanel" aria-labelledby="tab-${ui.tab}">
          ${tabPanel(tab, surveys, values, indicators)}
        </div>` : ''}
      ${moreIndicators(surveys, values, indicators)}
      ${notes(surveys, values, tab, indicators)}`;
  }
}

// --- header, banner, survey cards ---------------------------------------------------------

function headerHtml(name, sub) {
  return `
    <div class="pf-head">
      <div>
        <div class="lbl">Country profile</div>
        <h2 id="profile-title">${esc(name)}</h2>
        <p class="pf-sub">${esc(sub)}</p>
      </div>
      <div class="pf-actions">
        <button type="button" class="btn btn-small" id="profile-copy">Copy link</button>
        <button type="button" class="btn btn-small" id="profile-close" aria-label="Close the ${esc(name)} profile">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M1 1l10 10M11 1 1 11" stroke="currentColor" stroke-width="1.6"></path></svg>
          Close
        </button>
      </div>
    </div>`;
}

function subtitle(surveys, values) {
  const sources = new Set(surveys.map((s) => s.source));
  const levels = [];
  if (values.some((v) => v.area_level === 'National' && v.population === GENERAL)) levels.push('national');
  for (const [level, label] of [['Admin 1', 'admin 1'], ['Admin 2', 'admin 2'], ['Stratum', 'strata']]) {
    if (values.some((v) => v.area_level === level && v.population === GENERAL)) levels.push(label);
  }
  if (values.some((v) => v.population && v.population !== GENERAL)) levels.push('IDP sites');
  return `${plural(surveys.length, 'survey')} from ${plural(sources.size, 'source')} · ${levels.join(', ') || 'no area'}`;
}

function badge(source) {
  return `<span class="src src-${esc(source).toLowerCase()}">${esc(source)}</span>`;   // colour per source (soft.css)
}

function reportLink(url, label = 'Report') {
  return url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${label}<span class="visually-hidden"> (opens in a new tab)</span></a>` : '';
}

function surveyCards(countryName, surveys, values) {
  const cards = [];
  for (const s of surveys.filter((x) => x.source === 'SMART')) {
    const period = formatPeriod(s.start_date, s.end_date);
    cards.push(`
      <article class="pf-card">
        <div class="pf-card-top">${badge('SMART')}<strong>${s.survey_year ?? ''}</strong></div>
        <h4>${esc(s.title || s.id)}</h4>
        ${s.lead_org ? `<p>${esc(s.lead_org)}</p>` : ''}
        <p class="mute">${[period && `Data collection ${esc(period)}`, s.coverage && esc(s.coverage)].filter(Boolean).join(' · ')}</p>
        <div class="pf-card-foot">${reportLink(s.report_url)}<span class="rev">As published</span></div>
      </article>`);

    // Rapid SMART component (IDP sites) of the same survey, as in the Mali mockup
    const rapid = values.filter((v) => v.survey === s.id && v.type === 'Rapid SMART');
    if (rapid.length) {
      const places = [...new Set(rapid.filter((v) => v.area_level !== 'National').map((v) => v.area))];
      cards.push(`
        <article class="pf-card">
          <div class="pf-card-top">${badge('RAPID SMART')}<strong>${s.survey_year ?? ''}</strong><span class="pf-tag">IDPs in sites</span></div>
          <h4>Rapid SMART component in IDP displacement sites</h4>
          <p>Same survey and lead as the SMART ${s.survey_year ?? ''}</p>
          <p class="mute">${[period && `Data collection ${esc(period)}`, places.length && `IDP sites: ${esc(places.join(', '))}`].filter(Boolean).join(' · ')}</p>
          <div class="pf-card-foot">${reportLink(s.report_url, 'Report (same document)')}<span class="rev">As published</span></div>
        </article>`);
    }
  }

  const dhs = surveys.filter((x) => x.source === 'DHS');
  for (const s of dhs) {
    const released = s.release_date ? `Released ${formatDay(s.release_date)}` : '';
    const retrieved = s.retrieval_date ? `retrieved ${formatDay(s.retrieval_date)}` : '';
    cards.push(`
      <article class="pf-card">
        <div class="pf-card-top">${badge('DHS')}<strong>${s.survey_year ?? ''}</strong><span class="pf-tag">${esc(s.id)}</span></div>
        <h4>${esc(s.title || s.id)}</h4>
        ${s.lead_org ? `<p>${esc(s.lead_org)}</p>` : ''}
        <p class="mute">${[released, retrieved].filter(Boolean).join(' · ')}</p>
        <p class="mute">National only · 0–59 months for child indicators</p>
        <div class="pf-card-foot">${reportLink(s.report_url, 'DHS Program survey page')}<span class="rev">As published</span></div>
      </article>`);
  }
  if (!dhs.length) {
    cards.push(`
      <article class="pf-card pf-card-empty">
        <div class="pf-card-top">${badge('DHS')}<strong>No recent survey</strong></div>
        <p class="mute">No standard DHS published for ${esc(countryName)} from 2020 onwards.</p>
      </article>`);
  }
  return cards.join('');
}

// --- one tab ----------------------------------------------------------------------------

function tabPanel(tab, surveys, values, indicators) {
  const inTab = (v) => tab.groups.includes(indicators.get(v.indicator)?.group);
  const blocks = [];

  for (const s of surveys.filter((x) => x.source === 'SMART')) {
    const general = values.filter((v) => v.survey === s.id && inTab(v) && (v.population || GENERAL) === GENERAL);
    if (general.length) {
      blocks.push(smartBlock({
        key: s.id, survey: s, values: general, indicators, source: 'SMART',
        title: `SMART ${s.survey_year ?? ''} · General population`,
      }));
    }
    const idp = values.filter((v) => v.survey === s.id && inTab(v) && v.population && v.population !== GENERAL);
    if (idp.length) {
      blocks.push(smartBlock({
        key: `${s.id}-idp`, survey: s, values: idp, indicators, source: 'RAPID SMART',
        title: `Rapid SMART ${s.survey_year ?? ''} · IDPs in displacement sites`,
        note: 'Shown apart from the general population: small samples, very wide confidence intervals. Interpret with caution.',
      }));
    }
  }

  for (const s of surveys.filter((x) => x.source === 'DHS')) {
    const dhs = values.filter((v) => v.survey === s.id && inTab(v) && indicators.get(v.indicator)?.selector);
    if (dhs.length) blocks.push(dhsBlock(s, dhs, indicators, surveys));
  }

  return blocks.join('') || '<p class="mute">No results for this group of indicators.</p>';
}

/** Indicators of a block, in the order of the indicator list, with the number of areas for each. */
function blockIndicators(values, indicators) {
  const order = [...indicators.keys()];
  return [...new Set(values.map((v) => v.indicator))].sort((a, b) => order.indexOf(a) - order.indexOf(b))
    .map((key) => indicators.get(key));
}

/** Areas of a block: national first, then admin 1, each followed by its admin 2 / strata. */
function areaRows(values) {
  const seen = new Map();
  for (const v of values) {
    const key = `${v.area_level}|${v.parent_area || ''}|${v.area}`;
    if (!seen.has(key)) seen.set(key, { key, area: v.area, level: v.area_level, parent: v.parent_area || null });
  }
  return [...seen.values()];
}

function orderAreas(rows, valueOf) {
  const byValue = (a, b) => (valueOf(b) ?? -Infinity) - (valueOf(a) ?? -Infinity) || a.area.localeCompare(b.area);
  const national = rows.filter((r) => r.level === 'National');
  const tops = rows.filter((r) => (LEVEL_ORDER[r.level] ?? 1) === 1).sort(byValue);
  const children = rows.filter((r) => (LEVEL_ORDER[r.level] ?? 1) === 2);
  const ordered = [...national];
  for (const top of tops) {
    ordered.push(top);
    ordered.push(...children.filter((c) => c.parent === top.area).sort(byValue));
  }
  // children whose parent has no row of its own (e.g. strata of a split province)
  const placed = new Set(ordered);
  const orphans = children.filter((c) => !placed.has(c)).sort((a, b) => (a.parent || '').localeCompare(b.parent || '') || byValue(a, b));
  return [...ordered, ...orphans];
}

function smartBlock({ key, survey, values, indicators, source, title, note }) {
  const main = values.filter((v) => !v.alt);
  const alt = values.filter((v) => v.alt);
  const inds = blockIndicators(main, indicators);
  if (!inds.length) return '';

  const ages = [...new Set(main.map((v) => v.age_group).filter(Boolean))];
  const levels = [...new Set(main.map((v) => v.area_level))].sort((a, b) => (LEVEL_ORDER[a] ?? 1) - (LEVEL_ORDER[b] ?? 1));

  const chosen = currentPlot(key, inds, main);
  const toggle = inds.length > 1 ? `
    <div class="segmented pf-plot-toggle" role="group" aria-label="Indicator shown in the chart">
      ${inds.map((i) => `<button type="button" data-block="${esc(key)}" data-plot="${esc(i.key)}" aria-pressed="${i.key === chosen.key}">${esc(shortName(i))}</button>`).join('')}
    </div>` : '';

  return `
    <section class="pf-block" aria-label="${esc(title)}">
      <div class="pf-block-head">
        <h3>${badge(source)} ${esc(title)}</h3>
        <span class="pf-tag">${esc(levels.join(' + '))}</span>
        ${ages.length ? `<span class="mute pf-ages">${esc(ages.join(', '))}</span>` : ''}
        ${toggle}
      </div>
      ${note ? `<p class="pf-note">${esc(note)}</p>` : ''}
      ${dotPlot(main.filter((v) => v.indicator === chosen.key), chosen)}
      ${blockTable(main, inds, survey)}
      ${alt.length ? altLine(alt, indicators) : ''}
    </section>`;

  function currentPlot(blockKey, list, vals) {
    // default: the first indicator with the most areas (GAM by WHZ, CDR, stunting…)
    const wanted = list.find((i) => i.key === plotChoice.get(blockKey));
    if (wanted) return wanted;
    const count = (i) => vals.filter((v) => v.indicator === i.key).length;
    return list.reduce((best, i) => (count(i) > count(best) ? i : best), list[0]);
  }
}

// Indicator plotted in each block (block key -> indicator key), set by the toggle above the chart.
// Cleared when another country is opened.
const plotChoice = new Map();

function shortName(indicator) {
  return indicator.label.replace(/ \((SMART|DHS)\)$/, '').replace('Wasting — ', '').replace('by weight-for-height (WHZ)', 'by WHZ')
    .replace(' (WHZ or MUAC)', '');
}

// --- dot plot (HTML, no chart library): one row per area, dot = value, line = 95% CI ------------

/** Round axis: about 5 ticks at 1, 2, 2.5 or 5 × 10^k (0, 5, 10, 15, 20, 25 for wasting). */
function niceAxis(top) {
  const raw = (top > 0 ? top : 1) / 5;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * power).find((s) => s >= raw);
  const max = Math.ceil(top / step) * step || step;
  const ticks = [];
  for (let t = 0; t <= max + step / 2; t += step) ticks.push(+t.toPrecision(6));
  return { max, ticks };
}

function dotPlot(values, indicator) {
  if (!values.length) return '';
  const top = Math.max(...values.map((v) => Math.max(v.value, v.ci_upper ?? v.value)));
  const { max, ticks } = niceAxis(top);
  const pct = (x) => `${Math.min(100, Math.max(0, (x / max) * 100)).toFixed(2)}%`;

  const byKey = new Map(values.map((v) => [`${v.area_level}|${v.parent_area || ''}|${v.area}`, v]));
  const rows = orderAreas(areaRows(values), (r) => byKey.get(r.key)?.value);
  const national = values.find((v) => v.area_level === 'National');
  const unit = indicator.unit === '%' ? '%' : indicator.unit;

  const rowHtml = rows.map((r) => {
    const v = byKey.get(r.key);
    const cls = phaseOf(indicator, v.value)?.cls ?? null;
    const child = (LEVEL_ORDER[r.level] ?? 1) === 2;
    const ci = v.ci_lower != null && v.ci_upper != null
      ? `<span class="dp-ci" style="left:${pct(v.ci_lower)};width:calc(${pct(v.ci_upper)} - ${pct(v.ci_lower)})"></span>` : '';
    return `<div class="dp-row${r.level === 'National' ? ' is-national' : ''}${child ? ' is-child' : ''}">
      <div class="dp-label"><span class="pf-level">${esc(r.level)}</span>${esc(r.area)}</div>
      <div class="dp-track">
        ${national ? `<span class="dp-nat" style="left:${pct(national.value)}"></span>` : ''}
        ${ci}<span class="dp-dot ${cls == null ? 'dp-neutral' : cls}" style="left:${pct(v.value)}"></span>
      </div>
      <div class="dp-value"><strong>${formatValue(v.value, indicator.unit)}</strong>${pill(indicator, v.value)}</div>
      <div class="dp-n">${v.sample != null ? v.sample.toLocaleString('en-GB') : ''}</div>
    </div>`;
  }).join('');

  const caption = `${esc(indicator.label)} by area${rows.some((r) => (LEVEL_ORDER[r.level] ?? 1) === 2) ? ', grouped admin 1 › admin 2' : ''}, with 95% CI`;
  return `
    <figure class="pf-plot">
      <figcaption>
        <span><strong>${caption}</strong></span>
        <span class="mute">${indicator.phases ? `Dots coloured by phase (${esc(indicator.phases.source)})` : 'No phases for this indicator'}${national ? ` · dashed line = national ${formatValue(national.value, indicator.unit)}` : ''}</span>
      </figcaption>
      <div class="dp" role="img" aria-label="${esc(`${indicator.label}: ${rows.length} areas. The same values are in the table below.`)}">
        <div class="dp-row dp-headrow" aria-hidden="true"><div>Area</div><div></div><div>Value</div><div>N</div></div>
        ${rowHtml}
        <div class="dp-row dp-axis" aria-hidden="true"><div></div>
          <div class="dp-ticks">${ticks.map((t) => `<span style="left:${pct(t)}">${t}</span>`).join('')}</div>
          <div class="mute">${esc(unit || '')}</div><div></div>
        </div>
      </div>
    </figure>`;
}

// --- table: every indicator of the group, every area ----------------------------------------

function blockTable(values, inds, survey) {
  const byCell = new Map(values.map((v) => [`${v.area_level}|${v.parent_area || ''}|${v.area}|${v.indicator}`, v]));
  const first = inds[0];
  const rows = orderAreas(areaRows(values), (r) => byCell.get(`${r.key}|${first.key}`)?.value);
  const head = inds.map((i) => `<th scope="col">${esc(shortName(i))}${i.unit ? `<span class="sub">${esc(i.unit)}</span>` : ''}</th>`).join('');
  const body = rows.map((r) => `<tr class="${r.level === 'National' ? 'is-national' : ''}${(LEVEL_ORDER[r.level] ?? 1) === 2 ? ' is-child' : ''}">
      <th scope="row"><span class="pf-level">${esc(r.level)}</span>${esc(r.area)}</th>
      ${inds.map((i) => {
        const v = byCell.get(`${r.key}|${i.key}`);
        if (!v) return '<td></td>';
        const ci = formatCi(v);
        const nN = v.n != null || v.sample != null ? `n/N ${v.n ?? '–'} / ${v.sample ?? '–'}` : '';
        const shown = formatValue(v.value, i.unit).replace(/%$/, '');   // the unit is in the column header
        return `<td><span class="pf-cell">${shown}${pill(i, v.value)}</span>${ci ? `<span class="sub">[${ci}]</span>` : ''}${nN ? `<span class="sub">${nN}</span>` : ''}</td>`;
      }).join('')}
    </tr>`).join('');

  return `
    <details class="pf-table">
      <summary>All indicators of this group, by area (table)</summary>
      <div class="table-scroll" tabindex="0" aria-label="Results table, scrollable">
        <table class="tbl">
          <caption class="visually-hidden">${esc(survey.title || survey.id)}: values as published, 95% CI in brackets</caption>
          <thead><tr><th scope="col">Area</th>${head}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
      <p class="pf-note">Values as published${inds.some((i) => i.unit === '%') ? ' (%)' : ''}, 95% confidence interval in brackets. <span class="rev">As published</span></p>
    </details>`;
}

/** Rule 11.3.4: the other age group (e.g. 0–59 months) is listed, not plotted. */
function altLine(alt, indicators) {
  const national = alt.filter((v) => v.area_level === 'National');
  if (!national.length) return `<p class="pf-note">${plural(alt.length, 'value')} also published for another age group (in the CSV of the source sheet).</p>`;
  const items = national.map((v) => {
    const i = indicators.get(v.indicator);
    const ci = formatCi(v);
    return `${esc(shortName(i))} ${formatValue(v.value, i.unit)}${ci ? ` [${ci}]` : ''}`;
  });
  return `<p class="pf-note">Also published for ${esc(national[0].age_group || 'another age group')} (national): ${items.join(' · ')}.</p>`;
}

// --- DHS block ------------------------------------------------------------------------------

function dhsBlock(survey, values, indicators, surveys) {
  const inds = blockIndicators(values, indicators);
  const tiles = inds.map((i) => {
    const v = values.find((x) => x.indicator === i.key);
    const ci = formatCi(v);
    return `<div class="pf-tile">
      <div class="pf-tile-label">${esc(shortName(i))}</div>
      <div class="pf-tile-value">${formatValue(v.value, i.unit)}${i.unit && i.unit !== '%' ? ` <span class="mute">${esc(i.unit)}</span>` : ''} ${pill(i, v.value)}</div>
      <div class="sub">${ci ? `95% CI ${ci}` : 'No CI published'}${v.sample != null ? ` · n = ${v.sample.toLocaleString('en-GB')}` : ''}</div>
      ${i.definition?.DHS ? `<div class="sub">${esc(i.definition.DHS)}</div>` : ''}
    </div>`;
  }).join('');

  const hasSmart = surveys.some((s) => s.source === 'SMART');
  return `
    <section class="pf-block" aria-label="DHS ${survey.survey_year ?? ''} national">
      <div class="pf-block-head">
        <h3>${badge('DHS')} DHS ${survey.survey_year ?? ''} · National</h3>
        <span class="pf-tag">National only</span>
        <span class="mute pf-ages">Children 0–59 months · as published</span>
      </div>
      <div class="pf-tiles">${tiles}</div>
      ${hasSmart ? '<p class="pf-banner pf-info"><strong>Not directly comparable with the SMART block.</strong> Different designs, age groups and definitions (DHS wasting excludes oedema; DHS mortality is per 1,000 live births over 5 years).</p>' : ''}
    </section>`;
}

/** DHS indicators outside the tabs, grouped by topic, folded (11.4.8). */
function moreIndicators(surveys, values, indicators) {
  const tabGroups = new Set(TABS.flatMap((t) => t.groups));
  const rest = values.filter((v) => v.source === 'DHS' && !tabGroups.has(indicators.get(v.indicator)?.group));
  if (!rest.length) return '';
  const survey = surveys.find((s) => s.source === 'DHS');
  const byGroup = new Map();
  for (const v of rest) {
    // DHS topics and the selector groups differ only by case ("Adult Nutrition" / "Adult nutrition")
    const raw = indicators.get(v.indicator)?.group || 'Other';
    const group = raw.charAt(0) + raw.slice(1).toLowerCase();
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group).push(v);
  }
  const sections = [...byGroup].sort(([a], [b]) => a.localeCompare(b)).map(([group, list]) => `
    <h4>${esc(group)}</h4>
    <table class="tbl pf-more">
      <tbody>${list.map((v) => {
        const i = indicators.get(v.indicator);
        const ci = formatCi(v);
        return `<tr><th scope="row">${esc(i?.label || v.indicator)}</th><td>${formatValue(v.value, i?.unit)}${i?.unit && i.unit !== '%' ? ` <span class="mute">${esc(i.unit)}</span>` : ''}${ci ? ` <span class="mute">[${ci}]</span>` : ''}</td></tr>`;
      }).join('')}</tbody>
    </table>`).join('');
  return `
    <details class="pf-more-box">
      <summary><strong>More indicators</strong> · DHS ${survey?.survey_year ?? ''}: ${esc([...byGroup.keys()].join(', ').toLowerCase())}</summary>
      <p class="pf-note">Grouped by DHS topic, national values as published.</p>
      ${sections}
    </details>`;
}

/** "Notes from the data": survey notes, then the row notes of the open tab (from the Notes column). */
function notes(surveys, values, tab, indicators) {
  const items = [];
  for (const s of surveys) if (s.notes) items.push(`${s.source} ${s.survey_year ?? ''}: ${s.notes}`);
  if (tab) {
    const rowNotes = [...new Set(values
      .filter((v) => v.note && tab.groups.includes(indicators.get(v.indicator)?.group))
      .map((v) => `${v.area}: ${v.note}`))];
    items.push(...rowNotes);
  }
  if (!items.length) return '';
  const LIMIT = 8;
  const shown = items.slice(0, LIMIT).map((t) => `<li>${esc(t)}</li>`).join('');
  const hidden = items.slice(LIMIT).map((t) => `<li>${esc(t)}</li>`).join('');
  return `
    <section class="pf-notes" aria-labelledby="pf-notes-title">
      <h3 id="pf-notes-title">Notes from the data</h3>
      <ul>${shown}</ul>
      ${hidden ? `<details><summary>${items.length - LIMIT} more notes</summary><ul>${hidden}</ul></details>` : ''}
    </section>`;
}

async function copyLink(button) {
  const url = window.location.href;
  try {
    await navigator.clipboard.writeText(url);
    button.textContent = 'Link copied';
  } catch {
    window.prompt('Copy this link:', url);   // older browsers / no clipboard permission
  }
  setTimeout(() => { button.textContent = 'Copy link'; }, 2000);
}
