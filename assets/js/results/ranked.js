// Ranked list (CLAUDE.md 11.4.6): one row per country, next to the map and with the same figures
// (figures.js). National figures first, ranked by value; then "Subnational data only"; then
// "No data for this indicator". A row opens the country profile. "Export CSV" exports every row.

import { escapeHtml } from '../filters.js';
import { shortCountry } from '../format.js';
import { WHO_CLASSES, whoClass, formatValue, formatCi, isOlderThan3Years } from './figures.js';

const CLOCK = '<svg class="ico" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="8" cy="8" r="6.5"></circle><path d="M8 4.5V8l2.5 1.5"></path></svg>';

/**
 * @param {HTMLElement} root
 * @param {{onCountry: (iso3) => void}} handlers
 */
export function createRankedList(root, { onCountry }) {
  const view = { rows: [], sortDir: -1, indicator: null }; // sortDir -1 = highest value first

  root.innerHTML = `
    <div class="card-head">
      <div>
        <h2 id="rank-title">Ranked list</h2>
        <div class="card-note" id="rank-count"></div>
      </div>
      <button type="button" class="btn btn-primary" id="rank-export">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M2.5 13.5h11"></path></svg>
        Export CSV
      </button>
    </div>
    <div class="table-scroll" tabindex="0" aria-label="Ranked list, scrollable">
      <table class="tbl rank-tbl">
        <thead><tr>
          <th scope="col" class="c-rank"><span class="th">#</span></th>
          <th scope="col"><span class="th">Country · source · level</span></th>
          <th scope="col" class="c-value" aria-sort="descending"><button type="button" id="rank-sort">Value <span aria-hidden="true" class="mute">↓</span></button></th>
          <th scope="col" class="c-ci"><span class="th">95% CI</span></th>
          <th scope="col" class="c-review"><span class="th">Review</span></th>
        </tr></thead>
        <tbody></tbody>
      </table>
    </div>`;

  const body = root.querySelector('tbody');

  root.querySelector('#rank-sort').addEventListener('click', () => {
    view.sortDir = -view.sortDir;
    draw();
  });
  body.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-iso3]');
    if (button) onCountry(button.dataset.iso3);
  });
  root.querySelector('#rank-export').addEventListener('click', () => exportCsv(view));

  function draw() {
    const { national, subnational, noData } = splitRows(view.rows, view.sortDir);
    const ind = view.indicator;

    const th = root.querySelector('th.c-value');
    th.setAttribute('aria-sort', view.sortDir === -1 ? 'descending' : 'ascending');
    th.querySelector('.mute').textContent = view.sortDir === -1 ? '↓' : '↑';

    body.innerHTML = [
      ...national.map((row, i) => nationalRow(row, i + 1, ind)),
      subnational.length ? groupRow('Subnational data only — not on the national scale') : '',
      ...subnational.map((row) => subnationalRow(row)),
      noData.length ? groupRow('No data for this indicator') : '',
      ...noData.map((row) => noDataRow(row)),
    ].join('') || '<tr><td colspan="5" class="empty">No country has results for this source.</td></tr>';

    root.querySelector('#rank-count').textContent = [
      `${national.length} national figure${national.length === 1 ? '' : 's'}`,
      `${subnational.length} subnational only`,
      `${noData.length} without data`,
    ].join(' · ');
    root.querySelector('#rank-export').disabled = view.rows.length === 0;
  }

  /**
   * @param {object} v  { figures, indicator, countryNames }
   */
  return function update(v) {
    view.indicator = v.indicator;
    view.rows = [...v.figures].map(([iso3, figure]) => ({ iso3, name: v.countryNames[iso3] || iso3, figure }));
    draw();
    root.querySelector('.table-scroll').scrollTop = 0;
  };
}

// --- rows ---------------------------------------------------------------------------

function splitRows(rows, sortDir) {
  const byName = (a, b) => a.name.localeCompare(b.name);
  const national = rows.filter((r) => r.figure.main)
    .sort((a, b) => sortDir * (a.figure.main.value.value - b.figure.main.value.value) || byName(a, b));
  return {
    national,
    subnational: rows.filter((r) => !r.figure.main && r.figure.subnational).sort(byName),
    noData: rows.filter((r) => r.figure.noData).sort(byName),
  };
}

function countryButton(row) {
  return `<button type="button" class="rank-country" data-iso3="${escapeHtml(row.iso3)}">${escapeHtml(shortCountry(row.name))}</button>`;
}

function sourceLine(source, year, level) {
  return `<span class="rank-meta"><span class="src">${escapeHtml(source)}</span> ${year ?? ''} · ${level}</span>`;
}

function oldLine(year) {
  return isOlderThan3Years(year) ? `<span class="rank-old">${CLOCK}Older than 3 years</span>` : '';
}

function nationalRow(row, rank, indicator) {
  const { value: v, year } = row.figure.main;
  const cls = whoClass(indicator, v.value);
  const pill = cls == null ? '' : ` <span class="sev sev-${cls}">${WHO_CLASSES[cls]}</span>`;
  const unit = indicator.unit && indicator.unit !== '%' ? ` <span class="mute rank-unit">${escapeHtml(indicator.unit)}</span>` : '';
  const definition = indicator.definition?.[v.source];
  return `<tr class="${isOlderThan3Years(year) ? 'is-old' : ''}">
    <td class="c-rank">${rank}</td>
    <td>${countryButton(row)}${sourceLine(v.source, year, 'National')}${oldLine(year)}</td>
    <td class="c-value"><span class="rank-value">${formatValue(v.value, indicator.unit)}${unit}${pill}</span>${definition ? `<span class="sub">${escapeHtml(definition)}</span>` : ''}</td>
    <td class="c-ci">${formatCi(v) || '<span class="mute">No CI published</span>'}</td>
    <td class="c-review"><span class="rev">As published</span></td>
  </tr>`;
}

function subnationalRow(row) {
  const s = row.figure.subnational;
  return `<tr>
    <td class="c-rank">–</td>
    <td>${countryButton(row)}${sourceLine(s.source, s.year, 'Subnational')}${oldLine(s.year)}</td>
    <td class="c-value"><span class="mute">${s.areas} area${s.areas === 1 ? '' : 's'}</span><span class="sub">See the country profile</span></td>
    <td class="c-ci"></td>
    <td class="c-review"><span class="rev">As published</span></td>
  </tr>`;
}

function noDataRow(row) {
  return `<tr>
    <td class="c-rank">–</td>
    <td>${countryButton(row)}</td>
    <td class="c-value"><span class="mute">No data</span></td>
    <td class="c-ci"></td>
    <td class="c-review"></td>
  </tr>`;
}

function groupRow(label) {
  return `<tr class="rank-group"><th scope="rowgroup" colspan="5">${label}</th></tr>`;
}

// --- CSV export -----------------------------------------------------------------------

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportCsv(view) {
  const ind = view.indicator;
  const { national, subnational, noData } = splitRows(view.rows, view.sortDir);
  const header = ['Rank', 'Country', 'Country ISO3', 'Indicator', 'Figure', 'Source', 'Survey ID', 'Survey year',
    'Value', 'Unit', 'CI lower', 'CI upper', 'Definition', 'Age group', 'WHO 2018 class', 'Older than 3 years', 'Review'];
  const lines = [header];
  national.forEach((row, i) => {
    const { value: v, year } = row.figure.main;
    const cls = whoClass(ind, v.value);
    lines.push([i + 1, row.name, row.iso3, ind.label, 'National', v.source, v.survey, year, v.value, ind.unit,
      v.ci_lower, v.ci_upper, ind.definition?.[v.source], v.age_group, cls == null ? '' : WHO_CLASSES[cls],
      isOlderThan3Years(year) ? 'Yes' : 'No', 'As published']);
  });
  subnational.forEach((row) => {
    const s = row.figure.subnational;
    lines.push(['', row.name, row.iso3, ind.label, `Subnational only (${s.areas} areas)`, s.source, s.survey?.id, s.year,
      '', '', '', '', '', '', '', isOlderThan3Years(s.year) ? 'Yes' : 'No', 'As published']);
  });
  noData.forEach((row) => lines.push(['', row.name, row.iso3, ind.label, 'No data']));

  const text = lines.map((line) => line.map(csvCell).join(',')).join('\r\n');
  // The BOM makes Excel open the accents (Côte d'Ivoire…) correctly
  const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `gnc-results-${ind.key.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
