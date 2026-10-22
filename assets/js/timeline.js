// Timeline (Gantt) in plain HTML: one row per survey, grouped by country, 18 months
// (the 6 months before the current month + the next 12). Start and end dates are indicative:
// they only place the bars. A survey without an end date is drawn as a one-month block
// (no diamond, no "no end date" label — decision of the owner, CLAUDE.md section 5).
// On phones the chart is replaced by a list grouped by start month (CSS switches the two).

import { statusIcon, STATUS_LABELS } from './icons.js';
import { formatDate, shortCountry } from './format.js';
import { escapeHtml } from './filters.js';

const MONTHS_BEFORE = 6;
const MONTH_COUNT = 18;
const ROWS_BEFORE_COLLAPSE = 4;
const ACTIVITY_RANK = { ongoing: 0, planned: 1, completed: 2, released: 3 };
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// --- dates (UTC, so the day never shifts with the time zone) -------------------

const utc = (iso) => Date.parse(`${iso}T00:00:00Z`);
const addMonths = (time, n) => { const d = new Date(time); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1); };
const monthLabel = (time) => { const d = new Date(time); return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };

/** First day of the window and first day after it, around `today`. */
export function timeWindow(today = new Date()) {
  const thisMonth = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1);
  const start = addMonths(thisMonth, -MONTHS_BEFORE);
  return { start, end: addMonths(start, MONTH_COUNT) };
}

/** Bar span of a survey: start to end, or one month from the start when there is no end date. */
export function span(survey) {
  if (!survey.start_date) return null;
  const from = utc(survey.start_date);
  const to = survey.end_date ? Math.max(utc(survey.end_date), from) : addMonths(from, 1);
  return { from, to };
}

/**
 * @param {HTMLElement} root
 * @param {(survey, opener) => void} onOpen
 */
export function createTimeline(root, onOpen) {
  const expanded = new Set(); // countries whose long list is opened
  let surveys = [];

  root.innerHTML = `
    <div class="card-head">
      <h2>Timeline</h2>
      <span class="card-note" id="tl-note"></span>
    </div>
    <div class="tl-scroll"><div class="tl" role="group" aria-label="Timeline of surveys by country"></div></div>
    <div class="tl-mobile"></div>
    <ul class="legend tl-legend" aria-label="Timeline legend">
      ${['planned', 'ongoing', 'completed', 'released'].map((k) => `<li><span class="swatch swatch-${k}"></span>${STATUS_LABELS[k]}</li>`).join('')}
    </ul>
    <p class="card-note tl-footnote" id="tl-footnote"></p>`;

  root.addEventListener('click', (event) => {
    const more = event.target.closest('[data-more]');
    if (more) {
      const iso3 = more.dataset.more;
      if (expanded.has(iso3)) expanded.delete(iso3); else expanded.add(iso3);
      draw();
      return;
    }
    const item = event.target.closest('[data-id]');
    if (!item) return;
    const survey = surveys.find((s) => s.id === item.dataset.id);
    if (survey) onOpen(survey, item);
  });

  function draw(today = new Date()) {
    const win = timeWindow(today);
    const width = win.end - win.start;
    const pct = (time) => Math.min(100, Math.max(0, ((time - win.start) / width) * 100));

    // Surveys with a start date whose bar overlaps the window ("Not planned" is not on the timeline)
    const shown = surveys.filter((s) => {
      if (!(s.display_status in ACTIVITY_RANK)) return false;
      const sp = span(s);
      return sp && sp.from < win.end && sp.to >= win.start;
    });
    const undated = surveys.filter((s) => s.display_status in ACTIVITY_RANK && !s.start_date).length;

    // Group by country, countries alphabetically, rows by activity then ID
    const groups = new Map();
    for (const s of shown) {
      if (!groups.has(s.iso3)) groups.set(s.iso3, []);
      groups.get(s.iso3).push(s);
    }
    const ordered = [...groups.values()]
      .sort((a, b) => (a[0].country || '').localeCompare(b[0].country || ''))
      .map((rows) => rows.sort((a, b) => ACTIVITY_RANK[a.display_status] - ACTIVITY_RANK[b.display_status] || a.id.localeCompare(b.id)));

    // Month header: year above January and the first month, then the month initial
    const months = Array.from({ length: MONTH_COUNT }, (_, i) => addMonths(win.start, i));
    const header = months.map((m, i) => {
      const d = new Date(m);
      const showYear = i === 0 || d.getUTCMonth() === 0;
      return `<div class="tl-month${d.getUTCMonth() === 0 ? ' tl-jan' : ''}" title="${monthLabel(m)}">
        <span class="tl-year">${showYear ? d.getUTCFullYear() : ''}</span>${'JFMAMJJASOND'[d.getUTCMonth()]}</div>`;
    }).join('');

    const body = ordered.map((rows) => {
      const iso3 = rows[0].iso3;
      const collapsible = rows.length > ROWS_BEFORE_COLLAPSE;
      const open = expanded.has(iso3);
      const visible = collapsible && !open ? rows.slice(0, ROWS_BEFORE_COLLAPSE) : rows;
      return `<div class="tl-group">
        <div class="tl-country">${escapeHtml(shortCountry(rows[0].country))}${rows.length > 1 ? ` (${rows.length})` : ''}</div>
        ${visible.map((s) => rowHtml(s, pct, win)).join('')}
        ${collapsible ? `<button type="button" class="tl-more" data-more="${escapeHtml(iso3)}" aria-expanded="${open}">${open ? 'Show fewer' : `Show ${rows.length - ROWS_BEFORE_COLLAPSE} more surveys`}</button>` : ''}
      </div>`;
    }).join('');

    const chart = root.querySelector('.tl');
    chart.innerHTML = shown.length ? `
      <div class="tl-head"><div class="lbl tl-label-col">Country / survey</div><div class="tl-months">${header}</div></div>
      <div class="tl-body">
        <div class="tl-grid" aria-hidden="true"></div>
        <div class="tl-today" aria-hidden="true" style="left: calc(var(--tl-label) + (100% - var(--tl-label)) * ${pct(today.getTime()) / 100})"></div>
        ${body}
      </div>`
      : '<p class="tl-empty">No survey with dates in this period for the current filters.</p>';

    root.querySelector('.tl-mobile').innerHTML = mobileList(shown, win);

    root.querySelector('#tl-note').textContent =
      `${monthLabel(win.start)} – ${monthLabel(addMonths(win.end, -1))} · ${shown.length} survey${shown.length === 1 ? '' : 's'} · dashed line = today`;
    root.querySelector('#tl-footnote').textContent = undated
      ? `${undated} survey${undated === 1 ? ' has' : 's have'} no start date and ${undated === 1 ? 'appears' : 'appear'} only in the survey list. Dates are indicative.`
      : 'Dates are indicative.';
  }

  function rowHtml(s, pct, win) {
    const sp = span(s);
    const left = pct(sp.from);
    const right = pct(sp.to);
    const cutLeft = sp.from < win.start;
    const cutRight = sp.to > win.end;
    const short = s.id.replace(/^[A-Z]{3}-\d{4}-/, '') + (s.admin1 ? ` · ${s.admin1}` : '');
    const dates = s.end_date ? `${formatDate(s.start_date)} to ${formatDate(s.end_date)}` : `from ${formatDate(s.start_date)}`;
    const label = `${s.id}, ${STATUS_LABELS[s.display_status]}, indicative dates ${dates}`;
    return `<div class="tl-row">
      <button type="button" class="tl-name" data-id="${escapeHtml(s.id)}" title="${escapeHtml(label)}">
        ${statusIcon(s.display_status, 12)}<span>${escapeHtml(short)}</span>
      </button>
      <div class="tl-track">
        <button type="button" class="tl-bar tl-${s.display_status}${cutLeft ? ' cut-left' : ''}${cutRight ? ' cut-right' : ''}"
          data-id="${escapeHtml(s.id)}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}"
          style="left:${left.toFixed(2)}%;width:${Math.max(right - left, 0.9).toFixed(2)}%"></button>
      </div>
    </div>`;
  }

  // Phone version: surveys grouped by start month (earlier starts under the first month)
  function mobileList(shown, win) {
    if (!shown.length) return '<p class="tl-empty">No survey with dates in this period for the current filters.</p>';
    const byMonth = new Map();
    for (const s of shown) {
      const from = Math.max(span(s).from, win.start);
      const key = addMonths(from, 0);
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key).push(s);
    }
    return [...byMonth.keys()].sort((a, b) => a - b).map((key) => `
      <h3 class="tl-m-month">${key === win.start ? `${monthLabel(key)} or earlier` : monthLabel(key)}</h3>
      <ul class="tl-m-list">
        ${byMonth.get(key).sort((a, b) => (a.country || '').localeCompare(b.country || '')).map((s) => `
          <li><button type="button" class="tl-m-item" data-id="${escapeHtml(s.id)}">
            ${statusIcon(s.display_status, 14)}
            <span><strong>${escapeHtml(shortCountry(s.country))}</strong> · ${escapeHtml(s.id)}${s.admin1 ? ` · ${escapeHtml(s.admin1)}` : ''}
            <span class="mute">${STATUS_LABELS[s.display_status]} · ${s.end_date ? `${formatDate(s.start_date)} – ${formatDate(s.end_date)}` : `from ${formatDate(s.start_date)}`}</span></span>
          </button></li>`).join('')}
      </ul>`).join('');
  }

  return function update(list) {
    surveys = list;
    draw();
  };
}
