#!/usr/bin/env node
'use strict';
/*
 * WORDDUEL load / abuse / reconnect tester
 * Written against the protocol in README.md (Socket.io 4.x, events in section 6).
 *
 *   npm i socket.io-client@4.7.5
 *   node loadtest.js help
 */
const { io } = require('socket.io-client');
const fs = require('fs');
const http = require('http');
const https = require('https');

// ───────────── CONFIG: change here if your server differs from the README ─────────────
const EV = {
  JOIN: 'join_room', JOINED: 'room_joined', OPP_JOINED: 'opponent_joined',
  COUNTDOWN: 'round_countdown', START: 'round_start',
  GUESS: 'submit_guess', RESULT: 'guess_result', OPP_RESULT: 'opponent_guess_result',
  ROUND_OVER: 'round_over', FINISHED: 'duel_finished',
  OPP_DC: 'opponent_disconnected', SYNC: 'game_state_sync',
  PLAYER_FINISHED: 'player_finished_round',
};
const ERROR_RE = /error|invalid|reject|full|not_found|denied|fail/i; // names of server "something went wrong" events
const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
// ──────────────────────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const mode = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'help';
const arg = (k, d) => {
  const i = argv.indexOf('--' + k);
  if (i < 0) return d;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) return true;
  return isNaN(v) ? v : Number(v);
};
const URL_ = String(arg('url', 'http://localhost:3000')).replace(/\/$/, '');
const TRANSPORTS = String(arg('transport', 'websocket')).split(',');
const O = {
  rounds: arg('rounds', 1),
  thinkMin: arg('think-min', 400),
  thinkMax: arg('think-max', 1500),
  maxGuesses: arg('max-guesses', 6),
  duelTimeout: arg('duel-timeout', 120) * 1000,
  verbose: !!arg('verbose', false),
};

// ───────────── helpers ─────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const mkCode = () => Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const mkPid = () => 'lt_' + Math.random().toString(36).slice(2, 10);
const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]);
};
const mx = (arr) => arr.reduce((m, v) => (v > m ? v : m), 0);
const bump = (o, k) => (o[k] = (o[k] || 0) + 1);
const isKnown = (ev) => Object.values(EV).includes(ev);

let WORDS = ['CRANE', 'SLATE', 'STARE', 'ROBOT', 'SPOON', 'GEESE', 'CLIMB', 'HOUSE', 'WATER', 'LIGHT',
  'MUSIC', 'PLANT', 'BREAD', 'CHAIR', 'DREAM', 'FLAME', 'GRAPE', 'HEART', 'JUICE', 'KNIFE'];
const wp = arg('words', null);
if (wp && wp !== true) {
  try {
    const j = JSON.parse(fs.readFileSync(wp, 'utf8'));
    let a = [];
    if (Array.isArray(j)) {
      a = j;
    } else if (typeof j === 'object' && j !== null) {
      if (Array.isArray(j.allowed) || Array.isArray(j.answers)) {
        a = [...(j.answers || []), ...(j.allowed || [])];
      } else {
        a = Object.keys(j);
      }
    }
    const w = a.filter((x) => typeof x === 'string' && x.length === 5).map((x) => x.toUpperCase());
    if (w.length) WORDS = w;
    console.log(`loaded ${WORDS.length} guess words from ${wp}`);
  } catch (e) { console.error('could not read --words file, using built-in list:', e.message); }
}
const randWord = () => WORDS[Math.floor(Math.random() * WORDS.length)];

function getJson(u) {
  return new Promise((res) => {
    const lib = u.startsWith('https') ? https : http;
    lib.get(u, (r) => {
      let b = ''; r.on('data', (d) => (b += d));
      r.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (_) {} res({ status: r.statusCode, body: b.slice(0, 300), json: j }); });
    }).on('error', (e) => res({ error: e.message }));
  });
}
async function healthLine(tag = '') {
  const h = await getJson(URL_ + '/healthz');
  console.log(`[health${tag}]`, h.error ? 'unreachable: ' + h.error : `HTTP ${h.status} ${h.json ? JSON.stringify(h.json) : h.body}`);
  return h;
}

// ───────────── metrics ─────────────
let M;
function resetMetrics() {
  M = { duels: 0, ok: 0, fail: {}, connectMs: [], joinMs: [], startMs: [], rttMs: [], fanoutMs: [],
    guessTimeouts: 0, guessRejected: 0, leaks: 0, unexpectedDc: 0, sockets: 0, active: 0,
    unknownEvents: {}, errorEvents: {} };
}
resetMetrics();
let lagSamples = [];
let lastTick = Date.now();
setInterval(() => { const n = Date.now(); lagSamples.push(n - lastTick - 100); lastTick = n; if (lagSamples.length > 600) lagSamples.shift(); }, 100).unref();

// ───────────── socket / bot plumbing ─────────────
function connect() {
  const t0 = Date.now();
  const s = io(URL_, { transports: TRANSPORTS, reconnection: false, timeout: 10000, forceNew: true });
  M.sockets++;
  s.once('disconnect', () => { M.sockets--; });
  return new Promise((res, rej) => {
    s.once('connect', () => { M.connectMs.push(Date.now() - t0); res(s); });
    s.once('connect_error', (e) => { M.sockets--; s.close(); rej(new Error('connect_error: ' + e.message)); });
  });
}
function waitFor(s, ev, ms = 8000, pred) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => { s.off(ev, h); rej(new Error('timeout waiting for ' + ev)); }, ms);
    function h(p) { if (pred && !pred(p)) return; clearTimeout(t); s.off(ev, h); res(p); }
    s.on(ev, h);
  });
}
function collect(s, ms) {
  return new Promise((res) => {
    const seen = []; const h = (ev) => seen.push(ev);
    s.onAny(h);
    setTimeout(() => { s.offAny(h); res(seen); }, ms);
  });
}

let botCounter = 0;
async function newBot() {
  const socket = await connect();
  const bot = { name: 'bot' + ++botCounter, socket, pid: mkPid(), roomId: null, live: false, finished: false, closing: false,
    sent: 0, lastSubmit: 0, pre: [], resolvePending: null, peer: null, playerNum: null, secretChecked: false };
  bot.done = new Promise((r) => (bot._done = r));
  bot.abort = new Promise((_, rej) => (bot._abort = rej));
  bot.abort.catch(() => {});
  bot.finish = () => { bot.finished = true; bot._done(); };
  bot.close = () => { bot.closing = true; bot.finished = true; socket.close(); };

  socket.onAny((ev, p) => {
    if (O.verbose) console.log(`  ${bot.name} <- ${ev} ${JSON.stringify(p) ? JSON.stringify(p).slice(0, 140) : ''}`);
    if (!isKnown(ev)) bump(ERROR_RE.test(ev) ? M.errorEvents : M.unknownEvents, ev);
    if (!isKnown(ev) && ERROR_RE.test(ev) && bot.resolvePending) { M.guessRejected++; bot.resolvePending('rejected'); }
    if (ev !== EV.RESULT && ev !== EV.ROUND_OVER && ev !== EV.FINISHED) bot.pre.push(JSON.stringify(p) || '');
  });
  socket.on(EV.START, () => { bot.live = true; bot.sent = 0; });
  socket.on(EV.RESULT, () => {
    if (bot.resolvePending) { M.rttMs.push(Date.now() - bot.lastSubmit); bot.resolvePending('ok'); }
  });
  socket.on(EV.OPP_RESULT, (p) => {
    if (bot.peer && bot.peer.lastSubmit) M.fanoutMs.push(Date.now() - bot.peer.lastSubmit);
    if (p && (p.guess || p.letters || p.word)) { M.leaks++; console.log('LEAK: opponent_guess_result contains letters:', JSON.stringify(p)); }
  });
  socket.on(EV.ROUND_OVER, (p) => {
    bot.live = false;
    const secret = p && p.secretWord;
    if (secret && !bot.secretChecked) {
      bot.secretChecked = true;
      function containsSecretValue(obj, target) {
        if (!obj || typeof obj !== 'object') return false;
        for (const [key, val] of Object.entries(obj)) {
          if (['currentRound', 'totalRounds', 'roundsMode', 'status', 'score'].includes(key)) continue;
          if (typeof val === 'string' && val.toUpperCase() === target) return true;
          if (typeof val === 'object' && containsSecretValue(val, target)) return true;
        }
        return false;
      }
      const targetWord = String(secret).toUpperCase();
      if (bot.pre.some((raw) => {
        try {
          const parsed = JSON.parse(raw);
          return containsSecretValue(parsed, targetWord);
        } catch (_) {
          return false;
        }
      })) {
        M.leaks++; console.log('LEAK: secret word appeared in a payload BEFORE round_over');
      }
    }
    bot.pre = [];
    if (p && p.isDuelOver) bot.finish();
  });
  socket.on(EV.FINISHED, () => bot.finish());
  socket.on('disconnect', (reason) => {
    if (!bot.closing && !bot.finished) { M.unexpectedDc++; bot._abort(new Error('disconnected: ' + reason)); }
  });
  return bot;
}

async function playLoop(bot) {
  while (!bot.finished) {
    if (!bot.live || bot.sent >= O.maxGuesses) { await sleep(100); continue; }
    await sleep(rand(O.thinkMin, O.thinkMax));
    if (!bot.live || bot.finished) continue;
    bot.sent++; bot.lastSubmit = Date.now();
    bot.socket.emit(EV.GUESS, { roomId: bot.roomId, playerId: bot.pid, guess: randWord() });
    const r = await new Promise((res) => {
      const t = setTimeout(() => { bot.resolvePending = null; res('timeout'); }, 5000);
      bot.resolvePending = (v) => { clearTimeout(t); bot.resolvePending = null; res(v); };
    });
    if (r === 'timeout' && bot.live && !bot.finished) M.guessTimeouts++;
  }
}

// Creates a started duel, no auto-play. Used by abuse/reconnect/storm tests.
async function liveRoom(rounds = 10) {
  const roomId = mkCode();
  const A = await newBot(); const B = await newBot();
  A.roomId = B.roomId = roomId; A.peer = B; B.peer = A;
  const ap = waitFor(A.socket, EV.START, 20000); const bp = waitFor(B.socket, EV.START, 20000);
  const j1 = waitFor(A.socket, EV.JOINED, 8000);
  A.socket.emit(EV.JOIN, { roomId, playerId: A.pid, roundsMode: 'fixed', totalRounds: rounds });
  await j1;
  const j2 = waitFor(B.socket, EV.JOINED, 8000);
  B.socket.emit(EV.JOIN, { roomId, playerId: B.pid });
  await j2;
  await Promise.all([ap, bp]);
  return { A, B, roomId };
}
const closeAll = (...b) => b.forEach((x) => x && x.close());

// ───────────── one full duel ─────────────
async function runDuel() {
  const roomId = mkCode();
  M.duels++; M.active++;
  let A, B;
  const fail = (why) => bump(M.fail, why);
  try {
    try { A = await newBot(); B = await newBot(); }
    catch (e) { return fail('connect_failed'); }
    A.roomId = B.roomId = roomId; A.peer = B; B.peer = A;

    const aJoin = waitFor(A.socket, EV.JOINED, 8000);
    A.socket.emit(EV.JOIN, { roomId, playerId: A.pid, roundsMode: 'fixed', totalRounds: O.rounds });
    try { await aJoin; } catch (e) { return fail('host_join_timeout'); }

    const aStart = waitFor(A.socket, EV.START, 25000); const bStart = waitFor(B.socket, EV.START, 25000);
    aStart.catch(() => {}); bStart.catch(() => {});
    const t0 = Date.now();
    const bJoin = waitFor(B.socket, EV.JOINED, 8000);
    B.socket.emit(EV.JOIN, { roomId, playerId: B.pid });
    let jp;
    try { jp = await bJoin; } catch (e) { return fail('guest_join_failed (room not found / other worker?)'); }
    M.joinMs.push(Date.now() - t0);
    if (jp && jp.playerNum !== undefined && jp.playerNum !== 2) return fail('guest_got_playerNum_' + jp.playerNum);
    try { await Promise.all([aStart, bStart]); } catch (e) { return fail('round_start_timeout'); }
    M.startMs.push(Date.now() - t0);

    playLoop(A); playLoop(B);
    try {
      await Promise.race([
        Promise.all([A.done, B.done]), A.abort, B.abort,
        sleep(O.duelTimeout).then(() => { throw new Error('finish_timeout'); }),
      ]);
    } catch (e) { return fail(e.message.startsWith('disconnected') ? 'unexpected_disconnect' : e.message); }
    M.ok++;
  } finally {
    M.active--;
    closeAll(A, B);
  }
}

// ───────────── reporting ─────────────
function summary(label) {
  const failed = M.duels - M.ok;
  const failRate = M.duels ? failed / M.duels : 0;
  const lag = pct(lagSamples, 95);
  console.log(`\n══════ ${label} ══════`);
  console.log(`duels            ${M.duels}  ok ${M.ok} (${M.duels ? (100 * M.ok / M.duels).toFixed(1) : 0}%)  failed ${failed}`);
  if (failed) console.log('failure reasons ', M.fail);
  console.log(`connect ms       p50 ${pct(M.connectMs, 50)}  p95 ${pct(M.connectMs, 95)}  max ${mx(M.connectMs)}`);
  console.log(`join ms          p50 ${pct(M.joinMs, 50)}  p95 ${pct(M.joinMs, 95)}`);
  console.log(`guess RTT ms     p50 ${pct(M.rttMs, 50)}  p95 ${pct(M.rttMs, 95)}  p99 ${pct(M.rttMs, 99)}  (${M.rttMs.length} samples)`);
  console.log(`opp fan-out ms   p50 ${pct(M.fanoutMs, 50)}  p95 ${pct(M.fanoutMs, 95)}  p99 ${pct(M.fanoutMs, 99)}`);
  console.log(`guess timeouts ${M.guessTimeouts}   guess rejected ${M.guessRejected}   mid-game disconnects ${M.unexpectedDc}   secret/letter leaks ${M.leaks}`);
  if (Object.keys(M.errorEvents).length) console.log('error-like events', M.errorEvents);
  if (Object.keys(M.unknownEvents).length) console.log('events not in README', M.unknownEvents);
  if (lag > 150) console.log(`WARNING: the TESTER was lagging (p95 event-loop lag ${lag}ms). Results are unreliable: lower --pairs or run from several machines.`);
  return { failRate, p95rtt: pct(M.rttMs, 95), p95fan: pct(M.fanoutMs, 95), lag };
}

// ───────────── scenarios ─────────────
async function loadTest({ pairs, ramp = 0, duration = 0, label }) {
  const t0 = Date.now();
  const endAt = t0 + (ramp + duration) * 1000;
  const loops = duration > 0;
  console.log(`${label}: ${pairs} pairs (${pairs * 2} sockets), ramp ${ramp}s${loops ? `, hold ${duration}s` : ''} -> ${URL_}`);
  const ticker = setInterval(() => {
    console.log(`[t=${Math.round((Date.now() - t0) / 1000)}s] active duels ${M.active} | sockets ${M.sockets} | ok ${M.ok} fail ${M.duels - M.ok - M.active} | rtt p95 ${pct(M.rttMs.slice(-2000), 95)}ms | fan-out p95 ${pct(M.fanoutMs.slice(-2000), 95)}ms | tester lag p95 ${pct(lagSamples, 95)}ms`);
  }, 5000);
  const slots = [];
  for (let i = 0; i < pairs; i++) {
    slots.push((async () => {
      await sleep(pairs > 1 ? (ramp * 1000 * i) / pairs : 0);
      do { await runDuel(); } while (loops && Date.now() < endAt);
    })());
  }
  await Promise.all(slots);
  clearInterval(ticker);
  return summary(label);
}

async function breakpointTest() {
  const stages = String(arg('stages', '10,25,50,100,200,400,800,1500')).split(',').map(Number);
  let last = null;
  for (const n of stages) {
    resetMetrics(); lagSamples = [];
    const r = await loadTest({ pairs: n, ramp: Math.min(20, Math.ceil(n / 20)), label: `stage ${n} pairs` });
    await healthLine(` after ${n}`);
    const bad = r.failRate > 0.05 || r.p95rtt > 1000 || r.p95fan > 1000 || r.lag > 150;
    if (bad) {
      console.log(`\n>>> BREAKING POINT: degraded at ${n} simultaneous duels (${n * 2} players).` +
        (r.lag > 150 ? ' (tester itself was saturated, so true limit may be higher)' : ''));
      console.log(last ? `>>> Last healthy stage: ${last} duels (${last * 2} players).` : '>>> Even the first stage failed.');
      return;
    }
    last = n;
    await sleep(3000);
  }
  console.log(`\n>>> No degradation up to ${last} simultaneous duels (${last * 2} players). Raise --stages to push further.`);
}

async function abuseSuite() {
  const results = [];
  const check = async (name, fn) => {
    let st, msg;
    try { [st, msg] = await fn(); } catch (e) { st = 'FAIL'; msg = e.message; }
    results.push(st); console.log(`${st.padEnd(5)} ${name}\n        ${msg}`);
  };

  await check('3rd player cannot enter a full room', async () => {
    const { A, B, roomId } = await liveRoom(); const C = await newBot();
    const seenP = collect(C.socket, 2500);
    C.socket.emit(EV.JOIN, { roomId, playerId: C.pid });
    const seen = await seenP; closeAll(A, B, C);
    return seen.includes(EV.JOINED) ? ['FAIL', 'third player received room_joined'] : ['PASS', 'C received: ' + (seen.join(', ') || 'nothing (silently ignored)')];
  });

  await check('outsider / impersonator cannot play in someone else\'s room', async () => {
    const { A, B, roomId } = await liveRoom(); const C = await newBot();
    const ca = collect(A.socket, 2000), cb = collect(B.socket, 2000), cc = collect(C.socket, 2000);
    C.socket.emit(EV.GUESS, { roomId, playerId: mkPid(), guess: randWord() });         // outsider, random id
    B.socket.emit(EV.GUESS, { roomId, playerId: A.pid, guess: randWord() });           // B claims to be A
    const [sa, , sc] = await Promise.all([ca, cb, cc]); closeAll(A, B, C);
    if (sc.includes(EV.RESULT) || sc.includes(EV.OPP_RESULT)) return ['FAIL', 'a socket that never joined the room was able to submit guesses'];
    if (sa.includes(EV.RESULT)) return ['WARN', 'server trusts the client-supplied playerId over the socket identity (safe only while ids stay secret)'];
    return ['PASS', 'outsider ignored, and playerId spoofing from another socket was ignored'];
  });

  await check('guess flood: 300 guesses in a burst', async () => {
    const { A, B, roomId } = await liveRoom();
    let results = 0, errs = 0, maxRow = -1, dc = false;
    A.socket.on(EV.RESULT, (p) => { results++; if (p && typeof p.row === 'number') maxRow = Math.max(maxRow, p.row); });
    A.socket.onAny((ev) => { if (!isKnown(ev) && ERROR_RE.test(ev)) errs++; });
    A.socket.on('disconnect', () => (dc = true));
    for (let i = 0; i < 300; i++) A.socket.emit(EV.GUESS, { roomId, playerId: A.pid, guess: randWord() });
    await sleep(3000); closeAll(A, B);
    const d = `accepted ${results}, error events ${errs}, highest row ${maxRow}, disconnected ${dc}`;
    if (maxRow >= 6) return ['FAIL', 'server accepted a 7th+ guess in one round. ' + d];
    return ['PASS', 'row cap held. ' + d];
  });

  await check('oversized payload (200 KB) is rejected', async () => {
    const s = await connect(); let dc = false; s.on('disconnect', () => (dc = true));
    s.emit(EV.GUESS, { roomId: 'ABCDE', playerId: 'x', guess: 'A'.repeat(200000) });
    await sleep(2500); s.close();
    return dc ? ['PASS', 'connection dropped (maxHttpBufferSize works)'] : ['FAIL', '200 KB message was accepted'];
  });

  await check('malformed payloads do not crash the server', async () => {
    const junk = [null, undefined, 123, 'str', [], {}, { roomId: {}, playerId: [], guess: {} },
      { roomId: '__proto__', playerId: 'constructor', guess: { toString: 1 } },
      { roomId: 'A'.repeat(5000), playerId: 'x', guess: '<img onerror=1>' }, { guess: '\u0000\u0000\u0000\u0000\u0000' }];
    const s = await connect(); let dc = 0; s.on('disconnect', () => dc++);
    for (const ev of [EV.JOIN, EV.GUESS]) for (const j of junk) s.emit(ev, j);
    await sleep(1500);
    let alive = false;
    for (let i = 0; i < 3 && !alive; i++) { try { (await connect()).close(); alive = true; } catch (_) { await sleep(1000); } }
    s.close();
    return alive ? ['PASS', 'server still accepting connections' + (dc ? ' (it did drop the abusive socket)' : '')]
      : ['FAIL', 'server stopped accepting connections: an unhandled exception in a handler is likely. Wrap handlers in try/catch + validate payload types'];
  });

  await check('one socket spamming room creation', async () => {
    const N = arg('roomspam', 500);
    const s = await connect(); let joined = 0, errs = 0, dc = false;
    s.on(EV.JOINED, () => joined++); s.on('disconnect', () => (dc = true));
    s.onAny((ev) => { if (!isKnown(ev) && ERROR_RE.test(ev)) errs++; });
    for (let i = 0; i < N; i++) s.emit(EV.JOIN, { roomId: mkCode(), playerId: mkPid(), roundsMode: 'fixed', totalRounds: 1 });
    await sleep(3000); s.close();
    const d = `rooms created ${joined}/${N}, error events ${errs}, disconnected ${dc}`;
    return joined >= N * 0.95 ? ['WARN', 'no per-socket room cap: a script can fill server RAM with empty rooms. ' + d + '. Note: join_room on an unknown code also creates a room (typo = ghost room)']
      : ['PASS', 'server limited it. ' + d];
  });

  await check('reconnect within grace window restores the game', async () => {
    const { A, B, roomId } = await liveRoom();
    const bEv = collect(B.socket, 6000);
    const dcSeen = waitFor(B.socket, EV.OPP_DC, 6000).then(() => true).catch(() => false);
    A.closing = true; A.socket.io.engine.close();                       // simulates a network drop, not a clean leave
    const sawDc = await dcSeen; await sleep(500);
    const A2 = await newBot(); A2.roomId = roomId; A2.pid = A.pid;
    const syncP = waitFor(A2.socket, EV.SYNC, 5000).then(() => true).catch(() => false);
    const joinP = waitFor(A2.socket, EV.JOINED, 5000).catch(() => null);
    A2.socket.emit(EV.JOIN, { roomId, playerId: A.pid });
    const [sync, joined] = await Promise.all([syncP, joinP]);
    const bSeen = await bEv; closeAll(A, A2, B);
    const d = `B saw: ${[...new Set(bSeen)].join(', ') || 'nothing'}`;
    if (!sync) return ['FAIL', 'no game_state_sync after rejoining with the same playerId. ' + d];
    if (!sawDc) return ['WARN', 'sync worked, but opponent never got opponent_disconnected. ' + d];
    if (joined && joined.playerNum === 2) return ['WARN', 'rejoining host was assigned playerNum 2. ' + d];
    return ['PASS', 'drop detected, rejoin + state sync worked. ' + d];
  });

  await check('grace window expiry (needs --slow, takes ~40s)', async () => {
    if (!arg('slow', false)) return ['SKIP', 'run with --slow to include'];
    const grace = arg('grace', 30);
    const { A, B } = await liveRoom();
    const bEv = collect(B.socket, (grace + 8) * 1000);
    A.closing = true; A.socket.io.engine.close();
    const seen = await bEv; closeAll(A, B);
    const d = 'B saw: ' + ([...new Set(seen)].join(', ') || 'nothing');
    return seen.includes(EV.ROUND_OVER) || seen.includes(EV.FINISHED) ? ['PASS', 'room resolved after grace. ' + d]
      : ['WARN', `nothing resolved the game ${grace + 8}s after A vanished: B could be stuck waiting forever. ` + d];
  });

  const bad = results.filter((r) => r === 'FAIL').length, warn = results.filter((r) => r === 'WARN').length;
  console.log(`\nabuse suite: ${results.filter((r) => r === 'PASS').length} pass, ${warn} warn, ${bad} fail`);
  process.exitCode = bad ? 1 : 0;
}

async function stormTest() {
  const n = arg('pairs', 100);
  console.log(`reconnect storm: ${n} live duels, then every host drops and rejoins at the same instant`);
  const rooms = [];
  for (let i = 0; i < n; i += 50) {
    const batch = await Promise.allSettled(Array.from({ length: Math.min(50, n - i) }, () => liveRoom()));
    batch.forEach((r) => (r.status === 'fulfilled' ? rooms.push(r.value) : bump(M.fail, 'setup: ' + r.reason.message)));
  }
  console.log(`${rooms.length}/${n} duels established`);
  rooms.forEach((r) => { r.A.closing = true; r.A.socket.io.engine.close(); });
  await sleep(1000);
  const t0 = Date.now(); let synced = 0; const lat = []; const why = {};
  await Promise.all(rooms.map(async (r) => {
    try {
      const A2 = await newBot(); r.A2 = A2;
      const sp = waitFor(A2.socket, EV.SYNC, 10000);
      A2.socket.emit(EV.JOIN, { roomId: r.roomId, playerId: r.A.pid });
      await sp; synced++; lat.push(Date.now() - t0);
    } catch (e) { bump(why, e.message); }
  }));
  console.log(`rejoined + synced: ${synced}/${rooms.length}   latency p50 ${pct(lat, 50)}ms p95 ${pct(lat, 95)}ms`);
  if (Object.keys(why).length) console.log('failures', why);
  if (Object.keys(M.fail).length) console.log('setup failures', M.fail);
  rooms.forEach((r) => closeAll(r.A, r.A2, r.B));
  process.exitCode = synced === rooms.length && rooms.length === n ? 0 : 1;
}

async function leakTest() {
  const n = arg('rooms', 300), waitMin = arg('wait', 8);
  console.log(`memory-leak test: ${n} abandoned waiting rooms + ${Math.min(n, 100)} duels abandoned mid-game, then watch /healthz for ${waitMin} min`);
  console.log('ALSO watch the server process yourself (pm2 monit / htop / Render metrics). RSS should fall back after the 5-minute TTL sweep.');
  await healthLine(' before');
  for (let i = 0; i < n; i++) {
    try { const b = await newBot(); b.socket.emit(EV.JOIN, { roomId: mkCode(), playerId: b.pid, roundsMode: 'fixed', totalRounds: 1 }); await sleep(20); b.close(); } catch (_) {}
  }
  for (let i = 0; i < Math.min(n, 100); i += 25) {
    const r = await Promise.allSettled(Array.from({ length: 25 }, () => liveRoom()));
    r.forEach((x) => x.status === 'fulfilled' && closeAll(x.value.A, x.value.B));
  }
  await healthLine(' after creating');
  for (let m = 0; m < waitMin * 2; m++) { await sleep(30000); await healthLine(` +${(m + 1) * 30}s`); }
}

// ───────────── entry ─────────────
(async () => {
  switch (mode) {
    case 'smoke': {
      O.verbose = true; O.thinkMin = 300; O.thinkMax = 800;
      await healthLine();
      resetMetrics(); await runDuel();
      const r = summary('smoke test (1 duel)');
      process.exitCode = M.ok === 1 && !M.leaks ? 0 : 1;
      break;
    }
    case 'load':   await loadTest({ pairs: arg('pairs', 50), ramp: arg('ramp', 10), duration: arg('duration', 0), label: 'load test' }); break;
    case 'spike':  await loadTest({ pairs: arg('pairs', 300), ramp: 0, duration: 0, label: 'spike test' }); break;
    case 'soak':   await loadTest({ pairs: arg('pairs', 50), ramp: arg('ramp', 30), duration: arg('duration', 1800), label: 'soak test' }); break;
    case 'breakpoint': await breakpointTest(); break;
    case 'abuse':  await abuseSuite(); break;
    case 'storm':  await stormTest(); break;
    case 'leak':   await leakTest(); break;
    default:
      console.log(`WORDDUEL tester   usage: node loadtest.js <mode> [--url http://localhost:3000] [--words words.json]

  smoke        1 verbose duel: protocol check + secret-leak check
  abuse        security/robustness checks (full room, spoofing, flood, 200KB payload, junk payloads, room spam, reconnect)
               add --slow to also test the 30s grace-window expiry
  load         --pairs 50 --ramp 10 [--duration 120]      steady load, duels loop for --duration seconds
  spike        --pairs 300                                everyone connects at once
  breakpoint   --stages 10,25,50,100,200,400,800          escalates until it breaks and tells you where
  storm        --pairs 100                                every host drops + reconnects simultaneously
  soak         --pairs 50 --duration 1800                 long run to catch leaks / degradation
  leak         --rooms 300 --wait 8                       abandoned rooms vs TTL cleaner (watch server RAM)

other flags:  --transport websocket|polling,websocket   --think-min 400 --think-max 1500 (ms between guesses)
              --rounds 1  --duel-timeout 120 (s)  --verbose`);
  }
  await sleep(300);
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error('fatal:', e); process.exit(2); });
