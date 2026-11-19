// Shared helpers for the cards UI: task folder names, repo lookup, status.json and log.md writes, park / unpark / drop.
const fs = require('node:fs');
const path = require('node:path');

const FOLDER = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/;

function safeTaskFolder(name) {
  return typeof name === 'string' && FOLDER.test(name) ? name : null;
}

function logHeader(root) {
  const tpl = path.join(root, 'templates', 'log.md');
  if (!fs.existsSync(tpl)) return '';
  const head = fs.readFileSync(tpl, 'utf8').split('\n').filter((l) => l.startsWith('<!--'));
  return head.length ? `${head.join('\n')}\n` : '';
}

// One line at the end of a task's log.md (started from the template header).
function appendLog(root, folder, line) {
  const safe = safeTaskFolder(folder);
  if (!safe) throw new Error(`bad task folder: ${folder}`);
  const logPath = path.join(root, 'tasks', safe, 'log.md');
  const existing = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : logHeader(root);
  const sep = existing === '' || existing.endsWith('\n') ? '' : '\n';
  fs.writeFileSync(logPath, `${existing}${sep}${line}\n`);
}

function readRepos(root) {
  const dir = path.join(root, 'repos');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => {
    const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    return { name: path.basename(f, '.json'), path: r.path, title: r.name || '', defaultBranch: r.defaultBranch || 'main' };
  });
}

function repoSection(text) {
  const m = /^##\s*repo \+ branch\s*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/m.exec(text);
  return m ? m[1] : '';
}

function repoKeys(r) {
  return [r.name, r.title, r.path, path.basename(r.path || '')].filter(Boolean).map((k) => k.toLowerCase());
}

// Longest matching key wins, so a repo whose name contains another repo's name is not shadowed by it.
function repoMentionedIn(repos, text) {
  if (!text) return null;
  return repos.reduce((best, r) => {
    const longest = Math.max(0, ...repoKeys(r).filter((k) => text.includes(k)).map((k) => k.length));
    return longest > best.longest ? { repo: r, longest } : best;
  }, { repo: null, longest: 0 }).repo;
}

function repoForTask(root, folder) {
  const brief = path.join(root, 'tasks', folder, 'brief.md');
  if (!fs.existsSync(brief)) return null;
  const text = fs.readFileSync(brief, 'utf8').toLowerCase();
  const repos = readRepos(root);
  const hit = repoMentionedIn(repos, repoSection(text))
    || repoMentionedIn(repos, text)
    || (repos.length === 1 ? repos[0] : null);
  return hit ? { name: hit.name, path: hit.path } : null;
}

function readText(file, fallback = '') {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : fallback;
}

function writeStatus(root, folder, patch) {
  const safe = safeTaskFolder(folder);
  if (!safe) throw new Error(`bad task folder: ${folder}`);
  const file = path.join(root, 'tasks', safe, 'status.json');
  const next = { ...JSON.parse(readText(file, '{}')), ...patch, updated: new Date().toISOString() };
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

// Park / bring back / drop: the task's status.json records `parked` or `stage: done` + `dropped`.
const parkItems = (root, folder) => writeStatus(root, folder, { parked: true });
const restoreItems = (root, folder) => writeStatus(root, folder, { parked: false });
const dropItems = (root, folder, date) => writeStatus(root, folder, { stage: 'done', dropped: date });

module.exports = { appendLog, safeTaskFolder, repoForTask, readRepos, writeStatus, parkItems, restoreItems, dropItems };
