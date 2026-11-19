const { test } = require('node:test');
const assert = require('node:assert/strict');
const lib = require('./card-lib');

const QUESTION_MD = [
  '<!-- question.md · whoever needs the manager · one question per file (independent ones as Q1/Q2) · cap: one screen -->',
  '# TICKET-1329 — question',
  'Stage: scribe | Asked by: dispatcher | 2026-11-03 09:15',
  '',
  '## Question',
  'May the scribe post the ticket update to Jira from a stamp?',
  '',
  '## Options',
  'A. Allow the Jira tool — the scribe posts on Approve',
  'B. Copy and paste by hand — the manager posts it; the card closes after',
  'C. Skip the update — nothing posts — the ticket stays stale',
  '',
  '## Default',
  'B — the manager pastes it until the classifier allows the tool',
  '',
  '## Blocked meanwhile',
  'The ticket update; the next card can still start.',
  '',
  '## Answer',
  '<filled in by the dispatcher when the manager answers>',
  '',
].join('\n');

test('parseQuestion returns the question, lettered options split on the first " — ", and the default letter', () => {
  const q = lib.parseQuestion(QUESTION_MD);
  assert.equal(q.question, 'May the scribe post the ticket update to Jira from a stamp?');
  assert.deepEqual(q.options, [
    { letter: 'A', label: 'Allow the Jira tool', consequence: 'the scribe posts on Approve' },
    { letter: 'B', label: 'Copy and paste by hand', consequence: 'the manager posts it; the card closes after' },
    { letter: 'C', label: 'Skip the update', consequence: 'nothing posts — the ticket stays stale' },
  ]);
  assert.equal(q.defaultLetter, 'B');
});

const TEMPLATE_MD = [
  '<!-- question.md · whoever needs the manager · one question per file (independent ones as Q1/Q2) · cap: one screen -->',
  '# <card> — question',
  'Stage: <stage> | Asked by: <role> | <YYYY-MM-DD HH:MM>',
  '',
  '## Question',
  '<one question, answerable without opening code>',
  '',
  '## Options',
  'A. <option> — <consequence>',
  'B. <option> — <consequence>',
  '',
  '## Default',
  '<the option recommended, so the manager can stamp Approve for it; the card stays paused until he does>',
  '',
  '## Blocked meanwhile',
  '<what can\'t proceed; what still can>',
  '',
  '## Answer',
  '<filled in by the dispatcher when the manager answers>',
  '',
].join('\n');

test('parseQuestion leaves missing sections and unfilled template placeholders out, never as empty strings or arrays', () => {
  const questionOnly = '# X — question\n\n## Question\nShip it today?\n\n## Answer\n';
  assert.deepEqual(lib.parseQuestion(questionOnly), { question: 'Ship it today?' });
  assert.deepEqual(lib.parseQuestion(TEMPLATE_MD), {});
});

test('parseQuestion returns a filled "Blocked meanwhile" section, trimmed, as blocked', () => {
  const md = QUESTION_MD.replace(
    'The ticket update; the next card can still start.',
    '   only the scribe stage; the PR is open   \n'
  );
  assert.equal(lib.parseQuestion(md).blocked, 'only the scribe stage; the PR is open');
});

const PACKET_MD = [
  '<!-- packet.md · dispatcher · must fit on one screen; if the manager has to open the diff to understand it, log that in misses.md -->',
  '# TICKET-1329 — Cards read at a glance',
  'Lane: standard | Review rounds: 1 | Attempts: 1',
  '',
  '## Criteria → proof',
  '- Card shows its headline → headline test (PASS)',
  '',
  '## What changed',
  'ui/card-lib.js parses question and packet files.',
  '',
  '## Review: top findings',
  '- [6] Ship box lost quotes → fixed in ui/card-lib.js',
  '',
  '## LOOK',
  '<!-- prod API/contract/schema/migration · new or changed UI · auth/permissions/secrets/payments -->',
  '- new or changed UI: card pane sections',
  '- files outside the plan\'s list: bin/cpu-watch',
  '',
  '## Unusual',
  'none',
  '',
  '## Ship',
  '<!-- exact commands, one line -->',
  '```',
  'git -C ~/src/app add -A && git -C ~/src/app commit -m "feat: cards read at a glance" -m "For those who come after"',
  'git -C ~/src/app push -u origin feat/card-readability',
  '```',
  '',
].join('\n');

test('parsePacket returns the title heading, LOOK bullets without markers, and the Ship block body exactly as written', () => {
  assert.deepEqual(lib.parsePacket(PACKET_MD), {
    title: 'TICKET-1329 — Cards read at a glance',
    look: [
      'new or changed UI: card pane sections',
      'files outside the plan\'s list: bin/cpu-watch',
    ],
    ship:
      'git -C ~/src/app add -A && git -C ~/src/app commit -m "feat: cards read at a glance" -m "For those who come after"\n' +
      'git -C ~/src/app push -u origin feat/card-readability',
  });
});

const withDefault = {
  question: 'Who posts the update?',
  options: [
    { letter: 'A', label: 'The scribe posts it', consequence: 'on Approve' },
    { letter: 'B', label: 'You paste it', consequence: 'the card closes after' },
  ],
  defaultLetter: 'B',
};
const noDefault = { question: 'Ship it today?', options: withDefault.options };

for (const [name, sections, expected] of [
  ['a question with a default names its letter and label', { question: withDefault }, 'Approve: B — You paste it'],
  ['a question with no default', { question: noDefault }, 'Approve'],
  ['a packet with a Ship block', { packet: { title: 'T', look: [], ship: 'git push' } }, 'Approve: run Ship'],
  ['a packet whose Ship block is empty', { packet: { title: 'T', look: [], ship: '' } }, 'Approve'],
  ['no sections', undefined, 'Approve'],
]) {
  test(`approveLabel: ${name} → "${expected}"`, () => {
    assert.equal(lib.approveLabel(sections), expected);
  });
}

test('parsePacket keeps a plain unbulleted LOOK line, strips a leading "- ", and drops "none" and <!-- … --> lines', () => {
  const md = [
    '# T',
    '',
    '## LOOK',
    '<!-- prod API/contract/schema/migration · new or changed UI -->',
    'new or changed UI: card pane sections',
    '- files outside the plan\'s list: bin/cpu-watch',
    'none',
    '- None',
    '',
    '## Ship',
    '```',
    'git push',
    '```',
    '',
  ].join('\n');
  assert.deepEqual(lib.parsePacket(md).look, [
    'new or changed UI: card pane sections',
    'files outside the plan\'s list: bin/cpu-watch',
  ]);
});

// The real numbered shape, as in the TICKET-1329 question.md: `1. <label> — <consequence>`, Default `Option 1. <why>`.
const NUMBERED_MD = [
  '# TICKET-1329 — question',
  '',
  '## Question',
  '',
  'Which content format does this card build first?',
  '',
  '## Options',
  '',
  '1. Walkthrough steps first — a video renderer is a follow-up',
  '2. Video first — 6.3 MB per video in every release',
  '3. Both in this card',
  '',
  '## Default',
  '',
  'Option 1. ACs 1, 5 and 11 are read as "content".',
  '',
].join('\n');

test('parseQuestion reads numbered options ("1. <label> — <consequence>") and a Default written "Option 1. …"', () => {
  const q = lib.parseQuestion(NUMBERED_MD);
  assert.deepEqual(q.options, [
    { letter: '1', label: 'Walkthrough steps first', consequence: 'a video renderer is a follow-up' },
    { letter: '2', label: 'Video first', consequence: '6.3 MB per video in every release' },
    { letter: '3', label: 'Both in this card', consequence: '' },
  ]);
  assert.equal(q.defaultLetter, '1');
  assert.equal(lib.approveLabel({ question: q }), 'Approve: 1 — Walkthrough steps first');
});

for (const written of ['Option A', 'Option A. the scribe posts', 'A', 'A — the scribe posts']) {
  test(`parseQuestion reads a Default written "${written}" as letter A`, () => {
    const md = QUESTION_MD.replace('B — the manager pastes it until the classifier allows the tool', written);
    assert.equal(lib.parseQuestion(md).defaultLetter, 'A');
  });
}

test('parsePacket on the unfilled templates/packet.md gives no title, no LOOK and no ship, so approveLabel is plain "Approve"', () => {
  const tpl = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'templates', 'packet.md'), 'utf8');
  const packet = lib.parsePacket(tpl);
  assert.deepEqual(packet, { title: '', look: [], ship: '' });
  assert.equal(lib.approveLabel({ packet }), 'Approve');
});

test('parseQuestion and parsePacket read a CRLF file exactly as the same file with LF endings', () => {
  const crlf = (s) => s.replace(/\n/g, '\r\n');
  assert.deepEqual(lib.parseQuestion(crlf(QUESTION_MD)), lib.parseQuestion(QUESTION_MD), 'question.md');
  assert.deepEqual(lib.parsePacket(crlf(PACKET_MD)), lib.parsePacket(PACKET_MD), 'packet.md');
});

// A packet whose Ship fence holds exactly these lines; everything else is filled.
const packetWithShip = (lines) => PACKET_MD.replace(
  /## Ship\n[\s\S]*$/,
  ['## Ship', '<!-- exact commands -->', '```', ...lines, '```', ''].join('\n'),
);

test('parsePacket keeps a Ship block with a Co-Authored-By "<email>" line in full, and approveLabel is "Approve: run Ship"', () => {
  const lines = [
    'git -C ~/src/app add -A && git -C ~/src/app commit -m "feat: x" -m "For those who come after" -m "Co-Authored-By: Claude <noreply@anthropic.com>"',
    'git -C ~/src/app push -u origin feat/x',
  ];
  const packet = lib.parsePacket(packetWithShip(lines));
  assert.equal(packet.ship, lines.join('\n'));
  assert.equal(lib.approveLabel({ packet }), 'Approve: run Ship');
});

for (const [name, lines] of [
  ['a redirection "sort <in.txt >out.txt"', ['sort <in.txt >out.txt && git -C ~/src/app add out.txt']],
  ['a heredoc "git commit -F - <<MSG > /dev/null"', ['git -C ~/src/app commit -F - <<MSG > /dev/null', 'feat: x', 'MSG']],
]) {
  test(`parsePacket keeps a Ship block holding ${name} exactly as written`, () => {
    assert.equal(lib.parsePacket(packetWithShip(lines)).ship, lines.join('\n'));
  });
}

for (const slot of ['<repo>', '<type>', '<description>', '<branch>']) {
  test(`parsePacket treats a Ship block still holding the template slot ${slot} as unfilled (ship "")`, () => {
    const lines = [
      `git -C ${slot} commit -m "${slot}: x" -m "Co-Authored-By: Claude <noreply@anthropic.com>"`,
      `sort <in.txt >out.txt && git push -u origin ${slot}`,
    ];
    const packet = lib.parsePacket(packetWithShip(lines));
    assert.equal(packet.ship, '');
    assert.equal(lib.approveLabel({ packet }), 'Approve');
  });
}

// Copy of tasks/2026-10-27-worktrees-monitor/packet.md (a real packet QA saw blanked).
const WORKTREES_MONITOR_PACKET_MD = [
  '<!-- packet.md · dispatcher · must fit on one screen; if the manager has to open the diff to understand it, log that in misses.md -->',
  '# worktrees-monitor — review/research cards get their own worktrees; btop is the resource monitor',
  'Lane: quick | Review rounds: 2 | Attempts: 0',
  '',
  '## Criteria → proof',
  '- 1 CLAUDE.md: "no parallel worktrees" gone; worktree rule, Review/Research lane rows, leftover check, Tune-these row `Parallel worktrees | 3` → review.md round 2 criteria 1 (PASS)',
  '- 2 bin/monitor is btop: exec, no-sudo install into ~/.local/bin, `--once` prints `btop <version> at <path>` → you ran it: btop 1.4.8 installed, exit 0 (PASS)',
  '- 3 bin/morning opens a `monitor` tab in Dispatch via `bin/monitor --open`, silent without Herdr → stubbed Herdr in review (PASS); live run after this gate',
  '- 4 node suite 71/71, `sh -n` clean, `--once` exit 0 (PASS)',
  '',
  '## What changed',
  '- `CLAUDE.md` (11 lines): the one-card rule becomes "one TDD card + one suite"; review and research cards run in `~/.herdr/worktrees/<repo>-<slug>` via `herdr worktree create` and are removed when done; leftover check also lists worktrees; Tune-these gains the parallel-worktrees row.',
  '- `bin/monitor` (new, 86 lines, POSIX sh): find or install btop, `--once`, `--open` (Dispatch tab, idempotent).',
  '- `bin/morning` (+3): calls `bin/monitor --open || true`.',
  '',
  '## Review: top findings',
  '- [3] install asks the GitHub API for the latest release (60 unauthenticated calls/hour) → logged; runs once per machine',
  '- [2] no integrity check on the downloaded binary; btop publishes no checksum → logged',
  '- [2] Tune-these row still named "Cards working" while the bullet says "TDD card" → logged',
  '- [1] `--once` echoes btop\'s ANSI bold codes in the version string → logged',
  '- round 1 [9] hand-rolled frame instead of btop → fixed; [5] CLAUDE.md:11 pointed at it → fixed',
  '',
  '## LOOK',
  '- CLAUDE.md rule change: the brain\'s working rules differ from today for every review and research card from now on.',
  '',
  '## Unusual',
  '- `repos/work-brain.json` says remote "none (local only)" but origin is GitHub; the Ship block pushes there. Branch is off `feat/svg-export` (unmerged dispatcher upgrade), not `main`.',
  '- The two agent runs on this card overlapped once (round-2 implementer stopped before editing); no file damage.',
  '- prePr: none configured.',
  '',
  '## Ship',
  '<!-- exact commands; Approve on the DIFF GATE card is the go for these and nothing more -->',
  '```',
  'git -C /home/me/work-brain add CLAUDE.md bin/monitor bin/morning && git -C /home/me/work-brain commit -m "feat: review and research cards run in parallel worktrees; btop as the resource monitor in a Dispatch tab',
  '',
  'For those who come after',
  '',
  'Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" && git -C /home/me/work-brain push -u origin feat/worktrees-monitor',
  '```',
  '',
].join('\n');

test('parsePacket keeps the whole Ship block of the real worktrees-monitor packet, attribution email included', () => {
  const packet = lib.parsePacket(WORKTREES_MONITOR_PACKET_MD);
  assert.equal(packet.title, 'worktrees-monitor — review/research cards get their own worktrees; btop is the resource monitor');
  assert.equal(packet.ship, [
    'git -C /home/me/work-brain add CLAUDE.md bin/monitor bin/morning && git -C /home/me/work-brain commit -m "feat: review and research cards run in parallel worktrees; btop as the resource monitor in a Dispatch tab',
    '',
    'For those who come after',
    '',
    'Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" && git -C /home/me/work-brain push -u origin feat/worktrees-monitor',
  ].join('\n'));
  assert.equal(lib.approveLabel({ packet }), 'Approve: run Ship');
});
