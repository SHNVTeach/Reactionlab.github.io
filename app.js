'use strict';
/* Reaction Lab — solo practice + live class mode (teacher hosts via PeerJS, nothing stored online). */

// ---------- helpers ----------
const $ = id => document.getElementById(id);
const GAMES = ['colour', 'ruler', 'sound'];
const titles = {colour: 'Colour change', ruler: 'Ruler drop', sound: 'Sound reaction'};
const tags = {colour: '01 / SEE', ruler: '02 / CATCH', sound: '03 / LISTEN'};
const blurbs = {
  colour: 'Wait for purple to turn lime. Tap anywhere in the coloured area as soon as it changes.',
  ruler: 'Watch the ruler. As soon as it starts falling, tap the play area to catch it.',
  sound: 'Listen for a beep, then tap. The screen stays still, so only your ears give you the cue.'
};
const directions = {
  colour: 'Tap the play area to start, then wait for purple to turn lime. Only the colour changes—tap as soon as you see it.',
  ruler: 'Tap the play area to start, then catch the ruler by tapping anywhere in the play area when it starts falling. Distance follows a gravity simulation.',
  sound: 'Check your volume with Test sound. Tap the play area to start, then tap the play area only when you hear the beep. Use the same audio setup for comparisons.'
};
const SCREENS = ['start', 'solo', 'join', 'classHome', 'teacher', 'game', 'results'];

function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k instanceof Node ? k : String(k));
  return e;
}
const average = a => a.reduce((s, v) => s + v, 0) / a.length;
const median = a => [...a].sort((x, y) => x - y)[2];
const ms = v => Math.round(v) + ' ms';
const distance = t => .5 * 9.81 * (t / 1000) ** 2 * 100;
const ordinal = n => { const sfx = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (sfx[(v - 20) % 10] || sfx[v] || sfx[0]); };
const cleanName = s => String(s || '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20);
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

let mode = 'solo';   // 'solo' | 'student' | 'teacher'
let ctx = null;      // class context for the current game: {kind:'free'|'round'|'duel'|'beat', id, ...}

function show(id) {
  for (const s of SCREENS) $(s).classList.toggle('hidden', s !== id);
  window.scrollTo(0, 0);
}
function goHome() { idle(); show(mode === 'student' ? 'classHome' : mode === 'teacher' ? 'teacher' : 'solo'); if (mode === 'solo') historyUI(); }

// ---------- toasts ----------
function toast(content, {key, timeout = 5000} = {}) {
  if (key) dismiss(key);
  const t = h('div', {class: 'toast', 'data-key': key || ''}, content);
  $('toasts').append(t);
  if (timeout) setTimeout(() => t.remove(), timeout);
  return t;
}
function dismiss(key) { document.querySelectorAll('.toast').forEach(t => { if (t.dataset.key === key) t.remove(); }); }

// ---------- game cards ----------
function renderCards(container, onPick) {
  container.replaceChildren(...GAMES.map(g => h('article', {class: 'card'},
    h('div', {class: 'number'}, tags[g]), h('h2', {}, titles[g]), h('p', {class: 'muted'}, blurbs[g]),
    h('button', {onclick: () => onPick(g)}, 'Play ' + titles[g].toLowerCase()))));
}
renderCards(document.querySelector('[data-cards="solo"]'), g => { ctx = null; select(g); });
renderCards(document.querySelector('[data-cards="class"]'), g => select(g, {kind: 'free'}));

// ================= GAME ENGINE =================
let game = 'colour', phase = 'idle', times = [], attempts = [], timer = 0, raf = 0, onset = 0, epoch = 0, audio = null, osc = null, round = null, player = '', hist = [];
try {
  hist = JSON.parse(localStorage.getItem('reactionlab-v1') || '[]');
  if (!Array.isArray(hist)) hist = [];
  hist = hist.filter(r => r && titles[r.game] && Array.isArray(r.times) && r.times.length === 5 && r.times.every(t => Number.isFinite(t) && t >= 0));
  $('nickname').value = localStorage.getItem('reactionlab-name') || '';
} catch (e) { hist = []; }

function name() { return mode === 'student' ? S.name : ($('nickname').value.trim() || 'Guest'); }
function historyUI() {
  const list = hist.filter(r => r.player === name()).slice(-8).reverse();
  $('history').replaceChildren();
  if (!list.length) { $('history').textContent = 'Your completed rounds will appear here.'; return; }
  for (const r of list) $('history').append(h('div', {class: 'history-row'}, h('span', {}, titles[r.game] + ' · ' + new Date(r.date).toLocaleDateString()), h('strong', {}, ms(average(r.times)) + ' average')));
}
$('nickname').oninput = historyUI;
$('clear').onclick = () => {
  if (!confirm('Clear saved rounds for ' + name() + ' on this browser?')) return;
  hist = hist.filter(r => r.player !== name());
  try { localStorage.setItem('reactionlab-v1', JSON.stringify(hist)); } catch (e) {}
  historyUI();
};

function cancel() { epoch++; clearTimeout(timer); cancelAnimationFrame(raf); if (osc) { try { osc.stop(); } catch (e) {} osc = null; } }
function idle(message = '') {
  cancel(); phase = 'idle';
  $('arena').className = 'arena';
  $('arenaText').innerHTML = '<strong>Tap to start</strong><small>Five trials · Tap anywhere in this area.</small>';
  $('arenaText').classList.remove('hidden'); $('rulerWrap').classList.add('hidden'); $('stop').classList.add('hidden');
  $('testSound').disabled = false; $('feedback').textContent = message; $('progress').textContent = '5 trials · Take your time';
}
function select(g, context = ctx) {
  game = g; ctx = context;
  if (ctx && ctx.kind === 'duel') ctx.rng = mulberry32(ctx.seed);
  show('game');
  $('game').classList.toggle('ruler-game', g === 'ruler');
  $('gameTitle').textContent = titles[g]; $('gameType').textContent = tags[g];
  $('instructions').textContent = directions[g];
  $('audioTools').classList.toggle('hidden', g !== 'sound');
  $('back').textContent = mode === 'student' ? 'Back to class' : 'Back to games';
  renderCtxBar(); idle();
}
function renderCtxBar(oppText) {
  const bar = $('ctxBar');
  if (!ctx) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  let left, right = '';
  if (ctx.kind === 'round') { left = [h('span', {}, 'Class round · '), h('b', {}, titles[game])]; right = 'Started by your teacher'; }
  else if (ctx.kind === 'duel') { left = [h('span', {}, 'Live duel vs '), h('b', {}, ctx.opponent)]; right = oppText || ctx.oppText || ctx.opponent + ' is getting ready'; ctx.oppText = right; }
  else if (ctx.kind === 'beat') { left = [h('span', {}, 'Beat '), h('b', {}, ctx.opponent + '’s'), h('span', {}, ' best: ' + ms(ctx.target) + ' average')]; }
  else { left = [h('span', {}, 'Class practice · counts towards the leaderboard')]; }
  bar.replaceChildren(h('span', {}, left), h('span', {}, right));
}

async function audioReady() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) throw Error('Audio not supported');
  audio = audio || new AC();
  // Unlock audio during the student's tap, including iPad browsers.
  const unlock = audio.createBufferSource(); unlock.buffer = audio.createBuffer(1, 1, audio.sampleRate); unlock.connect(audio.destination); unlock.start(0);
  await audio.resume();
  if (audio.state !== 'running') throw Error('Audio is paused');
}
function beep() {
  osc = audio.createOscillator(); const gain = audio.createGain();
  osc.frequency.value = 800;
  gain.gain.setValueAtTime(.0001, audio.currentTime); gain.gain.exponentialRampToValueAtTime(.65, audio.currentTime + .01);
  gain.gain.setValueAtTime(.65, audio.currentTime + .25); gain.gain.exponentialRampToValueAtTime(.0001, audio.currentTime + .35);
  osc.connect(gain); gain.connect(audio.destination); osc.start(); osc.stop(audio.currentTime + .36);
}
$('testSound').onclick = async () => {
  try { await audioReady(); beep(); $('feedback').textContent = 'Did you hear the beep? If not, turn up media volume, turn off Silent Mode, and check whether audio is going to headphones.'; }
  catch (e) { $('feedback').textContent = 'Sound could not start. Open this page in Safari or Chrome and try again.'; }
};
async function startRound() {
  if (phase !== 'idle') return;
  phase = 'preparing'; const token = epoch;
  try {
    if (game === 'sound') await audioReady();
    if (token !== epoch) return;
    player = name(); times = []; attempts = [];
    if (ctx && ctx.kind === 'duel') ctx.rng = mulberry32(ctx.seed);
    $('stop').classList.remove('hidden'); $('testSound').disabled = true; $('arena').focus({preventScroll: true});
    progressOut(0); arm();
  } catch (e) { idle('Sound could not start. Test your sound, then try again.'); }
}
function arm() {
  cancel(); phase = 'waiting';
  $('arena').className = 'arena ' + (game === 'colour' ? 'wait' : game === 'sound' ? 'sound' : '');
  $('arenaText').classList.add('hidden'); $('rulerWrap').classList.toggle('hidden', game !== 'ruler');
  $('ruler').style.transform = 'translateY(0)';
  $('feedback').textContent = game === 'sound' ? 'Listen for the beep.' : game === 'ruler' ? 'Wait for the ruler to fall.' : 'Wait for the colour to change.';
  $('progress').textContent = 'Trial ' + (times.length + 1) + ' of 5';
  const token = epoch, rnd = ctx && ctx.rng ? ctx.rng : Math.random;
  timer = setTimeout(() => {
    raf = requestAnimationFrame(() => {
      if (token !== epoch || phase !== 'waiting') return;
      if (game === 'sound' && audio.state !== 'running') { idle('Audio was interrupted. Test sound and restart the round.'); return; }
      if (game === 'colour') $('arena').classList.add('signal');
      if (game === 'sound') beep();
      onset = performance.now(); phase = 'ready';
      if (game === 'ruler') animateRuler();
      timer = setTimeout(() => { if (phase === 'ready') retry('No response', 'No tap detected. This trial will repeat.'); }, 5000);
    });
  }, 1500 + rnd() * 3000);
}
function animateRuler() {
  if (phase !== 'ready') return;
  const t = performance.now() - onset, max = $('arena').clientHeight / 2 + 360;
  $('ruler').style.transform = 'translateY(' + Math.min(distance(t) * 7.2, max) + 'px)';
  raf = requestAnimationFrame(animateRuler);
}
function log(outcome, value = null) { attempts.push({trial: times.length + 1, outcome, value}); }
function retry(outcome, message) {
  log(outcome); cancel(); phase = 'feedback';
  $('arena').className = 'arena'; $('rulerWrap').classList.add('hidden'); $('arenaText').classList.remove('hidden');
  $('arenaText').replaceChildren(h('strong', {}, outcome)); $('feedback').textContent = message;
  timer = setTimeout(arm, 1600);
}
function tap() {
  if (phase === 'idle') { startRound(); return; }
  if (phase === 'paused') { resume(); return; }
  if (phase === 'waiting') { retry('Too soon', 'Early tap recorded. Wait for the cue; this trial will repeat.'); return; }
  if (phase !== 'ready') return;
  const t = performance.now() - onset;
  log('Valid', t); times.push(t); cancel(); phase = 'feedback';
  $('arena').className = 'arena'; $('rulerWrap').classList.add('hidden'); $('arenaText').classList.remove('hidden');
  $('arenaText').replaceChildren(h('strong', {}, ms(t)), h('small', {}, 'Trial ' + times.length + ' of 5' + (game === 'ruler' ? ' · ' + distance(t).toFixed(1) + ' cm simulated' : '')));
  $('feedback').textContent = times.length < 5 ? 'Result saved. Get ready for the next trial.' : 'All five trials complete.';
  progressOut(times.length);
  timer = setTimeout(times.length === 5 ? finish : arm, 1600);
}
function progressOut(n) { if (mode === 'student' && ctx) S.send({type: 'progress', trial: n, ctx: {kind: ctx.kind, id: ctx.id}}); }
$('arena').addEventListener('pointerdown', e => { if (e.isPrimary && e.button === 0 && phase !== 'idle' && phase !== 'paused') { e.preventDefault(); tap(); } });
$('arena').addEventListener('click', () => { if (phase === 'idle' || phase === 'paused') tap(); });
$('arena').addEventListener('keydown', e => { if ((e.code === 'Space' || e.code === 'Enter') && !e.repeat) { e.preventDefault(); tap(); } });

function leavingChallenge() {
  // Leaving an unfinished duel / beat challenge counts as a forfeit.
  if (mode === 'student' && ctx && (ctx.kind === 'duel' || ctx.kind === 'beat') && !ctx.done) {
    if (!confirm('Leave this challenge? It counts as a forfeit.')) return false;
    S.send({type: 'abandon', id: ctx.id}); ctx.done = true;
  }
  return true;
}
$('stop').onclick = () => { if (!leavingChallenge()) return; idle('Round stopped. Incomplete rounds are not saved.'); };
$('back').onclick = () => { if (!leavingChallenge()) return; goHome(); };
$('resultHome').onclick = goHome;
$('again').onclick = () => { if (ctx && ctx.kind !== 'free') ctx = {kind: 'free'}; select(game, ctx); };
document.addEventListener('visibilitychange', () => {
  if (document.hidden && ['waiting', 'ready', 'preparing', 'feedback'].includes(phase)) {
    if (phase === 'preparing') { idle('Round paused. Tap the play area when ready.'); return; }
    if (times.length === 5) { finish(); return; }
    if (phase !== 'feedback') log('Interrupted');
    cancel(); phase = 'paused';
    $('arena').className = 'arena'; $('rulerWrap').classList.add('hidden'); $('arenaText').classList.remove('hidden');
    $('arenaText').replaceChildren(h('strong', {}, 'Round paused'));
    $('feedback').textContent = 'Tap the play area to resume. Completed trials are kept.';
  }
});
async function resume() {
  if (phase !== 'paused') return;
  phase = 'preparing'; const token = epoch;
  try { if (game === 'sound') await audioReady(); if (token !== epoch) return; arm(); }
  catch (e) { phase = 'paused'; $('feedback').textContent = 'Audio is unavailable. Stop the round and test sound.'; }
}

function finish() {
  cancel(); phase = 'done';
  const prev = hist.filter(r => r.game === game && r.player === player).at(-1);
  round = {game, player, date: new Date().toISOString(), times: [...times], attempts: [...attempts]};
  let saved = true;
  if (mode === 'solo') {
    hist.push(round); hist = hist.slice(-200);
    try { localStorage.setItem('reactionlab-v1', JSON.stringify(hist)); localStorage.setItem('reactionlab-name', player); } catch (e) { saved = false; }
  }
  show('results');
  const avg = average(times);
  $('resultTitle').textContent = titles[game] + ' results';
  $('resultSubtitle').textContent = player + ' · Five completed trials' + (saved ? '' : ' · Browser storage unavailable; download your results.');
  $('stats').replaceChildren(...[['Average', avg], ['Median', median(times)], ['Fastest', Math.min(...times)], ['Slowest', Math.max(...times)]].map(([label, v]) => h('div', {class: 'stat'}, h('span', {}, label), h('b', {}, ms(v)))));
  $('comparison').textContent = mode !== 'solo' ? '' : prev ? 'Your average is ' + ms(Math.abs(avg - average(prev.times))) + ' ' + (avg < average(prev.times) ? 'quicker' : 'slower') + ' than your previous ' + titles[game].toLowerCase() + ' round.' : 'Your first round is a starting point. Try again to explore how your results vary.';
  $('extraHeading').textContent = game === 'ruler' ? 'Simulated fall distance' : 'From your average';
  const mx = Math.max(...times);
  $('trials').replaceChildren(...times.map((t, i) => h('tr', {}, h('td', {}, i + 1),
    h('td', {}, ms(t), h('div', {class: 'bar', style: '--w:' + Math.max(5, t / mx * 100) + '%'})),
    h('td', {}, game === 'ruler' ? distance(t).toFixed(1) + ' cm' : (t < avg ? '−' : '+') + ms(Math.abs(t - avg))))));
  $('earlyCount').textContent = attempts.filter(a => a.outcome === 'Too soon').length + ' early taps · Early and interrupted attempts are excluded from the five-trial statistics.';
  $('attempts').replaceChildren(...attempts.map((a, i) => h('tr', {}, h('td', {}, i + 1), h('td', {}, a.trial), h('td', {}, a.outcome + (a.value !== null ? ' · ' + ms(a.value) : '')))));
  $('attemptDetails').open = false;
  $('resultHome').textContent = mode === 'student' ? 'Back to class' : 'Back to games';
  $('again').textContent = ctx && ctx.kind !== 'free' ? 'Play again (practice)' : 'Try again';
  const oc = $('classOutcome');
  oc.className = 'outcome hidden';
  if (mode === 'student' && ctx) {
    ctx.done = true;
    S.send({type: 'result', game, times: [...times], ctx: {kind: ctx.kind, id: ctx.id}});
    const msg = ctx.kind === 'duel' ? 'Waiting for ' + ctx.opponent + ' to finish…' : ctx.kind === 'round' ? 'Sent to the class round. Watch the board!' : ctx.kind === 'beat' ? 'Checking…' : 'Added to the class leaderboard.';
    setOutcome(msg, 'info', ctx.id);
    if (ctx.pendingOutcome) { setOutcome(ctx.pendingOutcome.text, ctx.pendingOutcome.result, ctx.id); }
  }
}
function setOutcome(text, result, id) {
  const oc = $('classOutcome');
  oc.textContent = text; oc.dataset.id = id || '';
  oc.className = 'outcome' + (result === 'win' ? ' win' : result === 'lose' ? ' lose' : '');
}

$('export').onclick = () => {
  if (!round) return;
  const safe = v => '"' + String(v).replace(/^[=+@\-]/, "'").replace(/"/g, '""') + '"';
  const rows = [['Player', 'Game', 'Date', 'Attempt', 'Trial', 'Outcome', 'Reaction_ms', 'Simulated_distance_cm'], ...round.attempts.map((a, i) => [round.player, titles[round.game], round.date, i + 1, a.trial, a.outcome, a.value === null ? '' : a.value.toFixed(1), round.game === 'ruler' && a.value !== null ? distance(a.value).toFixed(1) : ''])];
  const url = URL.createObjectURL(new Blob(['﻿' + rows.map(r => r.map(safe).join(',')).join('\r\n')], {type: 'text/csv;charset=utf-8'}));
  const a = document.createElement('a'); a.href = url; a.download = 'reaction-lab-results.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
};
for (let i = 0; i <= 50; i++) {
  const tick = h('div', {class: 'mark' + (i % 5 === 0 ? ' major' : ''), style: 'top:' + (100 - i * 2) + '%'});
  if (i % 5 === 0) tick.append(h('span', {}, i));
  $('ruler').append(tick);
}

// ================= NETWORK (PeerJS) =================
const PREFIX = 'reactionlab-shps-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const hostId = code => PREFIX + code;
function genCode() { const b = new Uint32Array(5); crypto.getRandomValues(b); return [...b].map(n => CODE_CHARS[n % CODE_CHARS.length]).join(''); }
function makePeer(id) {
  const opts = {debug: 1, config: {iceServers: [{urls: 'stun:stun.l.google.com:19302'}, {urls: 'stun:stun1.l.google.com:19302'}]}};
  const custom = new URLSearchParams(location.search).get('peer'); // optional self-hosted PeerServer, e.g. ?peer=myserver.example.com:443
  if (custom) { const [host, port] = custom.split(':'); Object.assign(opts, {host, port: +port || 443, path: '/', secure: (+port || 443) === 443}); }
  return id ? new Peer(id, opts) : new Peer(opts);
}
function joinUrl(code) { return location.origin + location.pathname + '?join=' + code; }
function peerAvailable() { return typeof Peer === 'function'; }

// ----- board rendering (shared) -----
function renderTabs(el, current, onPick) {
  el.replaceChildren(...GAMES.map(g => h('button', {'aria-pressed': g === current ? 'true' : 'false', onclick: () => onPick(g)}, titles[g])));
}
function renderBoard(ol, list, meId, limit = 50) {
  ol.replaceChildren();
  if (!list || !list.length) { ol.append(h('li', {class: 'empty'}, 'No scores yet. Be the first!')); return; }
  for (const r of list.slice(0, limit)) ol.append(h('li', {class: r.id === meId ? 'me' : ''}, h('span', {class: 'n'}, r.name), h('b', {}, ms(r.avg))));
}

// ================= STUDENT =================
const S = {peer: null, conn: null, code: '', name: '', id: null, roster: [], board: {}, boardGame: 'colour', challengesOn: true, outgoing: null, leaving: false, retries: 0, joinTimer: 0, target: null};

S.send = msg => { if (S.conn && S.conn.open) try { S.conn.send(msg); } catch (e) {} };
function joinStatus(text, isErr) { $('joinStatus').textContent = text; $('joinStatus').className = 'small ' + (isErr ? 'err' : 'muted'); }
function setPill(text, off) { const p = $('classPill'); p.textContent = text; p.classList.toggle('hidden', !text); p.classList.toggle('off', !!off); }

function studentJoin(code, nm) {
  if (!peerAvailable()) { joinStatus('Class mode could not load. Check your internet connection and reload.', true); return; }
  S.code = code; S.name = nm; S.leaving = false; S.retries = 0;
  $('joinBtn').disabled = true; joinStatus('Connecting to class ' + code + '…');
  if (S.peer) try { S.peer.destroy(); } catch (e) {}
  S.peer = makePeer();
  S.peer.on('open', studentConnect);
  S.peer.on('disconnected', () => { if (!S.leaving && S.peer && !S.peer.destroyed) setTimeout(() => { try { S.peer.reconnect(); } catch (e) {} }, 1500); });
  S.peer.on('error', e => {
    if (S.leaving) return;
    if (e.type === 'peer-unavailable') studentFail('No class found with code ' + S.code + '. Check the code, and check your teacher’s class page is still open.');
    else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(e.type)) { if (mode !== 'student') studentFail('Can’t reach the class server. Your network might be blocking it — try again, or ask your teacher.'); }
    else if (e.type === 'browser-incompatible') studentFail('This browser can’t join classes. Try Safari or Chrome.');
    else studentFail('Something went wrong (' + e.type + '). Try again.');
  });
}
function studentConnect() {
  clearTimeout(S.joinTimer);
  const c = S.peer.connect(hostId(S.code), {serialization: 'json', reliable: true});
  S.conn = c;
  S.joinTimer = setTimeout(() => { if (!c.open) studentFail('Couldn’t connect to class ' + S.code + '. The school network may be blocking it — try again.'); }, 15000);
  c.on('open', () => { clearTimeout(S.joinTimer); c.send({type: 'hello', name: S.name, rejoin: S.id}); });
  c.on('data', studentMsg);
  c.on('close', () => { if (S.conn === c) studentDrop(); });
  c.on('error', () => { if (S.conn === c) studentDrop(); });
}
function studentFail(text) {
  clearTimeout(S.joinTimer);
  if (mode === 'student') { exitClass(); }
  $('joinBtn').disabled = false; show('join'); joinStatus(text, true);
}
function studentDrop() {
  if (S.leaving || mode !== 'student') return;
  S.conn = null;
  if (S.retries++ < 4) {
    setPill('Reconnecting…', true);
    setTimeout(() => {
      if (S.leaving) return;
      if (S.peer && S.peer.disconnected) { try { S.peer.reconnect(); } catch (e) {} setTimeout(studentConnect, 1500); }
      else if (S.peer && !S.peer.destroyed) studentConnect();
    }, 1200 * S.retries);
  } else {
    const code = S.code, nm = S.name;
    exitClass(); show('join'); $('joinCode').value = code; $('joinName').value = nm;
    joinStatus('Lost connection to the class. Tap Join to try again.', true);
  }
}
function exitClass() {
  S.leaving = true; clearTimeout(S.joinTimer);
  try { S.conn && S.conn.close(); } catch (e) {}
  try { S.peer && S.peer.destroy(); } catch (e) {}
  S.peer = S.conn = null; S.id = null; S.outgoing = null; mode = 'solo'; ctx = null;
  setPill(''); idle(); $('toasts').replaceChildren(); $('joinBtn').disabled = false;
}

function studentMsg(m) {
  if (!m || typeof m.type !== 'string') return;
  switch (m.type) {
    case 'welcome': {
      const first = mode !== 'student';
      mode = 'student'; S.id = m.id; S.name = m.name; S.retries = 0; S.challengesOn = m.challengesOn;
      setPill('Class ' + S.code + ' · ' + S.name);
      $('chEyebrow').textContent = 'Class ' + S.code; $('chTitle').textContent = 'Hi ' + S.name + ', you’re in!';
      if (first) { show('classHome'); try { history.replaceState(null, '', location.pathname + location.search.replace(/[?&]join=[^&]*/, '').replace(/^&/, '?')); } catch (e) {} }
      if (first && m.name !== $('joinName').value.trim()) toast('Someone already had that name, so you are ' + m.name + '.');
      renderStudent();
      if (m.round) studentRound(m.round);
      break;
    }
    case 'denied': studentFail(m.reason || 'The class is not accepting students.'); break;
    case 'roster': S.roster = Array.isArray(m.students) ? m.students : []; renderStudent(); break;
    case 'board': S.board = m.board || {}; renderStudent(); break;
    case 'settings': S.challengesOn = !!m.challengesOn; renderStudent(); break;
    case 'round': studentRound(m); break;
    case 'roundEnd': {
      if (ctx && ctx.kind === 'round' && ctx.id === m.id && !ctx.done && !$('game').classList.contains('hidden')) { ctx = {kind: 'free'}; renderCtxBar(); idle('The class round has ended. This game now counts as practice.'); }
      toast(m.rank ? 'Class round over: you came ' + ordinal(m.rank) + ' of ' + m.total + ' (' + ms(m.avg) + ').' : 'Class round over. You didn’t finish this one — next time!', {timeout: 8000});
      break;
    }
    case 'incoming': {
      const kindText = m.kind === 'duel' ? 'a live duel' : 'beat their ' + ms(m.target) + ' average';
      toast([h('div', {}, h('b', {}, m.from), ' challenges you to ' + kindText + ' in ' + titles[m.game] + '!'),
        h('div', {class: 'row'}, h('button', {class: 'lime', onclick: () => { dismiss('in' + m.id); S.send({type: 'respond', id: m.id, accept: true}); }}, 'Accept'),
          h('button', {class: 'secondary', onclick: () => { dismiss('in' + m.id); S.send({type: 'respond', id: m.id, accept: false}); }}, 'No thanks'))], {key: 'in' + m.id, timeout: 60000});
      break;
    }
    case 'sent':
      S.outgoing = m.id; renderStudent();
      toast([h('div', {}, 'Waiting for ' + m.to + ' to accept…'), h('div', {class: 'row'}, h('button', {class: 'secondary', onclick: () => S.send({type: 'cancel', id: m.id})}, 'Cancel challenge'))], {key: 'out', timeout: 0});
      break;
    case 'update':
      if (m.id === S.outgoing && m.status !== 'accepted') { S.outgoing = null; dismiss('out'); renderStudent(); }
      if (m.status === 'accepted') dismiss('out');
      dismiss('in' + m.id);
      if (m.text) toast(m.text);
      break;
    case 'play':
      if (!GAMES.includes(m.game) || !m.ctx) return;
      dismiss('out'); S.outgoing = null;
      if (phase !== 'idle' && phase !== 'done') cancel();
      select(m.game, m.ctx);
      if (m.ctx.kind === 'duel') toast('Duel on! Tap the play area when you’re ready.');
      break;
    case 'opp':
      if (ctx && ctx.kind === 'duel' && ctx.id === m.id) renderCtxBar(m.done ? ctx.opponent + ' finished' : m.trial ? ctx.opponent + ': trial ' + Math.min(m.trial + 1, 5) + ' of 5' : ctx.opponent + ' has started');
      break;
    case 'outcome':
      S.outgoing = null; renderStudent();
      if (!$('results').classList.contains('hidden') && $('classOutcome').dataset.id === String(m.id)) setOutcome(m.text, m.result, m.id);
      else if (ctx && ctx.id === m.id && !ctx.done) { ctx.pendingOutcome = m; ctx.done = true; toast(m.text, {timeout: 8000}); if (phase !== 'done') { cancel(); idle(m.text); } }
      else toast(m.text, {timeout: 8000});
      break;
    case 'kicked': exitClass(); show('start'); toast('Your teacher removed you from the class.'); break;
    case 'closed': exitClass(); show('start'); toast('Your teacher has ended the class. Thanks for playing!', {timeout: 8000}); break;
  }
}
function studentRound(m) {
  if (!GAMES.includes(m.game)) return;
  dismiss('out'); S.outgoing = null;
  select(m.game, {kind: 'round', id: m.id});
  toast('Your teacher started a class round: ' + titles[m.game] + '. Tap the play area to begin!');
}
function renderStudent() {
  if (mode !== 'student') return;
  renderTabs(document.querySelector('[data-tabs="student"]'), S.boardGame, g => { S.boardGame = g; renderStudent(); });
  renderBoard($('sBoard'), S.board[S.boardGame], S.id, 15);
  const others = S.roster.filter(s => s.id !== S.id && s.online);
  $('chalNote').textContent = !S.challengesOn ? 'Your teacher has turned challenges off for now.' : S.outgoing ? 'Waiting for your challenge to be answered…' : others.length ? 'Pick a classmate to challenge.' : 'No classmates online yet.';
  $('classmates').replaceChildren(...others.map(s => h('div', {class: 'person' + (s.busy ? ' busy' : '')}, h('span', {class: 'dot'}), s.name,
    h('button', {class: 'lime', disabled: !S.challengesOn || s.busy || !!S.outgoing, onclick: () => openChallenge(s)}, s.busy ? 'Busy' : 'Challenge'))));
}
function myBest(g) { const r = (S.board[g] || []).find(x => x.id === S.id); return r ? r.avg : null; }
function openChallenge(s) {
  S.target = s; $('cdTitle').textContent = 'Challenge ' + s.name; $('cdError').textContent = '';
  updateBeatOption(); $('chalDialog').showModal();
}
function updateBeatOption() {
  const g = document.querySelector('input[name=cdGame]:checked').value, best = myBest(g), beat = document.querySelector('input[name=cdKind][value=beat]');
  beat.disabled = best == null;
  $('cdBeatNote').textContent = best == null ? 'play ' + titles[g].toLowerCase() + ' first to set a score' : 'they try to beat your best of ' + ms(best);
  if (beat.disabled && beat.checked) document.querySelector('input[name=cdKind][value=duel]').checked = true;
}
document.querySelectorAll('input[name=cdGame]').forEach(r => r.onchange = updateBeatOption);
$('chalDialog').addEventListener('close', () => {
  if ($('chalDialog').returnValue !== 'send' || !S.target) return;
  const g = document.querySelector('input[name=cdGame]:checked').value, k = document.querySelector('input[name=cdKind]:checked').value;
  S.send({type: 'challenge', to: S.target.id, game: g, kind: k});
  S.target = null;
});
$('leaveClass').onclick = () => { if (!confirm('Leave the class?')) return; S.send({type: 'bye'}); setTimeout(() => { exitClass(); show('start'); }, 150); };

// ================= TEACHER =================
const T = {peer: null, code: '', students: new Map(), nextId: 1, round: null, rounds: 0, ch: new Map(), nextCh: 1, allow: true, boardGame: 'colour', feed: [], wake: null, tries: 0, boardTimer: 0, closing: false};

function tSend(st, msg) { if (st && st.conn && st.conn.open) try { st.conn.send(msg); } catch (e) {} }
function tBroadcast(msg) { for (const st of T.students.values()) tSend(st, msg); }
function tStatus(t) { $('tStatus').textContent = t; }

function teacherCreate() {
  if (!peerAvailable()) { toast('Class mode could not load. Check your internet connection and reload.'); return; }
  $('goTeach').disabled = true; $('goTeach').textContent = 'Creating…';
  T.code = genCode(); T.closing = false;
  const p = T.peer = makePeer(hostId(T.code));
  p.on('open', teacherReady);
  p.on('error', e => {
    if (e.type === 'unavailable-id' && T.tries++ < 5) { try { p.destroy(); } catch (x) {} teacherCreate(); return; }
    if (mode !== 'teacher') { $('goTeach').disabled = false; $('goTeach').textContent = 'Create a class'; toast('Couldn’t create a class: ' + (e.type === 'network' || e.type === 'server-error' ? 'can’t reach the class server. Your network may be blocking it.' : e.type), {timeout: 9000}); }
    else if (e.type !== 'peer-unavailable') tStatus('Connection issue (' + e.type + '). Trying to recover…');
  });
  p.on('disconnected', () => { if (!T.closing && !p.destroyed) { tStatus('Reconnecting to class server… (students already joined stay connected)'); setTimeout(() => { try { p.reconnect(); } catch (e) {} }, 1500); } });
  p.on('connection', c => {
    c.on('data', m => teacherMsg(c, m));
    c.on('close', () => teacherDrop(c));
    c.on('error', () => teacherDrop(c));
  });
}
function teacherReady() {
  if (mode === 'teacher') { tStatus('Connected.'); return; }
  mode = 'teacher'; T.tries = 0;
  $('goTeach').disabled = false; $('goTeach').textContent = 'Create a class';
  const url = joinUrl(T.code);
  $('tCode').textContent = T.code; $('tLink').textContent = url.replace(/^https?:\/\//, '');
  try { const qr = qrcode(0, 'M'); qr.addData(url); qr.make(); $('tQr').innerHTML = qr.createSvgTag({cellSize: 6, margin: 2, scalable: true, alt: 'QR code to join class ' + T.code}); } catch (e) { $('tQr').textContent = ''; }
  setPill('Teacher · class ' + T.code);
  show('teacher'); renderTeacher();
  if (navigator.wakeLock) navigator.wakeLock.request('screen').then(w => T.wake = w).catch(() => {});
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && mode === 'teacher' && navigator.wakeLock && (!T.wake || T.wake.released)) navigator.wakeLock.request('screen').then(w => T.wake = w).catch(() => {}); });
window.addEventListener('beforeunload', e => { if (mode === 'teacher' && T.students.size) { e.preventDefault(); e.returnValue = ''; } });

function byConn(c) { if (!c) return null; for (const st of T.students.values()) if (st.conn === c) return st; return null; }
function publicRoster() { return [...T.students.values()].map(s => ({id: s.id, name: s.name, online: s.online, busy: !!s.busy})); }
function rosterOut() { tBroadcast({type: 'roster', students: publicRoster()}); }
function boardData() {
  const b = {};
  for (const g of GAMES) b[g] = [...T.students.values()].filter(s => s.best[g] != null).map(s => ({id: s.id, name: s.name, avg: s.best[g]})).sort((x, y) => x.avg - y.avg);
  return b;
}
function boardOut() { clearTimeout(T.boardTimer); T.boardTimer = setTimeout(() => tBroadcast({type: 'board', board: boardData()}), 250); }
function feedAdd(text) { T.feed.unshift({text, t: new Date()}); T.feed = T.feed.slice(0, 12); renderTeacher(); }

function teacherMsg(c, m) {
  if (!m || typeof m.type !== 'string') return;
  let st = byConn(c);
  if (m.type === 'hello') {
    if (st) return;
    const nm = cleanName(m.name) || 'Player';
    let rec = (m.rejoin && T.students.get(m.rejoin)) || [...T.students.values()].find(s => !s.online && s.name.toLowerCase() === nm.toLowerCase());
    if (rec && rec.conn && rec.conn !== c) { const old = rec.conn; rec.conn = null; try { old.close(); } catch (e) {} }
    if (!rec) {
      if ([...T.students.values()].filter(s => s.online).length >= 60) { try { c.send({type: 'denied', reason: 'This class is full.'}); } catch (e) {} return; }
      let final = nm, n = 2;
      const taken = x => [...T.students.values()].some(s => s.name.toLowerCase() === x.toLowerCase());
      while (taken(final)) final = nm.slice(0, 17) + ' ' + n++;
      rec = {id: 's' + T.nextId++, name: final, best: {}, count: {}, busy: null};
      T.students.set(rec.id, rec);
    }
    rec.conn = c; rec.online = true;
    tSend(rec, {type: 'welcome', id: rec.id, name: rec.name, challengesOn: T.allow, round: T.round && T.round.open ? {id: T.round.id, game: T.round.game} : null});
    tSend(rec, {type: 'board', board: boardData()});
    rosterOut(); renderTeacher();
    return;
  }
  if (!st) return;
  switch (m.type) {
    case 'result': {
      if (!GAMES.includes(m.game) || !Array.isArray(m.times) || m.times.length !== 5 || !m.times.every(t => Number.isFinite(t) && t > 0 && t < 6000)) return;
      const avg = average(m.times), cx = m.ctx || {};
      st.count[m.game] = (st.count[m.game] || 0) + 1;
      if (st.best[m.game] == null || avg < st.best[m.game]) st.best[m.game] = avg;
      if (cx.kind === 'round' && T.round && T.round.open && T.round.id === cx.id && T.round.game === m.game) {
        const prev = T.round.res.get(st.id);
        if (!prev || prev.avg == null) T.round.res.set(st.id, {trial: 5, avg});
      }
      if ((cx.kind === 'duel' || cx.kind === 'beat') && T.ch.has(cx.id)) chResult(T.ch.get(cx.id), st, avg, m.game);
      boardOut(); renderTeacher();
      break;
    }
    case 'progress': {
      const cx = m.ctx || {}, trial = Math.max(0, Math.min(5, m.trial | 0));
      if (cx.kind === 'round' && T.round && T.round.open && T.round.id === cx.id) {
        const prev = T.round.res.get(st.id);
        if (!prev || prev.avg == null) { T.round.res.set(st.id, {trial, avg: null}); renderRoundLive(); }
      }
      if (cx.kind === 'duel' && T.ch.has(cx.id)) { const ch = T.ch.get(cx.id); if (ch.status === 'active') { const other = T.students.get(ch.a === st.id ? ch.b : ch.a); tSend(other, {type: 'opp', id: ch.id, trial}); } }
      break;
    }
    case 'challenge': {
      const tgt = T.students.get(m.to), no = text => tSend(st, {type: 'update', status: 'error', text});
      if (!T.allow) return no('Challenges are turned off right now.');
      if (!GAMES.includes(m.game) || !['duel', 'beat'].includes(m.kind)) return;
      if (!tgt || !tgt.online || tgt === st) return no('That classmate isn’t available.');
      if (st.busy) return no('You already have a challenge going.');
      if (tgt.busy || (T.round && T.round.open)) return no(tgt.busy ? tgt.name + ' is busy with another challenge.' : 'Wait until the class round is over.');
      if (m.kind === 'beat' && st.best[m.game] == null) return no('Play ' + titles[m.game] + ' first to set a score.');
      const ch = {id: 'c' + T.nextCh++, kind: m.kind, game: m.game, a: st.id, b: tgt.id, status: 'pending', target: st.best[m.game], res: {}};
      T.ch.set(ch.id, ch); st.busy = tgt.busy = ch.id;
      tSend(tgt, {type: 'incoming', id: ch.id, from: st.name, game: ch.game, kind: ch.kind, target: ch.target});
      tSend(st, {type: 'sent', id: ch.id, to: tgt.name});
      ch.expire = setTimeout(() => { if (ch.status === 'pending') chClose(ch, st.name + '’s challenge to ' + tgt.name + ' timed out.', {[ch.a]: tgt.name + ' didn’t answer in time.', [ch.b]: ''}, true); }, 60000);
      rosterOut(); renderTeacher();
      break;
    }
    case 'respond': {
      const ch = T.ch.get(m.id);
      if (!ch || ch.status !== 'pending' || ch.b !== st.id) return;
      clearTimeout(ch.expire);
      const A = T.students.get(ch.a);
      if (!m.accept) { chClose(ch, null, {[ch.a]: st.name + ' said no thanks this time.', [ch.b]: ''}, true); return; }
      ch.status = 'active';
      tSend(A, {type: 'update', id: ch.id, status: 'accepted', text: ch.kind === 'duel' ? '' : st.name + ' accepted! They’re trying to beat your ' + ms(ch.target) + ' now.'});
      if (ch.kind === 'duel') {
        const seed = (Math.random() * 2 ** 31) | 0;
        tSend(A, {type: 'play', game: ch.game, ctx: {kind: 'duel', id: ch.id, opponent: st.name, seed}});
        tSend(st, {type: 'play', game: ch.game, ctx: {kind: 'duel', id: ch.id, opponent: A.name, seed}});
      } else tSend(st, {type: 'play', game: ch.game, ctx: {kind: 'beat', id: ch.id, opponent: A.name, target: ch.target}});
      rosterOut();
      break;
    }
    case 'cancel': {
      const ch = T.ch.get(m.id);
      if (ch && ch.status === 'pending' && ch.a === st.id) { clearTimeout(ch.expire); chClose(ch, null, {[ch.a]: 'Challenge cancelled.', [ch.b]: ''}, true); }
      break;
    }
    case 'abandon': {
      const ch = T.ch.get(m.id);
      if (ch && ch.status === 'active' && (ch.a === st.id || ch.b === st.id)) chForfeit(ch, st);
      break;
    }
    case 'bye': removeStudent(st, false); break;
  }
}
function chClose(ch, feedText, msgs, silentFeed) {
  ch.status = 'done'; clearTimeout(ch.expire);
  for (const sid of [ch.a, ch.b]) {
    const s = T.students.get(sid);
    if (s && s.busy === ch.id) s.busy = null;
    if (s && msgs && sid in msgs) tSend(s, {type: 'update', id: ch.id, status: 'closed', text: msgs[sid]});
  }
  T.ch.delete(ch.id);
  if (feedText && !silentFeed) feedAdd(feedText); else renderTeacher();
  rosterOut();
}
function chFinish(ch, feedText, out) {
  ch.status = 'done';
  for (const [sid, o] of Object.entries(out)) tSend(T.students.get(sid), {type: 'outcome', id: ch.id, text: o.text, result: o.result});
  for (const sid of [ch.a, ch.b]) { const s = T.students.get(sid); if (s && s.busy === ch.id) s.busy = null; }
  T.ch.delete(ch.id); feedAdd(feedText); rosterOut();
}
function chResult(ch, st, avg, g) {
  if (ch.status !== 'active' || g !== ch.game || !(st.id === ch.a || st.id === ch.b) || ch.res[st.id] != null) return;
  const A = T.students.get(ch.a), B = T.students.get(ch.b);
  if (ch.kind === 'beat') {
    if (st.id !== ch.b) return;
    const won = avg < ch.target, gm = titles[ch.game];
    chFinish(ch, won ? `⚡ ${B.name} beat ${A.name}’s ${gm} score (${ms(avg)} vs ${ms(ch.target)})` : `🛡️ ${A.name}’s ${gm} score held against ${B.name} (${ms(ch.target)} vs ${ms(avg)})`, {
      [ch.b]: {text: won ? `You beat ${A.name}’s score! ${ms(avg)} vs ${ms(ch.target)}.` : `So close! ${ms(avg)} vs ${A.name}’s ${ms(ch.target)}. Try again?`, result: won ? 'win' : 'lose'},
      [ch.a]: {text: won ? `${B.name} beat your ${gm} score: ${ms(avg)} vs your ${ms(ch.target)}.` : `Your ${gm} score held! ${B.name} got ${ms(avg)} vs your ${ms(ch.target)}.`, result: won ? 'lose' : 'win'}
    });
    return;
  }
  ch.res[st.id] = avg;
  const other = st.id === ch.a ? B : A;
  tSend(other, {type: 'opp', id: ch.id, done: true});
  if (ch.res[ch.a] == null || ch.res[ch.b] == null) return;
  const ra = ch.res[ch.a], rb = ch.res[ch.b], gm = titles[ch.game];
  if (Math.round(ra) === Math.round(rb)) {
    const t = `It’s a draw! You both averaged ${ms(ra)}.`;
    chFinish(ch, `🤝 ${A.name} and ${B.name} drew in a ${gm} duel (${ms(ra)})`, {[ch.a]: {text: t, result: 'win'}, [ch.b]: {text: t, result: 'win'}});
    return;
  }
  const [W, L, rw, rl] = ra < rb ? [A, B, ra, rb] : [B, A, rb, ra];
  chFinish(ch, `⚔️ ${W.name} beat ${L.name} in a ${gm} duel (${ms(rw)} vs ${ms(rl)})`, {
    [W.id]: {text: `You won the duel! ${ms(rw)} vs ${L.name}’s ${ms(rl)}.`, result: 'win'},
    [L.id]: {text: `${W.name} won this time: ${ms(rw)} vs your ${ms(rl)}. Rematch?`, result: 'lose'}
  });
}
function chForfeit(ch, quitter) {
  const A = T.students.get(ch.a), B = T.students.get(ch.b), other = quitter.id === ch.a ? B : A;
  if (ch.kind === 'beat' && quitter.id === ch.a) {
    chFinish(ch, `${A.name} left during ${B ? B.name : '?'}’s attempt`, {[ch.b]: {text: A.name + ' left the class, so this challenge is off. Your result still counts on the leaderboard.', result: 'info'}});
  } else if (ch.kind === 'beat') {
    chFinish(ch, `🛡️ ${B ? B.name : '?'} left ${A ? A.name : '?'}’s ${titles[ch.game]} challenge`, {[ch.a]: {text: (B ? B.name : 'They') + ' left the challenge. Your score holds!', result: 'win'}, [ch.b]: {text: 'Challenge left.', result: 'lose'}});
  } else {
    chFinish(ch, `⚔️ ${other ? other.name : '?'} won a ${titles[ch.game]} duel (${quitter.name} left)`, {[other ? other.id : '_']: {text: quitter.name + ' left the duel, so you win!', result: 'win'}, [quitter.id]: {text: 'You left the duel.', result: 'lose'}});
  }
}
function teacherDrop(c) {
  const st = byConn(c);
  if (st && !T.closing) markOffline(st);
}
function markOffline(st) {
  st.online = false; st.conn = null;
  for (const ch of [...T.ch.values()]) {
    if (ch.a !== st.id && ch.b !== st.id) continue;
    if (ch.status === 'pending') chClose(ch, null, {[ch.a === st.id ? ch.b : ch.a]: st.name + ' disconnected, so the challenge was cancelled.'}, true);
    else if (ch.status === 'active') chForfeit(ch, st);
  }
  rosterOut(); renderTeacher();
}
function removeStudent(st, kicked) {
  if (kicked) tSend(st, {type: 'kicked'});
  const c = st.conn;
  markOffline(st);
  T.students.delete(st.id);
  if (T.round) T.round.res.delete(st.id);
  setTimeout(() => { try { c && c.close(); } catch (e) {} }, 200);
  rosterOut(); boardOut(); renderTeacher();
}

function startClassRound(g) {
  for (const ch of [...T.ch.values()]) chClose(ch, null, {[ch.a]: 'Challenge cancelled: your teacher started a class round.', [ch.b]: 'Challenge cancelled: your teacher started a class round.'}, true);
  T.round = {id: 'r' + ++T.rounds, game: g, open: true, res: new Map()};
  tBroadcast({type: 'round', id: T.round.id, game: g});
  renderTeacher();
}
function endClassRound() {
  const r = T.round; if (!r || !r.open) return;
  r.open = false;
  const ranked = [...r.res.entries()].filter(([, v]) => v.avg != null).sort((x, y) => x[1].avg - y[1].avg);
  for (const st of T.students.values()) {
    const i = ranked.findIndex(([id]) => id === st.id);
    tSend(st, {type: 'roundEnd', id: r.id, rank: i >= 0 ? i + 1 : null, total: ranked.length, avg: i >= 0 ? ranked[i][1].avg : null});
  }
  renderTeacher();
}
function renderRoundLive() {
  const r = T.round, box = $('roundLive');
  $('roundStart').classList.toggle('hidden', !!(r && r.open));
  $('endRound').classList.toggle('hidden', !(r && r.open));
  if (!r) { box.replaceChildren(); return; }
  const online = [...T.students.values()].filter(s => s.online || r.res.has(s.id));
  const rows = online.map(s => ({s, v: r.res.get(s.id) || {trial: 0, avg: null}}))
    .sort((x, y) => (x.v.avg ?? 1e9) - (y.v.avg ?? 1e9) || y.v.trial - x.v.trial || x.s.name.localeCompare(y.s.name));
  const finished = rows.filter(x => x.v.avg != null);
  $('roundInfo').textContent = r.open
    ? `${titles[r.game]} round in progress · ${finished.length} of ${online.length} finished`
    : `${titles[r.game]} round finished · ${finished.length} completed. Start another round below.`;
  const parts = [];
  if (!r.open && finished.length) {
    parts.push(h('div', {class: 'podium'}, ...finished.slice(0, 3).map((x, i) => h('div', {class: 'p' + (i + 1)}, ['🥇', '🥈', '🥉'][i] + ' ' + x.s.name, h('small', {}, ms(x.v.avg))))));
  }
  parts.push(h('div', {class: 'table-scroll'}, h('table', {class: 'live'}, h('thead', {}, h('tr', {}, h('th', {}, 'Student'), h('th', {}, 'Progress'), h('th', {}, 'Average'))),
    h('tbody', {}, rows.map(x => h('tr', {}, h('td', {}, x.s.name), h('td', {}, h('div', {class: 'pbar'}, h('i', {style: '--w:' + (x.v.trial / 5 * 100) + '%'}))),
      h('td', {}, x.v.avg != null ? ms(x.v.avg) : r.res.has(x.s.id) ? 'Trial ' + Math.min(x.v.trial + 1, 5) + ' of 5' : r.open ? 'Not started' : '—')))))));
  box.replaceChildren(...parts);
}
function renderTeacher() {
  if (mode !== 'teacher') return;
  const all = [...T.students.values()], online = all.filter(s => s.online);
  $('tCount').textContent = online.length;
  $('tStudents').replaceChildren(...(all.length ? all.map(s => h('div', {class: 'person' + (s.online ? '' : ' off') + (s.busy ? ' busy' : ''), title: s.online ? (s.busy ? 'In a challenge' : 'Online') : 'Disconnected'}, h('span', {class: 'dot'}), s.name,
    h('button', {class: 'x', 'aria-label': 'Remove ' + s.name, onclick: () => { if (confirm('Remove ' + s.name + ' from the class?')) removeStudent(s, true); }}, '×'))) : [h('span', {class: 'muted'}, 'Waiting for students to join…')]));
  renderTabs(document.querySelector('[data-tabs="teacher"]'), T.boardGame, g => { T.boardGame = g; renderTeacher(); });
  renderBoard($('tBoard'), boardData()[T.boardGame], null, 30);
  $('feed').replaceChildren(...(T.feed.length ? T.feed.map(f => h('li', {}, f.text)) : [h('li', {class: 'muted'}, 'Challenge results will appear here.')]));
  renderRoundLive();
}
document.querySelectorAll('[data-round]').forEach(b => b.onclick = () => startClassRound(b.dataset.round));
$('endRound').onclick = endClassRound;
$('allowChal').onchange = e => {
  T.allow = e.target.checked;
  if (!T.allow) for (const ch of [...T.ch.values()]) if (ch.status === 'pending') chClose(ch, null, {[ch.a]: 'Your teacher turned challenges off.', [ch.b]: ''}, true);
  tBroadcast({type: 'settings', challengesOn: T.allow});
};
$('copyLink').onclick = async () => { try { await navigator.clipboard.writeText(joinUrl(T.code)); $('copyLink').textContent = 'Copied!'; setTimeout(() => $('copyLink').textContent = 'Copy link', 1500); } catch (e) { prompt('Copy this link:', joinUrl(T.code)); } };
$('fullscreen').onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => {}); };
$('endClass').onclick = () => {
  if (!confirm('End the class? Everyone will be disconnected and all scores disappear.')) return;
  T.closing = true; tBroadcast({type: 'closed'});
  setTimeout(() => {
    try { T.peer.destroy(); } catch (e) {}
    T.peer = null; T.students.clear(); T.ch.clear(); T.round = null; T.feed = []; T.allow = true; $('allowChal').checked = true;
    try { T.wake && T.wake.release(); } catch (e) {}
    mode = 'solo'; setPill(''); show('start');
  }, 400);
};

// ================= NAVIGATION =================
$('goSolo').onclick = () => { ctx = null; show('solo'); historyUI(); };
$('goJoin').onclick = () => { show('join'); joinStatus(''); $('joinCode').focus(); };
$('goTeach').onclick = teacherCreate;
$('brand').onclick = () => {
  if (!$('game').classList.contains('hidden') && !leavingChallenge()) return;
  if (mode === 'solo') { idle(); show('start'); } else goHome();
};
$('joinCode').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
$('joinForm').addEventListener('submit', e => {
  e.preventDefault();
  const code = $('joinCode').value.trim().toUpperCase(), nm = cleanName($('joinName').value);
  if (code.length !== 5) { joinStatus('The class code has 5 letters and numbers.', true); return; }
  if (!nm) { joinStatus('Type your first name.', true); return; }
  try { localStorage.setItem('reactionlab-joinname', nm); } catch (x) {}
  studentJoin(code, nm);
});
try { $('joinName').value = localStorage.getItem('reactionlab-joinname') || ''; } catch (e) {}
(function boot() {
  const code = (new URLSearchParams(location.search).get('join') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  if (code) { $('joinCode').value = code; show('join'); ($('joinName').value ? $('joinBtn') : $('joinName')).focus(); }
  else show('start');
  historyUI();
})();
