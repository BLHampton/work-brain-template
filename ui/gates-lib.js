// Pure helpers for the gate lock: hash a card's test files (gates.txt) into gates.lock, and compare later.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function gateFiles(root, folder) {
  const dir = path.join(root, folder);
  const { repo } = JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8'));
  const list = path.join(dir, 'gates.txt');
  const rels = fs.existsSync(list) ? fs.readFileSync(list, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean) : [];
  return { dir, files: rels.map((rel) => ({ rel, abs: path.resolve(repo, rel) })) };
}

// Writes gates.lock as `<sha>  <rel>` lines; returns the count.
function lock(root, folder) {
  const { dir, files } = gateFiles(root, folder);
  fs.writeFileSync(path.join(dir, 'gates.lock'), files.map((f) => `${sha(f.abs)}  ${f.rel}\n`).join(''));
  return files.length;
}

// Returns the rel paths whose hash differs from gates.lock or that no longer exist; [] when every gate is intact.
function check(root, folder) {
  const { dir, files } = gateFiles(root, folder);
  const lockFile = path.join(dir, 'gates.lock');
  const locked = fs.existsSync(lockFile)
    ? Object.fromEntries(fs.readFileSync(lockFile, 'utf8').split('\n').filter(Boolean).map((l) => l.split('  ').reverse()))
    : {};
  return files.filter((f) => !fs.existsSync(f.abs) || locked[f.rel] !== sha(f.abs)).map((f) => f.rel);
}

module.exports = { lock, check };
