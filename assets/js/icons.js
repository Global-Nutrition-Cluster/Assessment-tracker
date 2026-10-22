// Status icons from the mockup: a coloured circle with a glyph, so status never relies on colour alone.
//   planned   = clock     ongoing = play     completed (awaiting release) = hourglass
//   released  = check     not_planned = dash

const GLYPHS = {
  planned: { fill: 'var(--status-planned)', d: 'M8 4.6V8l2.3 1.5', stroke: '#0E3D4C', pathFill: 'none' },
  ongoing: { fill: 'var(--status-ongoing)', d: 'M6.4 5v6L11 8z', stroke: '#2B1500', pathFill: '#2B1500' },
  completed: { fill: 'var(--status-completed)', d: 'M5.5 4.5h5L5.5 11.5h5z', stroke: '#22330A', pathFill: 'none' },
  released: { fill: 'var(--status-released)', d: 'M4.9 8.3l2.1 2.1 4.1-4.4', stroke: '#FFFFFF', pathFill: 'none' },
  not_planned: { fill: 'var(--status-not-planned)', d: 'M5 8h6', stroke: '#1F2421', pathFill: 'none' },
};

export const STATUS_LABELS = {
  planned: 'Planned',
  ongoing: 'Ongoing',
  completed: 'Completed (awaiting release)',
  released: 'Results released',
  not_planned: 'Not planned',
};

/** SVG markup of the status icon. `size` in px. Decorative: the label is always written next to it. */
export function statusIcon(status, size = 16) {
  const g = GLYPHS[status] || GLYPHS.not_planned;
  return `<svg class="st-icon" width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true">`
    + `<circle cx="8" cy="8" r="7" fill="${g.fill}"></circle>`
    + `<path d="${g.d}" fill="${g.pathFill}" stroke="${g.stroke}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path>`
    + '</svg>';
}
