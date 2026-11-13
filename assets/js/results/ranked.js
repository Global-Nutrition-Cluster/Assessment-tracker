// "Latest results by country" (CLAUDE.md 11.4.6): one row per country, next to the map and with the same figures
// (figures.js). No rank and no sorting by value (owner's decision, 13 Nov 2026: the list must not invite
// comparisons between countries): countries in alphabetical order, national figures and "Subnational only"
// together, then "No data for this indicator". A row opens the country profile. "Export CSV" exports every row.
// (The file keeps its old name, ranked.js.)

import { escapeHtml } from '../filters.js';
import { shortCountry } from '../format.js';
import { phaseOf, phasePill, formatValue, formatCi } from './figures.js';

/**
 * @param {HTMLElement} root
 * @param {{onCountry: (iso3) => void}} handlers
 */
export function createRankedList(root, { onCountry }) {
  const view = { rows: [], indicator: null };

  root.innerHTML = `
    <div class="card-head">
      <div>
        <h2 id="rank-title">Latest results by country</h2>
        <div class="card-note" id="rank-count"></div>
      </div>
      <button type="button" class="btn btn-primary" id="rank-export">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M2.5 13.5h11"></path></svg>
        Export CSV
      </button>
    </div>
    <div class="table-scroll" tabindex="0" aria-label="Latest results by country, scrollable">
      <table class="tbl rank-tbl">
        <thead><tr>
          <th scope="col"><span class="th">Country · source · level</span></th>
          <th scope="col" class="c-value"><span class="th">Value</span></th>
          <th scope="col" class="c-ci"><span class="th">95% CI</span></th>
          <th scope="col" class="c-review"><span class="th">Review</span></th>
        </tr></thead>
        <tbody></tbody>
      </table>
    </div>`;

  const body = root.querySelector('tbody');

  body.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-iso3]');
    if (button) onCountry(button.dataset.iso3);
  });
  root.querySelector('#rank-export').addEventListener('click', () => exportCsv(view));

  function draw() {
    const { withData, noData, national, subnational } = splitRows(view.rows);
    const ind = view.indicator;

    body.innerHTML = [
      ...withData.map((row) => (row.figure.main ? nationalRow(row, ind) : subnationalRow(row))),
      noData.length ? groupRow('No data for this indicator') : '',
      ...noData.map((row) => noDataRow(row)),
    ].join('') || '<tr><td colspan="4" class="empty">No country has results for this source.</td></tr>';

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

// Alphabetical order only: countries with a national figure or subnational data, then countries without data
function splitRows(rows) {
  const byName = (a, b) => shortCountry(a.name).localeCompare(shortCountry(b.name));
  const withData = rows.filter((r) => !r.figure.noData).sort(byName);
  return {
    withData,
    noData: rows.filter((r) => r.figure.noData).sort(byName),
    national: withData.filter((r) => r.figure.main),
    subnational: withData.filter((r) => !r.figure.main),
  };
}

function countryButton(row) {
  return `<button type="button" class="rank-country" data-iso3="${escapeHtml(row.iso3)}">${escapeHtml(shortCountry(row.name))}</button>`;
}

function sourceLine(source, year, level) {
  return `<span class="rank-meta"><span class="src">${escapeHtml(source)}</span> ${year ?? ''} · ${level}</span>`;
}

function nationalRow(row, indicator) {
  const { value: v, year } = row.figure.main;
  const pill = phasePill(indicator, v.value) ? ` ${phasePill(indicator, v.value)}` : '';
  const unit = indicator.unit && indicator.unit !== '%' ? ` <span class="mute rank-unit">${escapeHtml(indicator.unit)}</span>` : '';
  const definition = indicator.definition?.[v.source];
  return `<tr>
    <td>${countryButton(row)}${sourceLine(v.source, year, 'National')}</td>
    <td class="c-value"><span class="rank-value">${formatValue(v.value, indicator.unit)}${unit}${pill}</span>${definition ? `<span class="sub">${escapeHtml(definition)}</span>` : ''}</td>
    <td class="c-ci">${formatCi(v) || '<span class="mute">No CI published</span>'}</td>
    <td class="c-review"><span class="rev">As published</span></td>
  </tr>`;
}

function subnationalRow(row) {
  const s = row.figure.subnational;
  return `<tr>
    <td>${countryButton(row)}${sourceLine(s.source, s.year, 'Subnational only')}</td>
    <td class="c-value"><span class="mute">${s.areas} area${s.areas === 1 ? '' : 's'}</span><span class="sub">See the country profile</span></td>
    <td class="c-ci"></td>
    <td class="c-review"><span class="rev">As published</span></td>
  </tr>`;
}

function noDataRow(row) {
  return `<tr>
    <td>${countryButton(row)}</td>
    <td class="c-value"><span class="mute">No data</span></td>
    <td class="c-ci"></td>
    <td class="c-review"></td>
  </tr>`;
}

function groupRow(label) {
  return `<tr class="rank-group"><th scope="rowgroup" colspan="4">${label}</th></tr>`;
}

// --- CSV export -----------------------------------------------------------------------

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportCsv(view) {
  const ind = view.indicator;
  const { withData, noData } = splitRows(view.rows);
  const header = ['Country', 'Country ISO3', 'Indicator', 'Figure', 'Source', 'Survey ID', 'Survey year',
    'Value', 'Unit', 'CI lower', 'CI upper', 'Definition', 'Age group', 'Phase', 'Phase source', 'Review'];
  const lines = [header];
  withData.forEach((row) => {
    if (row.figure.main) {
      const { value: v, year } = row.figure.main;
      const phase = phaseOf(ind, v.value);
      lines.push([row.name, row.iso3, ind.label, 'National', v.source, v.survey, year, v.value, ind.unit,
        v.ci_lower, v.ci_upper, ind.definition?.[v.source], v.age_group, phase?.label ?? '', phase ? ind.phases.source : '',
        'As published']);
    } else {
      const s = row.figure.subnational;
      lines.push([row.name, row.iso3, ind.label, `Subnational only (${s.areas} areas)`, s.source, s.survey?.id, s.year,
        '', '', '', '', '', '', '', '', 'As published']);
    }
  });
  noData.forEach((row) => lines.push([row.name, row.iso3, ind.label, 'No data']));

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
