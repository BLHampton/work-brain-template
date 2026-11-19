#!/usr/bin/env node
// Local cards UI. Usage: node ui/server.js [--port 4747] [--open]. Binds 127.0.0.1 only.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const routes = require('./routes');
const { needsYouNotifier } = require('./toast');
const { defaultRun } = require('./lead-lib');

const argv = process.argv.slice(2);
const HOST = '127.0.0.1';
const MAX_BODY = 1024 * 1024;
const KEEPALIVE_MS = 25000;
const IDLE_TICK_MS = 60000;
const LEAD_IDLE_MIN = Number(process.env.LEAD_IDLE_MIN) || 60;

const pad = (n) => String(n).padStart(2, '0');
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function send(res, status, data, error = null) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: status < 400, data, error }));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > MAX_BODY) reject(new routes.HttpError(413, 'body too large'));
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new routes.HttpError(400, 'body must be JSON')); }
    });
    req.on('error', reject);
  });
}

// Server-sent events: one `data: <json>` line per stamped answer. The dispatcher listens with `curl -sN /api/events`.
function subscribe(clients, req, res) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  res.write(': listening\n\n');
  const ping = setInterval(() => res.write(': ping\n\n'), KEEPALIVE_MS);
  res.listener = /^curl\//.test(req.headers['user-agent'] || ''); // the dispatcher's stamp listener, not a browser tab
  clients.add(res);
  if (res.listener) broadcastListening(clients);
  res.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
    if (res.listener) broadcastListening(clients);
  });
}

const broadcast = (clients, event) => { for (const c of clients) c.write(`data: ${JSON.stringify(event)}\n\n`); };
const listeners = (clients) => [...clients].filter((c) => c.listener).length;
const broadcastListening = (clients) => broadcast(clients, { type: 'listening', listeners: listeners(clients) });

// DNS rebinding and cross-site POSTs: only this server's own Host, and on a POST no Origin or this server's own.
function checkOrigin(req) {
  const port = req.socket.localPort;
  const own = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!own.includes(req.headers.host)) throw new routes.HttpError(403, 'wrong Host');
  const { origin } = req.headers;
  if (req.method === 'POST' && origin !== undefined && !own.map((h) => `http://${h}`).includes(origin)) throw new routes.HttpError(403, 'cross-site Origin');
}

async function handle(ROOT, clients, run, req, res) {
  checkOrigin(req);
  const url = new URL(req.url, `http://${HOST}`);
  const parts = url.pathname.split('/').filter(Boolean);
  if (req.method === 'GET' && parts.length === 0) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
  }
  if (req.method === 'GET' && parts[1] === 'task' && parts.length === 3) return send(res, 200, routes.task(ROOT, parts[2]));
  if (req.method === 'GET' && parts[1] === 'task' && parts[3] === 'shot' && parts.length === 5) {
    const { file, type } = routes.shot(ROOT, parts[2], parts[4]);
    res.writeHead(200, { 'content-type': type });
    return fs.createReadStream(file).pipe(res);
  }
  if (req.method === 'GET' && url.pathname === '/api/roster') return send(res, 200, routes.rosterFor(ROOT));
  if (req.method === 'GET' && url.pathname === '/api/diff') return send(res, 200, routes.diff(ROOT, url.searchParams.get('repo')));
  if (req.method === 'GET' && url.pathname === '/api/board') return send(res, 200, routes.board(ROOT));
  if (req.method === 'GET' && url.pathname === '/api/index') return send(res, 200, routes.index(ROOT));
  if (req.method === 'GET' && url.pathname === '/api/pipeline') return send(res, 200, routes.pipeline(ROOT));
  if (req.method === 'GET' && url.pathname === '/api/stats') return send(res, 200, routes.stats(ROOT));
  if (req.method === 'GET' && url.pathname === '/api/files') return send(res, 200, routes.files(ROOT));
  if (req.method === 'GET' && url.pathname === '/api/file') return send(res, 200, routes.file(ROOT, url.searchParams.get('path')));
  if (req.method === 'GET' && url.pathname === '/api/task-file') {
    const { type, body } = routes.taskFile(ROOT, url.searchParams.get('folder'), url.searchParams.get('path'));
    // Worker-written files are served from the UI's own origin: `sandbox` gives them an opaque origin, no scripts, no fetch to /api/*.
    res.writeHead(200, {
      'content-type': Buffer.isBuffer(body) ? type : `${type}; charset=utf-8`,
      'content-security-policy': 'sandbox',
    });
    return res.end(body);
  }
  if (req.method === 'GET' && url.pathname === '/api/events') return subscribe(clients, req, res);
  if (req.method === 'GET' && url.pathname === '/api/listening') return send(res, 200, { listeners: listeners(clients) });
  if (req.method === 'GET' && url.pathname === '/api/cards') return send(res, 200, routes.cards(ROOT, run));
  if (req.method === 'POST' && url.pathname === '/api/card/new') {
    const { row, raised } = routes.cardNew(ROOT, await readBody(req), today());
    broadcast(clients, { type: 'new', ...raised });
    return send(res, 200, row);
  }
  if (req.method === 'POST' && url.pathname === '/api/card/decided') {
    const decided = routes.cardDecided(ROOT, await readBody(req));
    broadcast(clients, { type: 'decided', ...decided });
    return send(res, 200, decided);
  }
  if (req.method === 'POST' && url.pathname === '/api/wind-down') {
    const closed = routes.windDown(ROOT, run);
    broadcast(clients, { type: 'winddown' });
    return send(res, 200, { ...closed, listeners: listeners(clients) });
  }
  if (req.method === 'POST' && url.pathname === '/api/card/answer') {
    const { row, answered } = routes.cardAnswer(ROOT, await readBody(req), today());
    broadcast(clients, { type: 'answer', ...answered });
    return send(res, 200, row);
  }
  if (req.method === 'POST' && url.pathname === '/api/card/pr-stamp') {
    const { row, answered } = routes.cardPrStamp(ROOT, await readBody(req), today());
    broadcast(clients, { type: 'answer', ...answered });
    return send(res, 200, row);
  }
  if (req.method === 'POST' && ['/api/card/close', '/api/card/reopen'].includes(url.pathname)) {
    const name = url.pathname.slice('/api/card/'.length);
    const { task, row } = routes[name === 'close' ? 'cardClose' : 'cardReopen'](ROOT, await readBody(req), today(), run);
    broadcast(clients, { type: name, task });
    return send(res, 200, row);
  }
  if (req.method === 'GET' && url.pathname === '/api/card/thread') return send(res, 200, routes.cardThread(ROOT, url.searchParams.get('task'), run));
  if (req.method === 'POST' && url.pathname === '/api/card/chat') return send(res, 200, routes.chat(ROOT, await readBody(req), run));
  if (req.method === 'POST' && url.pathname === '/api/card/chat/retry') return send(res, 200, routes.chatRetry(ROOT, await readBody(req), run));
  if (req.method === 'POST' && url.pathname === '/api/card/lead/focus') return send(res, 200, routes.leadFocus(ROOT, await readBody(req), run));
  if (req.method === 'POST' && ['/api/park', '/api/unpark', '/api/drop'].includes(url.pathname)) {
    const name = url.pathname.slice('/api/'.length);
    const { task, status } = routes[name](ROOT, await readBody(req), today());
    broadcast(clients, { type: name, task, status });
    return send(res, 200, status);
  }
  throw new routes.HttpError(404, 'not found');
}

// Polls (not fs.watch) because inotify is unreliable on WSL mounts; watchFile on a missing file fires when it appears.
function watchFiles(ROOT, clients, server, notify) {
  const dispatchFile = path.join(ROOT, 'ui', 'dispatch.jsonl');
  const onDispatch = () => broadcast(clients, { type: 'dispatch' });
  fs.watchFile(dispatchFile, { interval: 1000 }, onDispatch);
  // inotify is unreliable here: poll every card.json / status.json / pr.md / threads/card.md mtime and broadcast when the joined string changes.
  // notify gets the card rows on the first tick (to remember who already needs the manager) and on every change.
  const stamp = () => {
    const dir = path.join(ROOT, 'tasks');
    try {
      return fs.readdirSync(dir).sort().flatMap((n) => ['card.json', 'status.json', 'pr.md', 'threads/card.md'].map((f) => {
        try { return fs.statSync(path.join(dir, n, f)).mtimeMs; } catch { return ''; }
      })).join(',');
    } catch { return ''; }
  };
  let last = null;
  const poll = setInterval(() => {
    const now = stamp();
    if (last !== null && now !== last) broadcast(clients, { type: 'cards' });
    if (now !== last) {
      try { notify(routes.cards(ROOT)); } catch (e) { console.error(`toast: ${e.message}`); }
    }
    last = now;
  }, 1000);
  poll.unref();
  server.on('close', () => { clearInterval(poll); fs.unwatchFile(dispatchFile, onDispatch); });
}

// Every minute, close leads that sat idle past LEAD_IDLE_MIN; the next chat message resumes them.
function closeIdleLeads(ROOT, server, run) {
  const tick = setInterval(() => {
    try { routes.closeIdleLeads(ROOT, run, new Date(), LEAD_IDLE_MIN); } catch (e) { console.error(`idle leads: ${e.message}`); }
  }, IDLE_TICK_MS);
  tick.unref();
  server.on('close', () => clearInterval(tick));
}

function createServer(ROOT, { notify = needsYouNotifier({ spawn, log: console.error }), run = defaultRun } = {}) {
  const clients = new Set();
  const server = http.createServer((req, res) => {
    handle(ROOT, clients, run, req, res).catch((e) => {
      const status = e instanceof routes.HttpError ? e.status : 500;
      process.stderr.write(`${req.method} ${req.url} -> ${status}: ${status === 500 ? e.stack : e.message}\n`);
      if (!res.headersSent) send(res, status, null, status === 500 ? 'internal error' : e.message);
      else res.end();
    });
  });
  watchFiles(ROOT, clients, server, notify);
  closeIdleLeads(ROOT, server, run);
  return server;
}

function openBrowser(url) {
  const tryCmd = (cmds) => {
    if (!cmds.length) return console.log(`Open ${url} in your browser.`);
    spawn(cmds[0], [url], { stdio: 'ignore', detached: true }).on('error', () => tryCmd(cmds.slice(1))).unref();
  };
  tryCmd(['xdg-open', 'explorer.exe']);
}

module.exports = { createServer };

if (require.main === module) {
  const ROOT = process.env.WORK_BRAIN_ROOT || path.resolve(__dirname, '..');
  const PORT = Number(argv[argv.indexOf('--port') + 1]) || 4747;
  createServer(ROOT).listen(PORT, HOST, () => {
    const url = `http://${HOST}:${PORT}`;
    console.log(`work-brain cards UI on ${url} (root: ${ROOT})`);
    if (argv.includes('--open')) openBrowser(url);
  });
}
