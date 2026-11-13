// Survey list: one row per country (owner's decision, Nov 2026), sortable, scrolling vertically inside its card
// (no pagination, no horizontal scroll on desktop), CSV export of every listed survey.
//   - A country with ONE survey shows it directly on its row.
//   - A country with several surveys shows a summary row (types, surveys by status, funding gaps) with a
//     ▸ button that unfolds its surveys underneath. When the list is filtered to a country by a click on the
//     map, that country is unfolded.
// Rows are read-only. The Assessment ID is not shown (owner's decision, Oct 2026) but stays in the CSV export.

import { formatDate, fundingLabel, validationLabel, shortCountry, escapeHtml } from './format.js';
import { statusLabel, countByStatus, SUMMARY_ORDER, SHORT_LABELS, STATUS_LABELS } from './status-label.js';

// Order used when sorting by status: what needs attention first
const STATUS_RANK = { ongoing: 0, planned: 1, completed: 2, released: 3, not_planned: 4 };
const FUNDING_RANK = { unfunded: 0, partial: 1, funded: 2 };

const COLUMNS = [
  // To fit the half-width card without horizontal scrolling, Admin 1 sits under the country
  // and Validation under the status. Start and End come last (owner's request, Nov 2026).
  { key: 'country', label: 'Country', sortable: true },
  { key: 'type', label: 'Type', sortable: true },
  { key: 'status', label: 'Status', sortable: true },
  { key: 'lead', label: 'Lead organization' },
  { key: 'funding', label: 'Funding', sortable: true },
  { key: 'report', label: 'Report' },
  { key: 'start', label: 'Start', sortable: true },
  { key: 'end', label: 'End' },
];

// Value compared when sorting one survey by a column. Missing values go last.
function sortValue(s, key) {
  switch (key) {
    case 'country': return `${s.country || ''}|${s.admin1 || ''}`;
    case 'type': return s.type_raw || '';
    case 'status': return STATUS_RANK[s.display_status] ?? 9;
    case 'start': return s.start_date || '9999';
    case 'funding': return FUNDING_RANK[s.funding] ?? 9;
    default: return '';
  }
}

function compare(a, b, key, dir) {
  const A = sortValue(a, key);
  const B = sortValue(b, key);
  if (A < B) return -dir;
  if (A > B) return dir;
  return (a.id || '').localeCompare(b.id || '');
}

/**
 * @param {HTMLElement} root
 * @param {{onClearCountry: () => void}} handlers
 */
export function createList(root, { onClearCountry }) {
  const view = { rows: [], sortKey: 'country', sortDir: 1, expanded: new Set(), country: 'all' };

  root.innerHTML = `
    <div class="card-head">
      <div>
        <h2>Survey list</h2>
        <div class="card-note list-note"><span id="list-count"></span><span id="list-chip"></span></div>
      </div>
      <button type="button" class="btn btn-primary" id="list-export">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M2.5 13.5h11"></path></svg>
        Export CSV
      </button>
    </div>
    <div class="table-scroll" tabindex="0" aria-label="Survey list, scrollable">
      <table class="tbl tbl-grouped">
        <thead><tr></tr></thead>
        <tbody></tbody>
      </table>
    </div>
`;

  const head = root.querySelector('thead tr');
  const body = root.querySelector('tbody');

  head.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-sort]');
    if (!button) return;
    const key = button.dataset.sort;
    view.sortDir = view.sortKey === key ? -view.sortDir : 1;
    view.sortKey = key;
    draw();
  });

  // ▸ / ▾ unfolds or folds a country's surveys (no redraw, so the scroll position stays)
  body.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-toggle]');
    if (!button) return;
    const iso3 = button.dataset.toggle;
    const open = !view.expanded.has(iso3);
    if (open) view.expanded.add(iso3); else view.expanded.delete(iso3);
    button.setAttribute('aria-expanded', String(open));
    body.querySelectorAll(`tr[data-parent="${iso3}"]`).forEach((tr) => { tr.hidden = !open; });
  });

  root.querySelector('#list-chip').addEventListener('click', (event) => {
    if (event.target.closest('button')) onClearCountry();
  });

  root.querySelector('#list-export').addEventListener('click', () => exportCsv(groups().flatMap((g) => g.surveys)));

  /** Countries in the sort order, each with its surveys in the same order. */
  function groups() {
    const { sortKey, sortDir } = view;
    const byCountry = new Map();
    for (const s of view.rows) {
      const key = s.iso3 || s.country || '?';
      if (!byCountry.has(key)) byCountry.set(key, []);
      byCountry.get(key).push(s);
    }
    const list = [...byCountry].map(([key, surveys]) => {
      surveys.sort((a, b) => compare(a, b, sortKey, sortDir));
      return { key, surveys };
    });
    // A country sorts by its first survey in the chosen order (e.g. its most active status, its earliest start)
    return list.sort((a, b) => compare(a.surveys[0], b.surveys[0], sortKey, sortDir)
      || (a.surveys[0].country || '').localeCompare(b.surveys[0].country || ''));
  }

  function draw() {
    const list = groups();

    head.innerHTML = COLUMNS.map((c) => {
      if (!c.sortable) return `<th scope="col"><span class="th">${c.label}</span></th>`;
      const active = view.sortKey === c.key;
      const sort = active ? (view.sortDir === 1 ? 'ascending' : 'descending') : 'none';
      const mark = active ? (view.sortDir === 1 ? '↑' : '↓') : '↕';
      return `<th scope="col" aria-sort="${sort}"><button type="button" data-sort="${c.key}">${c.label} <span aria-hidden="true" class="mute">${mark}</span></button></th>`;
    }).join('');

    body.innerHTML = list.length
      ? list.map((g) => (g.surveys.length === 1 ? surveyRow(g.surveys[0], false) : groupRows(g, view.expanded.has(g.key)))).join('')
      : `<tr><td colspan="${COLUMNS.length}" class="empty">No survey matches the current selection.</td></tr>`;

    const surveys = view.rows.length;
    root.querySelector('#list-count').textContent =
      `${list.length} ${list.length === 1 ? 'country' : 'countries'} · ${surveys} ${surveys === 1 ? 'survey' : 'surveys'}`;
    root.querySelector('#list-export').disabled = surveys === 0;
  }

  /**
   * Called on every selection change: keep the sort, back to the top of the list.
   * @param {object[]} surveys  surveys of the selection (KPI status and map country applied)
   * @param {string} country    ISO3 chosen on the map, or 'all'
   * @param {string} [name]     that country's name (the list can be empty when a KPI tile is also selected)
   */
  return function update(surveys, country, name = country) {
    // A country chosen on the map is unfolded (when it has several surveys)
    if (country !== 'all' && country !== view.country) view.expanded.add(country);
    view.country = country;
    view.rows = surveys;

    root.querySelector('#list-chip').innerHTML = country === 'all' ? '' : `
      <span class="chip">Country: ${escapeHtml(shortCountry(name))}
        <button type="button" aria-label="Clear the country filter, ${escapeHtml(shortCountry(name))}">×</button></span>`;

    draw();
    root.querySelector('.table-scroll').scrollTop = 0;
  };
}

// --- rows ----------------------------------------------------------------------

// Missing values stay empty in the table (owner's decision, Nov 2026)
function notReported(value) {
  return value ? escapeHtml(value) : '';
}

// Lead organizations such as "UNICEF,WFP,FMOH" or "GOAL/Amhara RENCU" may break after a comma or slash,
// so a long name never forces the table to scroll sideways
function breakable(value) {
  return notReported(value).replace(/([,/])/g, '$1<wbr>');
}

/** Summary row of a country with several surveys + its surveys (hidden unless unfolded). */
function groupRows(g, open) {
  const first = g.surveys[0];
  const id = `surveys-${g.key}`;
  const ids = g.surveys.map((_, i) => `${id}-${i + 1}`).join(' ');
  const types = [...new Set(g.surveys.map((s) => s.type_raw).filter(Boolean))].join(', ');
  const counts = countByStatus(g.surveys);
  const statuses = SUMMARY_ORDER.filter((key) => counts[key])
    .map((key) => statusLabel(key, `${SHORT_LABELS[key]} ${counts[key]}`)).join(' ');
  const leads = [...new Set(g.surveys.map((s) => s.lead_org).filter(Boolean))];
  const gaps = g.surveys.filter((s) => s.funding_gap === true).length;
  const funded = g.surveys.filter((s) => s.funding === 'funded').length;
  const funding = gaps ? `${gaps} funding gap${gaps === 1 ? '' : 's'}`
    : funded === g.surveys.length ? 'Funded' : '';

  const summary = `<tr class="group-row">
    <td><button type="button" class="row-toggle" data-toggle="${escapeHtml(g.key)}" aria-expanded="${open}" aria-controls="${escapeHtml(ids)}">
      <span class="caret" aria-hidden="true"></span><strong>${escapeHtml(shortCountry(first.country))}</strong></button>
      <span class="sub">${g.surveys.length} surveys</span></td>
    <td>${escapeHtml(types)}</td>
    <td><span class="st-summary">${statuses}</span></td>
    <td>${leads.length === 1 ? breakable(leads[0]) : ''}</td>
    <td>${funding ? `<span class="fund">${funding}</span>` : ''}</td>
    <td></td><td></td><td></td>
  </tr>`;
  const details = g.surveys.map((s, i) => surveyRow(s, true, g.key, open, `${id}-${i + 1}`)).join('');
  return summary + details;
}

/** One survey. `nested` = shown under its country's summary row (the country name is not repeated). */
function surveyRow(s, nested, parent = '', open = true, id = '') {
  const status = s.display_status || 'not_planned';
  const funding = fundingLabel(s);
  const validation = validationLabel(s);
  const place = nested
    ? `<span class="nested-place">${notReported(s.admin1)}</span>`
    : `<strong>${escapeHtml(shortCountry(s.country))}</strong>${s.admin1 ? `<span class="sub">${escapeHtml(s.admin1)}</span>` : ''}`;
  const attrs = nested ? ` class="sub-row" data-parent="${escapeHtml(parent)}" id="${escapeHtml(id)}"${open ? '' : ' hidden'}` : '';
  return `<tr${attrs}>
    <td>${place}</td>
    <td>${escapeHtml(s.type_raw)}</td>
    <td>${statusLabel(status, SHORT_LABELS[status])}${validation && validation !== STATUS_LABELS[status] ? `<span class="sub">${escapeHtml(validation)}</span>` : ''}</td>
    <td>${breakable(s.lead_org)}</td>
    <td>${funding ? `<span class="fund">${funding}</span>` : ''}</td>
    <td>${s.report_url ? `<a href="${escapeHtml(s.report_url)}" target="_blank" rel="noopener" class="strong">Open<span class="visually-hidden"> report for ${escapeHtml(shortCountry(s.country))}${s.admin1 ? ` ${escapeHtml(s.admin1)}` : ''} (new tab)</span></a>` : ''}</td>
    <td>${notReported(formatDate(s.start_date))}</td>
    <td>${notReported(formatDate(s.end_date))}</td>
  </tr>`;
}

// --- CSV export (one line per survey) -------------------------------------------

const CSV_COLUMNS = [
  ['Assessment ID', (s) => s.id],
  ['Region', (s) => s.region],
  ['Country', (s) => s.country],
  ['Country ISO3', (s) => s.iso3],
  ['Admin 1', (s) => s.admin1],
  ['Admin 1 Pcode', (s) => s.admin1_pcode],
  ['Assessment type', (s) => s.type_raw],
  ['Status', (s) => STATUS_LABELS[s.display_status] || s.status],
  ['Validation', (s) => s.sub_stage],
  ['Results release date', (s) => s.release_date],
  ['Survey year', (s) => s.survey_year],
  ['Start date (indicative)', (s) => s.start_date],
  ['End date (indicative)', (s) => s.end_date],
  ['Lead organization', (s) => s.lead_org],
  ['Partners', (s) => s.partners],
  ['Funding', (s) => fundingLabel(s)],
  ['Report link', (s) => s.report_url],
];

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportCsv(rows) {
  const lines = [CSV_COLUMNS.map(([name]) => csvCell(name)).join(',')];
  for (const s of rows) lines.push(CSV_COLUMNS.map(([, get]) => csvCell(get(s))).join(','));
  // The BOM makes Excel open the accents (Ouaddaï, Haïti…) correctly
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `gnc-nutrition-assessments-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
