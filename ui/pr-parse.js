// Parses a task's pr.md (shaped by templates/pr.md). No requires, so cards-lib and pr-card-lib can both use it.

const TITLE = /^# (.+?)#(\d+) — (.*)$/;
const STATUS = /^Stands: (.*?) \| Round: (\d+) \| Url: (\S+)\s*$/;
const TODO = /^- \[( |x)\] (.*)$/i;
const OPTION = /^- ([A-Z])\. (.*)$/;
const EVENT = /^- (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) — (.*)$/;

// Body lines of each `## ` section, blank lines dropped.
function sectionsOf(lines) {
  const out = {};
  let cur = null;
  for (const line of lines) {
    if (line.startsWith('## ')) {
      cur = line.slice(3).trim();
      out[cur] = [];
    } else if (cur && line.trim() !== '') {
      out[cur].push(line);
    }
  }
  return out;
}

const field = (lines, name) => {
  const line = lines.find((l) => l.startsWith(`${name}: `));
  return line ? line.slice(name.length + 2).trim() : null;
};

function decisionsOf(lines) {
  const out = [];
  let block = null;
  for (const line of lines) {
    if (line.startsWith('### ')) {
      block = [];
      out.push({ question: line.slice(4).trim(), block });
    } else if (block) {
      block.push(line);
    }
  }
  return out.map(({ question, block: body }) => ({
    question,
    options: body.map((l) => OPTION.exec(l)).filter(Boolean).map((m) => ({ letter: m[1], text: m[2] })),
    default: field(body, 'Default'),
    chosen: field(body, 'Chosen'),
  }));
}

function parsePr(text) {
  const lines = text.split('\n');
  const title = lines.map((l) => TITLE.exec(l)).find(Boolean) || [];
  const status = lines.map((l) => STATUS.exec(l)).find(Boolean) || [];
  const s = sectionsOf(lines);
  const comment = s.Comment || [];
  return {
    repo: title[1] || null,
    number: title[2] ? Number(title[2]) : null,
    title: title[3] || null,
    stands: status[1] || null,
    round: status[2] ? Number(status[2]) : null,
    url: status[3] || null,
    verdict: (s.Verdict || [])[0] || null,
    todo: (s['Still to do'] || [])
      .map((l) => TODO.exec(l))
      .filter(Boolean)
      .map((m) => ({ text: m[2], done: m[1] !== ' ' })),
    decisions: decisionsOf(s.Decisions || []),
    comment: {
      path: comment.find((l) => !l.startsWith('Posted: ')) || null,
      posted: field(comment, 'Posted'),
    },
    timeline: (s.Timeline || [])
      .map((l) => EVENT.exec(l))
      .filter(Boolean)
      .map((m) => ({ at: m[1], text: m[2] })),
  };
}

const YOURS = ['comment ready', 'merged', 'closed'];

// True when the card waits on Manager: a post or a last stamp is pending, or a decision has no choice.
function needsYou(pr) {
  return YOURS.includes(pr.stands) || (pr.decisions || []).some((d) => !d.chosen);
}

module.exports = { STATUS, OPTION, sectionsOf, parsePr, needsYou };
