// Survey detail panel: a side panel on desktop, a bottom sheet on phones (CSS decides).
// Two views: one survey (from the list, timeline, matrix) or one country's SMART surveys (from the map);
// in the country view each survey opens its details, with a link back to the country.

import { statusIcon, STATUS_LABELS } from './icons.js';
import { formatDate, fundingLabel, validationLabel, shortCountry } from './format.js';
import { escapeHtml } from './filters.js';

const WARNING_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" class="notice-icon"><path d="M8 1.5 15 14H1z" fill="#FFFFFF" stroke="#B85A00" stroke-width="1.6" stroke-linejoin="round"></path><path d="M8 6v3.6M8 11.6v.2" stroke="#B85A00" stroke-width="1.8" stroke-linecap="round"></path></svg>';
const CLOSE_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9"></path></svg>';
const EXTERNAL_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3h4v4M13 3 7 9M11 9.5V13H3V5h3.5"></path></svg>';

/**
 * @param {HTMLElement} root   empty container at the end of <body>
 * @param {(id|null) => void} onChange  called with the open survey ID (or null) so it can go in the URL
 * @returns {{ open(survey, opener?), openCountry(surveys, opener?), close() }}
 */
export function createPanel(root, onChange) {
  let opener = null;
  let countryList = null; // surveys of the country view, to come back to it

  root.innerHTML = `
    <div class="panel-backdrop" hidden></div>
    <div class="panel" role="dialog" aria-modal="true" aria-labelledby="panel-title" hidden>
      <span class="panel-handle" aria-hidden="true"></span>
      <div class="panel-head">
        <div class="panel-heading"></div>
        <button type="button" class="btn-icon" data-close aria-label="Close survey details">${CLOSE_ICON}</button>
      </div>
      <div class="panel-body"></div>
      <div class="panel-foot"></div>
    </div>`;

  const backdrop = root.querySelector('.panel-backdrop');
  const panel = root.querySelector('.panel');

  backdrop.addEventListener('click', close);
  panel.querySelector('[data-close]').addEventListener('click', close);
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
    if (event.key === 'Tab') trapFocus(event);
  });

  function open(survey, from = null, keepCountry = false) {
    if (!keepCountry) countryList = null;
    if (from) opener = from;
    fill(survey);
    show();
    onChange(survey.id);
  }

  /** Country view: the SMART surveys of one country. A single survey opens directly. */
  function openCountry(list, from = null) {
    if (list.length === 1) { open(list[0], from); return; }
    countryList = list;
    if (from) opener = from;
    fillCountry(list);
    show();
    onChange(null);
  }

  function show() {
    backdrop.hidden = false;
    panel.hidden = false;
    document.body.classList.add('panel-open');
    panel.querySelector('[data-close]').focus();
  }

  function close() {
    if (panel.hidden) return;
    backdrop.hidden = true;
    panel.hidden = true;
    document.body.classList.remove('panel-open');
    if (opener && document.contains(opener)) opener.focus();
    opener = null;
    countryList = null;
    onChange(null);
  }

  // Clicks inside the country view: open one survey, or go back to the country
  panel.querySelector('.panel-body').addEventListener('click', (event) => {
    const item = event.target.closest('[data-survey]');
    if (!item || !countryList) return;
    const survey = countryList.find((s) => s.id === item.dataset.survey);
    if (survey) open(survey, null, true);
  });
  panel.querySelector('.panel-head').addEventListener('click', (event) => {
    if (event.target.closest('[data-back]') && countryList) {
      fillCountry(countryList);
      panel.querySelector('[data-close]').focus();
      onChange(null);
    }
  });

  function fillCountry(list) {
    const ACTIVITY_RANK = { ongoing: 0, planned: 1, completed: 2, released: 3, not_planned: 4 };
    const sorted = [...list].sort((a, b) => (ACTIVITY_RANK[a.display_status] ?? 9) - (ACTIVITY_RANK[b.display_status] ?? 9) || a.id.localeCompare(b.id));
    panel.querySelector('.panel-heading').innerHTML = `
      <span class="lbl">SMART surveys</span>
      <h2 id="panel-title">${escapeHtml(shortCountry(list[0].country))}</h2>
      <span class="panel-status">${list.length} surveys in the current filters</span>`;
    panel.querySelector('.panel-body').innerHTML = `
      <ul class="panel-list">
        ${sorted.map((s) => {
          const status = s.display_status || 'not_planned';
          const dates = s.start_date ? (s.end_date ? `${formatDate(s.start_date)} – ${formatDate(s.end_date)}` : `from ${formatDate(s.start_date)}`) : 'Dates not reported';
          return `<li><button type="button" class="panel-item" data-survey="${escapeHtml(s.id)}">
            ${statusIcon(status, 16)}
            <span><strong>${escapeHtml(s.id)}</strong>${s.admin1 ? ` · ${escapeHtml(s.admin1)}` : ''}
              <span class="mute">${STATUS_LABELS[status]} · ${dates}${fundingLabel(s) ? ` · ${fundingLabel(s)}` : ''}</span></span>
          </button></li>`;
        }).join('')}
      </ul>`;
    panel.querySelector('.panel-foot').innerHTML = '';
    panel.querySelector('.panel-body').scrollTop = 0;
  }

  function fill(s) {
    const status = s.display_status || 'not_planned';
    const funding = fundingLabel(s);

    panel.querySelector('.panel-heading').innerHTML = `
      ${countryList ? `<button type="button" class="panel-back" data-back>← All surveys in ${escapeHtml(shortCountry(s.country))}</button>` : ''}
      <span class="lbl">${escapeHtml(s.type_raw || 'Assessment')} survey</span>
      <h2 id="panel-title">${escapeHtml(s.id)}</h2>
      <span class="panel-status">${statusIcon(status, 16)}${STATUS_LABELS[status]}
        <span class="fund">${funding || 'Funding not reported'}</span></span>`;

    const fields = [
      ['Country', s.country ? `${s.country}${s.iso3 ? ` (${s.iso3})` : ''}` : ''],
      ['Region', s.region],
      ['Admin 1', s.admin1],
      ['Assessment type', s.type_raw],
      ['Start date (indicative)', formatDate(s.start_date)],
      ['End date (indicative)', formatDate(s.end_date)],
      ['Lead organization', s.lead_org],
      ['Partners', s.partners],
      ['Validation', validationLabel(s)],
      ['Funding', funding],
    ];

    const gaps = [];
    if (!s.start_date) gaps.push('start date');
    if (!s.end_date) gaps.push('end date');
    if (!s.lead_org) gaps.push('lead organization');

    panel.querySelector('.panel-body').innerHTML = `
      <dl class="panel-fields">
        ${fields.map(([k, v]) => `<dt>${k}</dt><dd>${v ? escapeHtml(v) : '<span class="nr">Not reported</span>'}</dd>`).join('')}
      </dl>
      ${gaps.length ? `<div class="panel-gaps">${WARNING_ICON}<span>Missing information: ${gaps.join(', ')}. Country IMOs can update this record in the tracker.</span></div>` : ''}`;

    panel.querySelector('.panel-foot').innerHTML = s.report_url
      ? `<a class="btn btn-primary btn-large" href="${escapeHtml(s.report_url)}" target="_blank" rel="noopener">Open report ${EXTERNAL_ICON}<span class="visually-hidden">(new tab)</span></a>`
      : '<span class="no-report">No report published yet</span>';

    panel.querySelector('.panel-body').scrollTop = 0;
  }

  // Keep Tab inside the dialog while it is open
  function trapFocus(event) {
    const focusable = [...panel.querySelectorAll('a[href], button:not([disabled])')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { last.focus(); event.preventDefault(); }
    else if (!event.shiftKey && document.activeElement === last) { first.focus(); event.preventDefault(); }
  }

  return { open, openCountry, close };
}
