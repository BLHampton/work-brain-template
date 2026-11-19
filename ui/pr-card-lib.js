// Pure helpers for the one [PR] card a pull request keeps for its whole life.
// The card's file is `pr.md` in the task folder, shaped by `templates/pr.md`.

const { parsePrUrl } = require('./pr-watch-lib');
const cardsLib = require('./cards-lib');
const { STATUS, OPTION, sectionsOf, parsePr, needsYou } = require('./pr-parse');

const STANDS = [
  'reviewing',
  'comment ready',
  'waiting on author',
  'updated',
  're-review queued',
  're-reviewing',
  'approved',
  'merged',
  'closed',
];

// Same text with only the Stands value on the status line replaced.
function setStands(text, state) {
  if (!STANDS.includes(state)) {
    throw new Error(`Unknown state "${state}". Allowed: ${STANDS.join(', ')}`);
  }
  return text
    .split('\n')
    .map((line) => (STATUS.test(line) ? line.replace(/^Stands: .*?(?= \| Round: )/, `Stands: ${state}`) : line))
    .join('\n');
}

// Text on one line: each run of line breaks becomes a single space.
const oneLine = (text) => String(text).replace(/\s*[\r\n]+\s*/g, ' ').trim();

const TIMELINE = /^## Timeline\n/m;
const PLACEHOLDER = /^- <YYYY-MM-DD HH:MM>[^\n]*\n?$/;

// Same text with `- <at> — <what>` as the first entry under Timeline.
function addTimeline(text, at, what) {
  const heading = TIMELINE.exec(text);
  if (!heading) throw new Error('No "## Timeline" section to add to');
  const cut = heading.index + heading[0].length;
  const rest = text.slice(cut);
  const line = `- ${at} — ${oneLine(what)}\n`;
  return text.slice(0, cut) + line + (PLACEHOLDER.test(rest) ? '' : rest);
}

// The card's `where` line for a headline: on one line, cut to the cap with … when longer.
function whereOf(headline) {
  const text = oneLine(headline);
  return text.length > cardsLib.CAPS.where ? `${text.slice(0, cardsLib.CAPS.where - 1)}…` : text;
}

// Writes the PR's headline into tasks/<folder>/card.json's `where` (folder is the bare name). A task with no card.json
// gets one titled `title` first. Every other field, `closed` included, stays as it is: a closed card is never reopened.
function setWhere(root, folder, headline, title) {
  if (cardsLib.readCard(root, folder).unreadable === 'no card.json') cardsLib.writeCard(root, folder, cardsLib.newCard({ title }));
  cardsLib.change(root, folder, (c) => ({ ...c, where: whereOf(headline) }));
}

const GIVES_WAY = ['waiting on author', 'approved', 'updated'];

// Where the card stands after the watcher saw a change: "updated" only replaces a state that waits on the author.
// A card that waits on the manager or on a review keeps its state; re-review queued, merged and closed always apply.
function standsAfter(was, next) {
  return next === 'updated' && was && !GIVES_WAY.includes(was) ? was : next;
}

const ANSWERS = ['Manager: ', '! ', 'posted: ', 'round '];

// Where a pending post is, from the newest timeline entry that is a stamp of the manager's, a `! <command>`, a `posted:` or
// a `round` line (anything else is the watcher's and is skipped): "refused" (the `! <command>` is to run by hand),
// "requested" (Post is stamped and the dispatcher has not answered yet), "ready" (a comment or an open decision waits)
// or "none" (nothing to post).
function postState(pr) {
  if (pr.stands !== 'comment ready' && !(pr.decisions || []).some((d) => !d.chosen)) return 'none';
  const newest = (pr.timeline || []).map((t) => t.text).find((text) => ANSWERS.some((a) => text.startsWith(a))) || '';
  if (newest.startsWith('! ')) return 'refused';
  return newest.startsWith('Manager: post as ') ? 'requested' : 'ready';
}

const REVIEWS = ['approve', 'request-changes', 'comment'];

// Same text with `Chosen: <letter>` in that decision's block: rewritten where it is, else added after the block's last line.
function choose(text, question, letter) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.startsWith('### ') && l.slice(4).trim() === question);
  if (start < 0) throw new Error(`No decision "${question}" in pr.md`);
  const next = lines.findIndex((l, i) => i > start && l.startsWith('##'));
  const block = lines.slice(start + 1, next < 0 ? lines.length : next);
  if (!block.some((l) => (OPTION.exec(l) || [])[1] === letter)) {
    throw new Error(`Option "${letter}" is not one of the options for "${question}"`);
  }
  const had = block.findIndex((l) => l.startsWith('Chosen: '));
  const at = start + 1 + (had >= 0 ? had : block.findLastIndex((l) => l.trim() !== '') + 1);
  return lines.toSpliced(at, had >= 0 ? 1 : 0, `Chosen: ${letter}`).join('\n');
}

const chooseAll = (text, decisions) => Object.entries(decisions || {}).reduce((t, [question, letter]) => choose(t, question, letter), text);

// One stamp on a [PR] card: { pr, log, event, close } as new texts. Only Done closes the card and returns a log line.
// Stands is never moved here: the dispatcher does that once the post succeeds.
function applyPrStamp({ pr, task }, stamp, at) {
  const base = { type: 'answer', tag: 'PR', task, file: 'pr.md' };
  const kept = (text, what, event) => ({
    pr: addTimeline(text, at, `Manager: ${what}`),
    log: null,
    close: false,
    event: { ...base, ...event },
  });
  if (stamp.kind === 'post') {
    if (!REVIEWS.includes(stamp.review)) throw new Error(`Unknown review type "${stamp.review}". Allowed: ${REVIEWS.join(', ')}`);
    const decisions = { ...stamp.decisions };
    return kept(chooseAll(pr, decisions), `post as ${stamp.review}`, { answer: 'Post', review: stamp.review, decisions });
  }
  if (stamp.kind === 're-review') return kept(pr, 're-review requested', { answer: 'Re-review' });
  if (stamp.kind === 'posted') return kept(chooseAll(pr, stamp.decisions), 'posted by hand', { answer: 'Posted' });
  if (stamp.kind === 'changes') {
    const note = oneLine(stamp.note ?? '');
    if (!note) throw new Error('Changes needs a note');
    return kept(pr, `changes — ${note}`, { answer: 'Changes', note });
  }
  if (stamp.kind === 'done') {
    const { repo, number } = parsePr(pr);
    const name = repo && number ? `${repo}#${number}` : task;
    return { ...kept(pr, 'done', { answer: 'Done' }), close: true, log: `- ${at.slice(0, 10)} — card (PR): ${name} → Done` };
  }
  throw new Error(`Unknown PR stamp "${stamp.kind}". Allowed: post, re-review, changes, done, posted`);
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function decisionLines({ question, options, default: preset }) {
  const letters = [...LETTERS.slice(0, options.length)];
  if (!letters.includes(preset)) {
    throw new Error(`Default "${preset}" is not one of the options (${letters.join(', ')}) for "${question}"`);
  }
  return [`### ${oneLine(question)}`, ...options.map((text, i) => `- ${letters[i]}. ${oneLine(text)}`), `Default: ${preset}`];
}

// The whole pr.md for one review round; `head` is whatever sat above the title, `timeline` the raw lines to keep.
function renderPr({ head, repo, number, title, url, stands, round, verdict, todo, decisions, comment, timeline }) {
  return [
    ...head,
    `# ${repo}#${number} — ${title}`,
    `Stands: ${stands} | Round: ${round} | Url: ${url}`,
    '',
    '## Verdict',
    verdict,
    '',
    '## Still to do',
    ...todo.map((text) => `- [ ] ${oneLine(text)}`),
    '',
    '## Decisions',
    ...decisions.flatMap(decisionLines),
    '',
    '## Comment',
    comment,
    '',
    '## Timeline',
    ...timeline,
    '',
  ].join('\n');
}

// pr.md after a review round: verdict, to-dos, decisions and comment path replaced, old Chosen and Posted gone,
// "comment ready", and `round <n>: <verdict>` on top of the timeline. Works on the template, on a file the watcher
// made before any review (no verdict yet: this is round 1) and on a reviewed file (round + 1).
function setReview(text, review, at) {
  const was = parsePr(text);
  const lines = text.split('\n');
  const titleAt = lines.findIndex((l) => l.startsWith('# '));
  const round = was.round && was.verdict ? was.round + 1 : 1;
  const verdict = oneLine(review.verdict);
  return renderPr({
    head: lines.slice(0, Math.max(titleAt, 0)),
    repo: review.repo ?? was.repo,
    number: review.number ?? was.number,
    title: oneLine(review.title ?? was.title ?? ''),
    url: review.url ?? was.url,
    stands: 'comment ready',
    round,
    verdict,
    todo: review.todo || [],
    decisions: review.decisions || [],
    comment: review.comment,
    timeline: [`- ${at} — round ${round}: ${verdict}`, ...(sectionsOf(lines).Timeline || []).filter((l) => !PLACEHOLDER.test(l))],
  });
}

const SHELL_SAFE = /^[A-Za-z0-9_\-.,:\/@%+=]+$/;
const shellWord = (word) => (SHELL_SAFE.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`);

// The `gh pr review` call for a Post stamp: argv for execFile (no shell) and the same thing as one pasteable line.
// Throws instead of building a command that must not run: not a GitHub PR, no comment file, unknown review type.
function postCommand(pr, review, commentExists) {
  if (!REVIEWS.includes(review)) throw new Error(`Unknown review type "${review}". Allowed: ${REVIEWS.join(', ')}`);
  if (!parsePrUrl(pr.url)) throw new Error(`Not a GitHub pull request (${pr.url}): paste the comment by hand`);
  const file = pr.comment && pr.comment.path;
  if (!file) throw new Error('No comment file path in pr.md');
  if (!commentExists) throw new Error(`Comment file is missing: ${file}`);
  const argv = ['gh', 'pr', 'review', pr.url, `--${review}`, '--body-file', file];
  return { argv, display: argv.map(shellWord).join(' ') };
}

// pr.md once the comment is posted: `Posted: <link>` under the comment path (replaced when there already is one),
// "waiting on author", and `posted: <link>` on top of the timeline.
function markPosted(prText, link, at) {
  const lines = prText.split('\n');
  const start = lines.indexOf('## Comment');
  if (start < 0) throw new Error('No "## Comment" section in pr.md');
  const next = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  const end = next < 0 ? lines.length : next;
  const had = lines.findIndex((l, i) => i > start && i < end && l.startsWith('Posted: '));
  const row = had >= 0 ? had : lines.slice(start + 1, end).findLastIndex((l) => l.trim() !== '') + start + 2;
  const posted = lines.toSpliced(row, had >= 0 ? 1 : 0, `Posted: ${link}`).join('\n');
  return addTimeline(setStands(posted, 'waiting on author'), at, `posted: ${link}`);
}

module.exports = { STANDS, parsePr, setStands, addTimeline, whereOf, setWhere, standsAfter, postState, needsYou, applyPrStamp, setReview, postCommand, markPosted };
