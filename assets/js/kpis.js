// KPI band: four tiles (status icon, no coloured top bar since Oct 2026) that count surveys by stage and act as a status filter.
// The counts follow every filter except Status, so the four tiles stay comparable;
// clicking a tile sets the Status filter, clicking it again clears it.

import { statusIcon } from './icons.js';

const TILES = [
  { key: 'planned', label: 'Planned', icon: 'planned' },
  { key: 'ongoing', label: 'Ongoing', icon: 'ongoing' },
  { key: 'completed', label: 'Completed', icon: 'completed' },
  { key: 'released', label: 'Results released', icon: 'released' },
];

/**
 * @param {HTMLElement} root
 * @param {(status) => void} onSelect  called with the tile key, or 'all' to clear
 */
export function createKpis(root, onSelect) {
  root.innerHTML = TILES.map((t) => `
    <button type="button" class="kpi" data-key="${t.key}" aria-pressed="false">
      <span class="kpi-label">${statusIcon(t.icon, 18)}${t.label}</span>
      <span class="kpi-value">–</span>
      <span class="kpi-sub"></span>
    </button>`).join('');

  let currentStatus = 'all';
  root.addEventListener('click', (event) => {
    const tile = event.target.closest('.kpi');
    if (!tile) return;
    onSelect(currentStatus === tile.dataset.key ? 'all' : tile.dataset.key);
  });

  /** @param {object[]} surveys  surveys filtered by everything except Status */
  return function update(surveys, status) {
    currentStatus = status;
    const count = (test) => surveys.filter(test).length;

    const values = {
      planned: count((s) => s.display_status === 'planned'),
      ongoing: count((s) => s.display_status === 'ongoing'),
      // "Completed" counts every completed survey, released or not (mockup)
      completed: count((s) => s.display_status === 'completed' || s.display_status === 'released'),
      released: count((s) => s.display_status === 'released'),
    };
    const subs = {
      planned: `${count((s) => s.display_status === 'planned' && s.funding_gap === true)} with funding gap`,
      ongoing: 'Data collection or analysis',
      completed: `${count((s) => s.display_status === 'completed')} awaiting release`,
      // Most SMART rows have no release date yet, so "last 12 months" cannot be computed reliably
      released: 'In the selected period',
    };

    root.querySelectorAll('.kpi').forEach((tile) => {
      const key = tile.dataset.key;
      tile.querySelector('.kpi-value').textContent = values[key];
      tile.querySelector('.kpi-sub').textContent = subs[key];
      tile.setAttribute('aria-pressed', String(status === key));
      tile.setAttribute('aria-label', `${tile.querySelector('.kpi-label').textContent.trim()}: ${values[key]}, ${subs[key]}. ${status === key ? 'Click to clear the filter.' : 'Click to show only these surveys.'}`);
    });
  };
}
