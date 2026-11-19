// Pure helpers for card threads: one chat thread per card, inside its task folder.
const fs = require('node:fs');
const path = require('node:path');
const { safeTaskFolder } = require('./inbox-lib');

// The one chat thread of a card: tasks/<folder>/threads/card.md. Throws on a folder safeTaskFolder rejects.
function threadFile(root, folder) {
  const safe = safeTaskFolder(folder);
  if (!safe) throw new Error('bad task folder');
  return path.join(root, 'tasks', safe, 'threads', 'card.md');
}

const pad = (n) => String(n).padStart(2, '0');

// Append one thread line; writes the `# Thread · <card.text>` header first when the file is new. `now` is a local-time Date.
function appendLine(file, { who, text, card }, now = new Date()) {
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const header = fs.existsSync(file) ? '' : `# Thread · ${card.text}\n\n`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${header}- ${stamp} — ${who}: ${text.replace(/\s*[\r\n\u2028\u2029]+\s*/g, ' ')}\n`);
}

const LINE = /^- (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) — ([^:]+): (.*)$/;

// Thread file text -> [{ ts, who, text }]; header, blanks and anything not a dash line are skipped.
function parseThread(text) {
  return text.split('\n').flatMap((line) => {
    const m = LINE.exec(line);
    return m ? [{ ts: m[1], who: m[2], text: m[3] }] : [];
  });
}

module.exports = { threadFile, appendLine, parseThread };
