// Pure helpers for reading cards: parse a task's question.md and packet.md.

// Body lines of one `## <name>` section exactly as written.
function rawSection(md, name) {
  const lines = md.split('\n');
  const start = lines.indexOf(`## ${name}`);
  if (start < 0) return [];
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  return lines.slice(start + 1, end < 0 ? undefined : end);
}

// Body lines of one `## <name>` section, trimmed, blanks and placeholders dropped.
const section = (md, name) => rawSection(md, name).map((l) => l.trim()).filter((l) => l && !isPlaceholder(l));

// An unfilled template slot such as `<option>`.
const isPlaceholder = (s) => /^<[^>]*>$/.test(s);
// A line still holding a template slot anywhere, e.g. `# <card> — <title>` or `git -C <repo> push`.
const hasPlaceholder = (s) => /<[^<>\s][^<>]*>/.test(s);
// Ship is unfilled only while it holds a packet-template slot; `<email>`, `< file`, heredocs are real shell.
const hasShipSlot = (s) => /<(repo|type|description|branch)>/.test(s);
const lf = (md) => md.replace(/\r\n/g, '\n');

// { question, options: [{ letter, label, consequence }], defaultLetter, blocked }; options split on the first " — ".
// Keys whose section is missing or still a template placeholder are left out.
function parseQuestion(md) {
  md = lf(md);
  const options = section(md, 'Options').map((l) => l.match(/^([A-Z]|\d+)\.\s+(.*)$/)).filter(Boolean).map(([, letter, rest]) => {
    const at = rest.indexOf(' — ');
    return at < 0 ? { letter, label: rest, consequence: '' } : { letter, label: rest.slice(0, at), consequence: rest.slice(at + 3) };
  }).filter((o) => !isPlaceholder(o.label));
  const def = (section(md, 'Default')[0] || '').replace(/^Option\s+/, '').match(/^([A-Z]|\d+)\b/);
  const question = section(md, 'Question').join(' ');
  const blocked = section(md, 'Blocked meanwhile').join(' ');
  return {
    ...(question && { question }),
    ...(options.length && { options }),
    ...(def && { defaultLetter: def[1] }),
    ...(blocked && { blocked }),
  };
}

// { title, look: [flag], ship: commands } from a packet.md; ship is the first fenced block of ## Ship, untouched.
function parsePacket(md) {
  md = lf(md);
  const heading = (md.split('\n').find((l) => l.startsWith('# ')) || '').slice(2).trim();
  const title = hasPlaceholder(heading) ? '' : heading;
  // every flag line, bulleted or not; HTML comments and "none" dropped (shortcut: a comment of 3+ lines leaks its middle)
  const look = section(md, 'LOOK').filter((l) => !l.startsWith('<!--') && !l.endsWith('-->'))
    .map((l) => l.replace(/^- /, '')).filter((l) => l.toLowerCase() !== 'none');
  const body = rawSection(md, 'Ship');
  const open = body.findIndex((l) => l.trim().startsWith('```'));
  const close = body.findIndex((l, i) => i > open && l.trim().startsWith('```'));
  const fence = open < 0 ? '' : body.slice(open + 1, close < 0 ? undefined : close).join('\n');
  const ship = hasShipSlot(fence) ? '' : fence;
  return { title, look, ship };
}

// Approve button text: the question's default option, "run Ship" for a packet with commands, else plain "Approve".
function approveLabel({ question, packet } = {}) {
  const def = question && (question.options || []).find((o) => o.letter === question.defaultLetter);
  if (def) return `Approve: ${def.letter} — ${def.label}`;
  if (packet && packet.ship) return 'Approve: run Ship';
  return 'Approve';
}

module.exports = { parseQuestion, parsePacket, approveLabel };
