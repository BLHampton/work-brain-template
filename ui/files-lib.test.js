const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const lib = require('./files-lib');

test('safeBrainPath accepts tasks/*, retros/*, suggestion-box.md, misses.md and answers.md, returning the absolute path under root for each', () => {
  const root = '/srv/work-brain';
  assert.equal(lib.safeBrainPath(root, 'tasks/2026-10-16-x/brief.md'), path.join(root, 'tasks/2026-10-16-x/brief.md'));
  assert.equal(lib.safeBrainPath(root, 'retros/2026-10-17.md'), path.join(root, 'retros/2026-10-17.md'));
  assert.equal(lib.safeBrainPath(root, 'suggestion-box.md'), path.join(root, 'suggestion-box.md'));
  assert.equal(lib.safeBrainPath(root, 'misses.md'), path.join(root, 'misses.md'));
  assert.equal(lib.safeBrainPath(root, 'answers.md'), path.join(root, 'answers.md'));
});

test('safeBrainPath returns null for traversal, absolute, and non-allowed brain paths (including absolute paths under root but outside tasks/retros)', () => {
  const root = '/srv/work-brain';
  const rejected = [
    '../CLAUDE.md',
    '/etc/passwd',
    '.claude/settings.json',
    'repos/work-brain.json',
    'ui/server.js',
    'tasks/../inbox.md',
    'local.json',
    'inbox.md',
    path.join(root, 'ui/server.js'),
  ];
  for (const requested of rejected) {
    assert.equal(lib.safeBrainPath(root, requested), null, `expected null for ${JSON.stringify(requested)}`);
  }
  // The function does not URL-decode: `%2e%2e` is just an odd folder name still under tasks/, so it stays a path.
  assert.equal(lib.safeBrainPath(root, 'tasks/%2e%2e/inbox.md'), path.join(root, 'tasks/%2e%2e/inbox.md'));
});

function brainWith(layout) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'files-ui-'));
  for (const rel of layout) {
    const abs = path.join(root, rel);
    if (rel.endsWith('/')) fs.mkdirSync(abs, { recursive: true });
    else {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, '');
    }
  }
  return root;
}

test('brainTree lists each task folder with its .md/.mmd files, every retros/*.md, suggestion-box.md, misses.md and answers.md, sorted, skipping shots/, images and .gitkeep; missing retros, suggestion box, misses or answers give [] / null / null / null', () => {
  const root = brainWith([
    'tasks/.gitkeep',
    'tasks/2026-10-17-rate-limiter/plan.md',
    'tasks/2026-10-17-rate-limiter/brief.md',
    'tasks/2026-10-16-x/plan.md',
    'tasks/2026-10-16-x/brief.md',
    'tasks/2026-10-16-x/diagram.mmd',
    'tasks/2026-10-16-x/screen.png',
    'tasks/2026-10-16-x/shots/',
    'tasks/2026-10-16-x/shots/one.png',
    'retros/2026-10-17.md',
    'retros/2026-10-10.md',
    'retros/notes.txt',
    'suggestion-box.md',
    'misses.md',
    'answers.md',
    'inbox.md',
  ]);
  assert.deepEqual(lib.brainTree(root), {
    tasks: [
      { folder: 'tasks/2026-10-16-x', files: ['brief.md', 'diagram.mmd', 'plan.md'] },
      { folder: 'tasks/2026-10-17-rate-limiter', files: ['brief.md', 'plan.md'] },
    ],
    retros: ['retros/2026-10-10.md', 'retros/2026-10-17.md'],
    suggestionBox: 'suggestion-box.md',
    misses: 'misses.md',
    answers: 'answers.md',
  });

  const bare = brainWith(['tasks/2026-10-18-y/brief.md']);
  assert.deepEqual(lib.brainTree(bare), {
    tasks: [{ folder: 'tasks/2026-10-18-y', files: ['brief.md'] }],
    retros: [],
    suggestionBox: null,
    misses: null,
    answers: null,
  });
});

test('taskFile returns status 200, type text/html and the file body for an existing research/mockups.html under a valid task folder', () => {
  const root = brainWith(['tasks/2026-11-02-some-card/brief.md', 'tasks/2026-11-02-some-card/research/']);
  const html = '<html><body><h1>Variant A · recommended</h1></body></html>';
  fs.writeFileSync(path.join(root, 'tasks/2026-11-02-some-card/research/mockups.html'), html);
  assert.deepEqual(lib.taskFile(root, '2026-11-02-some-card', 'research/mockups.html'), {
    status: 200,
    type: 'text/html',
    body: html,
  });
});

test('taskFile returns { status: 400 } and reads no file for a bad folder name, a .. path, an absolute path, or an extension outside html/md/png/svg', () => {
  // Every rejected input points at a file that really exists, so a 400 can only come from the checks, never from a miss.
  const root = brainWith([
    'tasks/Bad_Folder/research/mockups.html',
    'tasks/2026-11-02-some-card/research/notes.txt',
    'tasks/2026-11-02-some-card/research/mockups.html',
    'inbox.md',
  ]);
  const rejected = [
    { why: 'folder name outside ^\\d{4}-\\d{2}-\\d{2}-[a-z0-9-]+$', folder: 'Bad_Folder', relPath: 'research/mockups.html' },
    { why: 'path with ..', folder: '2026-11-02-some-card', relPath: '../../inbox.md' },
    { why: 'absolute path', folder: '2026-11-02-some-card', relPath: path.join(root, 'tasks/2026-11-02-some-card/research/mockups.html') },
    { why: 'extension outside html/md/png/svg', folder: '2026-11-02-some-card', relPath: 'research/notes.txt' },
  ];
  for (const { why, folder, relPath } of rejected) {
    assert.deepEqual(lib.taskFile(root, folder, relPath), { status: 400 }, `expected { status: 400 } for ${why}`);
  }
});

test('taskFile returns { status: 404 } for a valid folder and a well-formed path whose file does not exist', () => {
  // The folder exists and the path passes every check, so the only thing wrong with the request is the missing file.
  const root = brainWith(['tasks/2026-11-02-some-card/brief.md', 'tasks/2026-11-02-some-card/research/mockups.html']);
  assert.deepEqual(lib.taskFile(root, '2026-11-02-some-card', 'research/missing.html'), { status: 404 });
});

test('taskFile returns { status: 400 } and never the target body when the requested path, or a directory on it, is a symlink that leaves <root>/tasks/<folder>', () => {
  // Every string check passes (good folder name, no .., relative, .html); only the symlink target lies outside the task folder.
  const root = brainWith(['tasks/2026-11-02-some-card/brief.md', 'tasks/2026-11-02-some-card/research/', 'outside/']);
  const secret = 'SECRET: this body must never be served';
  fs.writeFileSync(path.join(root, 'secret.txt'), secret);
  fs.writeFileSync(path.join(root, 'outside/leak.html'), secret);
  fs.symlinkSync(path.join(root, 'secret.txt'), path.join(root, 'tasks/2026-11-02-some-card/research/leak.html'));
  fs.symlinkSync(path.join(root, 'outside'), path.join(root, 'tasks/2026-11-02-some-card/linked'), 'dir');
  const escapes = [
    { why: 'file symlink research/leak.html -> <root>/secret.txt', relPath: 'research/leak.html' },
    { why: 'directory symlink linked/ -> <root>/outside/', relPath: 'linked/leak.html' },
  ];
  for (const { why, relPath } of escapes) {
    const result = lib.taskFile(root, '2026-11-02-some-card', relPath);
    assert.notEqual(result.body, secret, `served the symlink target body for ${why}`);
    assert.deepEqual(result, { status: 400 }, `expected { status: 400 } for ${why}`);
  }
});

test('taskFiles orders the Markdown for the card pane, lists subfolders, hides status/gates files and skips symlinks that escape the folder', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'taskfiles-'));
  const dir = path.join(base, 'task');
  for (const d of ['research', 'threads', 'shots']) fs.mkdirSync(path.join(dir, d), { recursive: true });
  for (const f of ['log.md', 'zeta.md', 'alpha.md', 'qa.md', 'plan.md', 'brief.md', 'packet.md', 'research/synthesis.md', 'threads/ab12.md',
    'shots/after.png', 'diagram.mmd', 'status.json', 'gates.txt', 'gates.lock']) fs.writeFileSync(path.join(dir, f), 'x');
  fs.writeFileSync(path.join(base, 'secret.md'), 'outside');
  fs.symlinkSync(path.join(base, 'secret.md'), path.join(dir, 'escape.md'));
  fs.symlinkSync('/etc', path.join(dir, 'etc'));
  fs.symlinkSync(path.join(dir, 'brief.md'), path.join(dir, 'inside.md'));

  const { md, other } = lib.taskFiles(dir);
  assert.deepEqual(md, ['brief.md', 'plan.md', 'packet.md', 'qa.md', 'alpha.md', 'inside.md', 'zeta.md', 'research/synthesis.md', 'threads/ab12.md', 'log.md']);
  assert.deepEqual(other, ['diagram.mmd', 'shots/after.png']);
});

test('taskFiles on a folder with only brief.md and log.md returns just those two', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskfiles-'));
  for (const f of ['log.md', 'brief.md']) fs.writeFileSync(path.join(dir, f), 'x');
  assert.deepEqual(lib.taskFiles(dir), { md: ['brief.md', 'log.md'], other: [] });
});
