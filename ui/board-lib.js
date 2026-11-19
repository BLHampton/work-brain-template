// Pure helpers for the board view: task-log rows as objects, task folder lookup, board section per lane.
const fs = require('fs');
const path = require('path');

// One object per `date | ticket | what | lane | status` row of task-log.md; header, legend and blanks skipped.
function parseTaskLog(text) {
  return text.split('\n').map((l) => l.split('|').map((c) => c.trim()))
    .filter((c) => c.length === 5 && /^\d{4}-\d{2}-\d{2}$/.test(c[0]))
    .map(([date, ticket, what, lane, status]) => ({ date, ticket, what, lane, status }));
}

// `tasks/<date>-*` when exactly one such directory exists under root; null otherwise (incl. missing tasks dir).
function folderForDate(root, date) {
  const dir = path.join(root, 'tasks');
  if (!fs.existsSync(dir)) return null;
  const hits = fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith(`${date}-`));
  return hits.length === 1 ? `tasks/${hits[0].name}` : null;
}

// Board section for a task-log lane: review and research cards are not ours to ship, so they sit apart.
function sectionFor(lane) {
  return lane === 'review' || lane === 'research' ? 'Reviews & research' : 'Our cards';
}

module.exports = { parseTaskLog, folderForDate, sectionFor };
