// Survey list: sortable table, 12 rows per page, CSV export of every filtered row.
// Clicking an Assessment ID opens the detail panel.

import { statusIcon, STATUS_LABELS } from './icons.js';
import { formatDate, fundingLabel, validationLabel, shortCountry } from './format.js';
import { escapeHtml } from './filters.js';

const PER_PAGE = 12;

// Order used when sorting by status: what needs attention first
const STATUS_RANK = { ongoing: 0, planned: 1, completed: 2, released: 3, not_planned: 4 };
const FUNDING_RANK = { unfunded: 0, partial: 1, funded: 2 };

const COLUMNS = [
  { key: 'id', label: 'Assessment ID', sortable: true },
  { key: 'country', label: 'Country · Admin 1', sortable: true },
  { key: 'type', label: 'Type', sortable: true },
  { key: 'status', label: 'Status', sortable: true },
  { key: 'start', label: 'Start', sortable: true },
  { key: 'end', label: 'End' },
  { key: 'lead', label: 'Lead organization' },
  { key: 'validation', label: 'Validation' },
  { key: 'funding', label: 'Funding', sortable: true },
  { key: 'report', label: 'Report' },
];

// Value compared when sorting by a column. Missing values go last.
function sortValue(s, key) {
  switch (key) {
    case 'id': return s.id || '';
    case 'country': return `${s.country || ''}|${s.admin1 || ''}`;
    case 'type': return s.type_raw || '';
    case 'status': return STATUS_RANK[s.display_status] ?? 9;
    case 'start': return s.start_date || '9999';
    case 'funding': return FUNDING_RANK[s.funding] ?? 9;
    default: return '';
  }
}

/**
 * @param {HTMLElement} root
 * @param {(survey, opener) => void} onOpen  opens the detail panel
 */
export function createList(root, onOpen) {
  const view = { rows: [], sortKey: 'country', sortDir: 1, page: 0 };

  root.innerHTML = `
    <div class="card-head">
      <div>
        <h2>Survey list</h2>
        <div class="card-note" id="list-count"></div>
      </div>
      <button type="button" class="btn btn-primary" id="list-export">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M2.5 13.5h11"></path></svg>
        Export CSV
      </button>
    </div>
    <div class="table-scroll">
      <table class="tbl">
        <thead><tr></tr></thead>
        <tbody></tbody>
      </table>
    </div>
    <nav class="pager" aria-label="Pagination">
      <span id="list-page-info" aria-live="polite"></span>
      <div class="pager-buttons">
        <button type="button" class="btn btn-small" data-page="-1">Previous</button>
        <button type="button" class="btn btn-small" data-page="1">Next</button>
      </div>
    </nav>`;

  const head = root.querySelector('thead tr');
  const body = root.querySelector('tbody');

  head.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-sort]');
    if (!button) return;
    const key = button.dataset.sort;
    view.sortDir = view.sortKey === key ? -view.sortDir : 1;
    view.sortKey = key;
    view.page = 0;
    draw();
  });

  body.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-id]');
    if (!button) return;
    const survey = view.rows.find((s) => s.id === button.dataset.id);
    if (survey) onOpen(survey, button);
  });

  root.querySelector('.pager').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-page]');
    if (!button || button.disabled) return;
    view.page += Number(button.dataset.page);
    draw();
  });

  root.querySelector('#list-export').addEventListener('click', () => exportCsv(sorted()));

  function sorted() {
    const { sortKey, sortDir } = view;
    return [...view.rows].sort((a, b) => {
      const A = sortValue(a, sortKey);
      const B = sortValue(b, sortKey);
      if (A < B) return -sortDir;
      if (A > B) return sortDir;
      return (a.id || '').localeCompare(b.id || '');
    });
  }

  function draw() {
    const rows = sorted();
    const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
    view.page = Math.min(Math.max(view.page, 0), pages - 1);
    const first = view.page * PER_PAGE;
    const pageRows = rows.slice(first, first + PER_PAGE);

    head.innerHTML = COLUMNS.map((c) => {
      if (!c.sortable) return `<th scope="col"><span class="th">${c.label}</span></th>`;
      const active = view.sortKey === c.key;
      const sort = active ? (view.sortDir === 1 ? 'ascending' : 'descending') : 'none';
      const mark = active ? (view.sortDir === 1 ? '↑' : '↓') : '↕';
      return `<th scope="col" aria-sort="${sort}"><button type="button" data-sort="${c.key}">${c.label} <span aria-hidden="true" class="mute">${mark}</span></button></th>`;
    }).join('');

    body.innerHTML = pageRows.length ? pageRows.map(rowHtml).join('')
      : `<tr><td colspan="${COLUMNS.length}" class="empty">No survey matches the current filters.</td></tr>`;

    root.querySelector('#list-count').textContent =
      `${rows.length} ${rows.length === 1 ? 'survey matches' : 'surveys match'} the current filters`;
    root.querySelector('#list-page-info').textContent = rows.length
      ? `Showing ${first + 1}–${first + pageRows.length} of ${rows.length}` : 'Showing 0 of 0';
    root.querySelector('[data-page="-1"]').disabled = view.page === 0;
    root.querySelector('[data-page="1"]').disabled = view.page >= pages - 1;
    root.querySelector('#list-export').disabled = rows.length === 0;
  }

  /** Called on every filter change: back to page 1, keep the sort. */
  return function update(surveys) {
    view.rows = surveys;
    view.page = 0;
    draw();
  };
}

function notReported(value) {
  return value ? escapeHtml(value) : '<span class="nr">Not reported</span>';
}

function rowHtml(s) {
  const status = s.display_status || 'not_planned';
  const funding = fundingLabel(s);
  return `<tr>
    <td><button type="button" class="rowbtn" data-id="${escapeHtml(s.id)}">${escapeHtml(s.id)}</button></td>
    <td>${escapeHtml(shortCountry(s.country))}${s.admin1 ? `<span class="mute"> · ${escapeHtml(s.admin1)}</span>` : ''}</td>
    <td>${escapeHtml(s.type_raw)}</td>
    <td><span class="status-cell">${statusIcon(status, 14)}${STATUS_LABELS[status]}</span></td>
    <td class="nowrap">${notReported(formatDate(s.start_date))}</td>
    <td class="nowrap">${notReported(formatDate(s.end_date))}</td>
    <td>${notReported(s.lead_org)}</td>
    <td>${escapeHtml(validationLabel(s)) || '<span class="nr">—</span>'}</td>
    <td>${funding ? `<span class="fund">${funding}</span>` : '<span class="nr">Not reported</span>'}</td>
    <td>${s.report_url ? `<a href="${escapeHtml(s.report_url)}" target="_blank" rel="noopener" class="strong">Open<span class="visually-hidden"> report for ${escapeHtml(s.id)} (new tab)</span></a>` : '<span class="nr">—</span>'}</td>
  </tr>`;
}

// --- CSV export ----------------------------------------------------------------

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
