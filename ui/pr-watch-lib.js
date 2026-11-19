// Pure helpers for the PR watcher. No I/O here: the CLI injects the `gh` call and owns the files.
const GITHUB_PR = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)(?:[/?#].*)?$/;

// `{ owner, repo, number }` for a GitHub PR url, `null` for anything else (TFS included).
function parsePrUrl(url) {
  const m = GITHUB_PR.exec(String(url || '').trim());
  return m ? { owner: m[1], repo: m[2], number: Number(m[3]) } : null;
}

// A new watch list with the PR appended next to its first snapshot. Adding never raises a card.
function add(list, { url, task, as }, snapshot) {
  return { list: [...list, { url, task, as, snapshot }], cards: [] };
}

const FINISHED_WORDS = { MERGED: 'merged', CLOSED: 'closed' };
const REVIEW_VERBS = { APPROVED: 'approved', CHANGES_REQUESTED: 'requested changes', COMMENTED: 'commented' };

// Items in `now` that are not in `before` (by id) and were not written by `me`.
function fresh(before, now, me) {
  const seen = new Set(before.map((item) => item.id));
  return now.filter((item) => !seen.has(item.id) && item.author !== me);
}

const HEADLINE_MAX = 100;

// The card headline: at most HEADLINE_MAX characters, ending in an ellipsis when cut.
function headline(text) {
  return text.length > HEADLINE_MAX ? `${text.slice(0, HEADLINE_MAX - 1)}…` : text;
}

// What changed on one watched PR since its snapshot, as its card's new state, headline and timeline texts.
// Never mutates its inputs. The headline is whole here; the card line is cut where it is written.
function check(entry, current, me, today) {
  // Merged or closed since the snapshot: say so once; the entry stays until its card is stamped Done.
  const finished = current.state !== entry.snapshot.state ? FINISHED_WORDS[current.state] : undefined;
  // New commits on a PR we reviewed queue a re-review at the new head; a finished PR is never re-reviewed.
  const moved = !finished && entry.as === 'reviewed' && current.headRefOid !== entry.snapshot.headRefOid;
  // Already queued: a further push only moves the queued sha, it announces nothing.
  const requeue = moved && entry.rereview !== 'queued';
  const changes = [
    ...fresh(entry.snapshot.comments, current.comments, me).map((c) => `${c.author} commented`),
    ...fresh(entry.snapshot.reviews, current.reviews, me)
      .filter((r) => r.state !== 'PENDING')
      .map((r) => `${r.author} ${REVIEW_VERBS[r.state] || 'reviewed'}`),
    ...(requeue ? ['new commits'] : []),
  ];
  // Where the card stands now: merged / closed, over re-review queued, over updated.
  const stands = finished || (requeue ? 're-review queued' : changes.length > 0 ? 'updated' : null);
  return {
    entry: {
      ...entry,
      snapshot: current,
      ...(moved ? { rereview: 'queued', rereviewSha: current.headRefOid } : {}),
    },
    stands,
    headline: stands && changes.length > 0 ? `${stands}: ${changes.join('; ')}` : stands,
    timeline: [...changes, ...(finished ? [finished] : [])],
    events: requeue ? [`REREVIEW ${entry.task} ${entry.url} ${current.headRefOid}`] : [],
    remove: false,
  };
}

// One pass over the watch list. `fetch(entry)` returns the PR's current snapshot or throws;
// a throw leaves that entry as it was and reports one single-line error. Never mutates `list`.
function poll(list, fetch, me, today) {
  const out = { list: [], updates: [], events: [], errors: [] };
  for (const entry of list) {
    // Already merged or closed: nothing more to watch, it waits for its Done stamp.
    if (FINISHED_WORDS[entry.snapshot.state]) {
      out.list.push(entry);
      continue;
    }
    let current;
    try {
      current = fetch(entry);
    } catch (err) {
      const message = String((err && err.message) || err).replace(/\s*[\r\n]+\s*/g, ' ');
      out.errors.push(`pr-watch: ${entry.url}: ${message}`);
      out.list.push(entry);
      continue;
    }
    const result = check(entry, current, me, today);
    if (!result.remove) out.list.push(result.entry);
    if (result.stands) {
      const { repo, number } = parsePrUrl(entry.url) || {};
      const { stands, headline: text, timeline } = result;
      out.updates.push({ task: entry.task, url: entry.url, repo, number, stands, headline: text, timeline });
    }
    out.events.push(...result.events);
  }
  return out;
}

// A new watch list without the PR with that url. Never mutates `list`.
function remove(list, url) {
  return list.filter((entry) => entry.url !== url);
}

// A new watch list where the PR with that url no longer has a queued re-review. Never mutates `list`.
function done(list, url) {
  return list.map((entry) => {
    if (entry.url !== url) return entry;
    const { rereview, rereviewSha, ...rest } = entry;
    return rest;
  });
}

module.exports = { parsePrUrl, add, check, poll, remove, done, headline };
