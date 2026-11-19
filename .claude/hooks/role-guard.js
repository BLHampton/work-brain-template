// PreToolUse hook: test-writer may only edit test files, implementer only non-test files.
// Allow = exit 0 silently. Block = exit 2 + one-line reason on stderr (shown to the agent).
// Our own bugs (bad JSON, missing repos dir) never block: exit 0 with a warning.
const fs = require('node:fs');
const path = require('node:path');

const ROLES = ['test-writer', 'implementer'];
const GUARDED_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];
const BRAIN_ROOT = process.env.WORK_BRAIN_ROOT || path.resolve(__dirname, '..', '..');

const slashes = (p) => p.split(path.sep).join('/');

function block(reason) {
  process.stderr.write(`role-guard: ${reason}\n`);
  process.exit(2);
}

function warn(reason) {
  process.stderr.write(`role-guard: warning: ${reason}; allowing\n`);
  process.exit(0);
}

function readRole(argv) {
  const role = argv[argv.indexOf('--role') + 1];
  if (argv.indexOf('--role') === -1 || !ROLES.includes(role)) {
    block(`--role must be one of ${ROLES.join('|')}, got "${role || ''}"`);
  }
  return role;
}

function readRepos(root) {
  const dir = path.join(root, 'repos');
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
    .map((r) => ({ name: r.name, path: slashes(path.resolve(r.path)), testPatterns: r.testPatterns || [] }));
}

function targetPath(input) {
  const raw = input.tool_input.file_path || input.tool_input.notebook_path;
  if (!raw) throw new Error(`${input.tool_name} input has no file_path/notebook_path`);
  return slashes(path.resolve(input.cwd || process.cwd(), raw));
}

const isInside = (file, dir) => file === dir || file.startsWith(dir + '/');

function findRepo(repos, file) {
  return repos
    .filter((r) => isInside(file, r.path))
    .sort((a, b) => b.path.length - a.path.length)[0];
}

function decide(role, file, repos) {
  if (isInside(file, slashes(path.resolve(BRAIN_ROOT, 'tasks')))) return;
  const repo = findRepo(repos, file);
  if (!repo) return block(`path is outside every known repo and the task folder: ${file}`);
  const rel = file.slice(repo.path.length + 1);
  const isTest = repo.testPatterns.some((p) => new RegExp(p).test(rel));
  if (role === 'test-writer' && !isTest) {
    block(`test-writer may only edit test files (matched none of ${repo.name} testPatterns): ${rel}`);
  }
  if (role === 'implementer' && isTest) {
    block(`implementer may not edit test files (matched a ${repo.name} testPattern): ${rel}`);
  }
}

function main() {
  const role = readRole(process.argv.slice(2));
  let input;
  try {
    input = JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch (e) {
    return warn(`could not parse hook input: ${e.message}`);
  }
  if (!GUARDED_TOOLS.includes(input.tool_name)) return;
  try {
    decide(role, targetPath(input), readRepos(BRAIN_ROOT));
  } catch (e) {
    warn(e.message);
  }
}

main();
