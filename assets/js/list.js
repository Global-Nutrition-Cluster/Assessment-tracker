// Survey list: sortable table that scrolls vertically inside its card (no pagination, no horizontal scroll),
// CSV export of every filtered row.
// Rows are read-only (no detail panel since Nov 2026). The Assessment ID is not shown in the table
// (owner's decision, Oct 2026) but stays in the CSV export.

import { statusIcon, STATUS_LABELS } from './icons.js';
import { formatDate, fundingLabel, validationLabel, shortCountry } from './format.js';
import { escapeHtml } from './filters.js';


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

// Value compared when sorting by a column. Missing values go last.
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

/**
 * @param {HTMLElement} root
 */
export function createList(root) {
  const view = { rows: [], sortKey: 'country', sortDir: 1 };

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
    <div class="table-scroll" tabindex="0" aria-label="Survey list, scrollable">
      <table class="tbl">
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

    head.innerHTML = COLUMNS.map((c) => {
      if (!c.sortable) return `<th scope="col"><span class="th">${c.label}</span></th>`;
      const active = view.sortKey === c.key;
      const sort = active ? (view.sortDir === 1 ? 'ascending' : 'descending') : 'none';
      const mark = active ? (view.sortDir === 1 ? '↑' : '↓') : '↕';
      return `<th scope="col" aria-sort="${sort}"><button type="button" data-sort="${c.key}">${c.label} <span aria-hidden="true" class="mute">${mark}</span></button></th>`;
    }).join('');

    body.innerHTML = rows.length ? rows.map(rowHtml).join('')
      : `<tr><td colspan="${COLUMNS.length}" class="empty">No survey matches the current filters.</td></tr>`;

    root.querySelector('#list-count').textContent =
      `${rows.length} ${rows.length === 1 ? 'survey matches' : 'surveys match'} the current filters`;
    root.querySelector('#list-export').disabled = rows.length === 0;
  }

  /** Called on every filter change: keep the sort, back to the top of the list. */
  return function update(surveys) {
    view.rows = surveys;
    draw();
    root.querySelector('.table-scroll').scrollTop = 0;
  };
}

// Missing values stay empty in the table (owner's decision, Nov 2026)
function notReported(value) {
  return value ? escapeHtml(value) : '';
}

function rowHtml(s) {
  const status = s.display_status || 'not_planned';
  const funding = fundingLabel(s);
  return `<tr>
    <td><strong>${escapeHtml(shortCountry(s.country))}</strong>${s.admin1 ? `<span class="sub">${escapeHtml(s.admin1)}</span>` : ''}</td>
    <td>${escapeHtml(s.type_raw)}</td>
    <td><span class="status-cell">${statusIcon(status, 14)}${STATUS_LABELS[status]}</span>${validationLabel(s) && validationLabel(s) !== STATUS_LABELS[status] ? `<span class="sub">${escapeHtml(validationLabel(s))}</span>` : ''}</td>
    <td>${notReported(s.lead_org)}</td>
    <td>${funding ? `<span class="fund">${funding}</span>` : ''}</td>
    <td>${s.report_url ? `<a href="${escapeHtml(s.report_url)}" target="_blank" rel="noopener" class="strong">Open<span class="visually-hidden"> report for ${escapeHtml(shortCountry(s.country))}${s.admin1 ? ` ${escapeHtml(s.admin1)}` : ''} (new tab)</span></a>` : ''}</td>
    <td>${notReported(formatDate(s.start_date))}</td>
    <td>${notReported(formatDate(s.end_date))}</td>
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
