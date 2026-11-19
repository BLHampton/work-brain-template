// Pure helpers for the Files tab: the one path check that keeps the browser inside the brain.
const fs = require('fs');
const path = require('path');

// Absolute path when `requested` resolves under tasks/ or retros/ or is suggestion-box.md / misses.md / answers.md; null otherwise.
// path.relative normalizes `..` and absolute inputs, so a plain prefix check is the whole test.
function safeBrainPath(root, requested) {
  const abs = path.resolve(root, requested);
  const rel = path.relative(root, abs);
  const ok = rel === 'suggestion-box.md' || rel === 'misses.md' || rel === 'answers.md' || rel.startsWith(`tasks${path.sep}`) || rel.startsWith(`retros${path.sep}`);
  return ok ? abs : null;
}

const TASK_FOLDER = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/;
const SERVED_EXT = /\.(html|md|png|svg)$/;

// Absolute path of `relPath` inside `<root>/tasks/<folder>`, or null when the folder name, a `..` segment,
// an absolute path or the extension rules it out. No fs call: rejections never touch the disk.
function taskFilePath(root, folder, relPath) {
  if (typeof folder !== 'string' || typeof relPath !== 'string') return null;
  if (!TASK_FOLDER.test(folder) || !SERVED_EXT.test(relPath)) return null;
  if (path.isAbsolute(relPath) || relPath.split(/[\\/]/).includes('..')) return null;
  const dir = path.resolve(root, 'tasks', folder);
  const abs = path.resolve(dir, relPath);
  return abs.startsWith(dir + path.sep) ? abs : null;
}

const CONTENT_TYPE = { '.html': 'text/html', '.md': 'text/markdown', '.svg': 'image/svg+xml', '.png': 'image/png' };

// A task-folder file as the /api/task-file route serves it: { status, type, body }; { status: 400 } when the request is
// malformed or a symlink on the path leaves the task folder, { status: 404 } when it is well-formed but the file is not
// there (a directory counts as not there). png bodies are Buffers, the rest utf8 strings.
function taskFile(root, folder, relPath) {
  const abs = taskFilePath(root, folder, relPath);
  if (!abs) return { status: 400 };
  if (!fs.existsSync(abs)) return { status: 404 };
  // The string checks above cannot see symlinks: re-check the real location against the real task folder.
  const realDir = fs.realpathSync(path.resolve(root, 'tasks', folder));
  const real = fs.realpathSync(abs);
  if (!real.startsWith(realDir + path.sep)) return { status: 400 };
  if (!fs.statSync(real).isFile()) return { status: 404 };
  const type = CONTENT_TYPE[path.extname(abs)];
  const body = type === 'image/png' ? fs.readFileSync(real) : fs.readFileSync(real, 'utf8');
  return { status: 200, type, body };
}

// Sorted names in `dir` that pass `keep`; [] when the directory is missing.
function listDir(dir, keep) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter(keep).map((e) => e.name).sort();
}

const isDoc = (e) => e.isFile() && /\.(md|mmd)$/.test(e.name);

// Everything the Files tab may show: task folders with their .md/.mmd files, retros/*.md, suggestion-box.md, misses.md, answers.md.
function brainTree(root) {
  const tasks = listDir(path.join(root, 'tasks'), (e) => e.isDirectory()).map((name) => ({
    folder: `tasks/${name}`,
    files: listDir(path.join(root, 'tasks', name), isDoc),
  }));
  const retros = listDir(path.join(root, 'retros'), (e) => e.isFile() && e.name.endsWith('.md')).map((f) => `retros/${f}`);
  const suggestionBox = fs.existsSync(path.join(root, 'suggestion-box.md')) ? 'suggestion-box.md' : null;
  const misses = fs.existsSync(path.join(root, 'misses.md')) ? 'misses.md' : null;
  const answers = fs.existsSync(path.join(root, 'answers.md')) ? 'answers.md' : null;
  return { tasks, retros, suggestionBox, misses, answers };
}

const FIRST = ['brief', 'plan', 'question', 'packet', 'review', 'qa', 'pr-comment', 'ticket-update', 'smoke-test'].map((n) => `${n}.md`);
const HIDDEN = new Set(['status.json', 'gates.txt', 'gates.lock']);

// Every file under a task folder as relative paths, sorted; symlinks that resolve outside `dir` are skipped.
// shortcut: symlinked directories are not followed (no loop guard needed), follow them if a card ever needs it.
function walk(dir, real, rel = '') {
  return fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) return walk(dir, real, r);
    if (e.isFile()) return [r];
    if (!e.isSymbolicLink()) return [];
    let target;
    try { target = fs.realpathSync(path.join(dir, r)); } catch { return []; }
    return target.startsWith(`${real}${path.sep}`) && fs.statSync(target).isFile() ? [r] : [];
  });
}

// { md, other } for a task folder's card pane: md in pane order (FIRST, other top-level, subfolders, log.md last), other = the rest minus status/gates files.
function taskFiles(dir) {
  const all = walk(dir, fs.realpathSync(dir));
  const rank = (f) => (FIRST.includes(f) ? FIRST.indexOf(f) : f === 'log.md' ? 30 : f.includes('/') ? 20 : 10);
  const md = all.filter((f) => f.endsWith('.md')).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return { md, other: all.filter((f) => !f.endsWith('.md') && !HIDDEN.has(f)) };
}

module.exports = { safeBrainPath, taskFile, brainTree, taskFiles };
