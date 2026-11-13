// Status labels: pills tinted with the status colour (soft look, CLAUDE.md section 7; they replaced the
// status icons in Nov 2026). The words carry the meaning, so status is never shown by colour alone.

// Full names (KPI tiles, CSV export) — display statuses of rule 4.3.3
export const STATUS_LABELS = {
  planned: 'Planned',
  ongoing: 'Ongoing',
  completed: 'Completed (awaiting release)',
  released: 'Results released',
  not_planned: 'Not planned',
};

/** `<span class="st-label st-planned">Planned</span>`; `text` replaces the label (e.g. "Planned 2"). */
export function statusLabel(status, text) {
  const key = status in STATUS_LABELS ? status : 'not_planned';
  return `<span class="st-label st-${key}">${text ?? STATUS_LABELS[key]}</span>`;
}

// Order used in summaries (map hover, country rows of the table)
export const SUMMARY_ORDER = ['planned', 'ongoing', 'completed', 'released', 'not_planned'];

// Shorter labels for the summaries ("Completed (awaiting release)" is long in a table row)
export const SHORT_LABELS = {
  planned: 'Planned',
  ongoing: 'Ongoing',
  completed: 'Awaiting release',
  released: 'Released',
  not_planned: 'Not planned',
};

/** Count of surveys per display status: { planned: 2, ongoing: 1, … } (statuses with 0 left out). */
export function countByStatus(surveys) {
  const counts = {};
  for (const s of surveys) {
    const key = s.display_status || 'not_planned';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}
