// Coverage matrix: countries × SMART, Rapid SMART, MICS, DHS (no IPC — owner's decision).
// Rows = countries with at least one SMART or Rapid SMART survey on record (cluster countries),
// limited by the Region and Country filters. Each cell shows the LATEST survey of that type,
// whatever the Period filter, so gaps stay visible. Cells that do not match the Status filter
// (or the Funding filter, for SMART and Rapid SMART) are faded instead of hidden.

import { statusIcon, STATUS_LABELS } from './icons.js';
import { shortCountry } from './format.js';
import { escapeHtml } from './filters.js';
import { matchStatus, matchFunding } from './data.js';

const TYPES = ['SMART', 'Rapid SMART', 'MICS', 'DHS'];
const ACTIVITY_RANK = { ongoing: 0, planned: 1, completed: 2, released: 3, not_planned: 4 };

/**
 * @param {HTMLElement} root
 * @param {(survey, opener) => void} onOpen
 */
export function createMatrix(root, onOpen) {
  let latestById = new Map();

  root.innerHTML = `
    <div class="card-head">
      <h2>Coverage by assessment type</h2>
      <span class="card-note">Latest assessment per country and type · status and survey year · blank = no assessment on record</span>
    </div>
    <div class="mx-scroll">
      <table class="mx">
        <thead><tr>
          <th scope="col" class="mx-country">Country</th>
          ${TYPES.map((t) => `<th scope="col">${t}</th>`).join('')}
        </tr></thead>
        <tbody></tbody>
      </table>
    </div>
    <p class="card-note mx-note">“× 3” = number of surveys of that type in the latest year. Faded cells do not match the Status or Funding filter. Countries with at least one SMART survey on record.</p>`;

  root.querySelector('tbody').addEventListener('click', (event) => {
    const cell = event.target.closest('button[data-id]');
    if (!cell) return;
    const survey = latestById.get(cell.dataset.id);
    if (survey) onOpen(survey, cell);
  });

  /**
   * @param {object[]} surveys  surveys filtered by Region and Country only
   * @param {object} state      current filters (Status and Funding fade cells)
   */
  return function update(surveys, state) {
    latestById = new Map();
    const byCountry = new Map();
    for (const s of surveys) {
      if (!s.iso3) continue;
      if (!byCountry.has(s.iso3)) byCountry.set(s.iso3, []);
      byCountry.get(s.iso3).push(s);
    }

    const rows = [...byCountry.values()]
      .filter((list) => list.some((s) => s.type_group === 'SMART' || s.type_group === 'Rapid SMART'))
      .sort((a, b) => (a[0].country || '').localeCompare(b[0].country || ''));

    root.querySelector('tbody').innerHTML = rows.length ? rows.map((list) => {
      const first = list[0];
      const cells = TYPES.map((type) => cellHtml(list.filter((s) => s.type_group === type), type, state)).join('');
      return `<tr>
        <th scope="row" class="mx-country">${escapeHtml(shortCountry(first.country))} <span class="mx-region">${escapeHtml(first.region || '')}</span></th>
        ${cells}
      </tr>`;
    }).join('') : `<tr><td colspan="${TYPES.length + 1}" class="empty">No country matches the current filters.</td></tr>`;
  };

  function cellHtml(list, type, state) {
    if (!list.length) return '<td><span class="visually-hidden">No assessment on record</span></td>';

    // Latest = highest survey year; within that year the most active survey
    const sorted = [...list].sort((a, b) => (b.survey_year || 0) - (a.survey_year || 0)
      || (ACTIVITY_RANK[a.display_status] ?? 9) - (ACTIVITY_RANK[b.display_status] ?? 9));
    const top = sorted[0];
    const sameYear = list.filter((s) => s.survey_year === top.survey_year).length;
    latestById.set(top.id, top);

    const isSurvey = type === 'SMART' || type === 'Rapid SMART';
    const match = matchStatus(top, state.status) && (!isSurvey || matchFunding(top, state.funding));
    const status = top.display_status || 'not_planned';
    const label = `${shortCountry(top.country)}, ${type} ${top.survey_year || ''}: ${STATUS_LABELS[status]}${sameYear > 1 ? `, ${sameYear} surveys that year` : ''}`;

    return `<td class="${match ? '' : 'mx-faded'}">
      <button type="button" class="mx-cell mx-${status}" data-id="${escapeHtml(top.id)}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">
        <span class="mx-icon">${statusIcon(status, 14)}</span>${top.survey_year || '—'}${sameYear > 1 ? `<span class="mx-extra"> × ${sameYear}</span>` : ''}
      </button>
    </td>`;
  }
}
