import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.brown.css';
import 'chessground/assets/chessground.cburnett.css';
import './style.css';
import { Engine } from './engine.js';
import { review, GRADES, toCp, winPct, tok, describeMove } from './coach.js';
import { fetchRatings, mainRating } from './chesscom.js';

// Opponent strengths. `maxRating` is the Chess.com rating each level suits.
const LEVELS = [
  { name: 'Beginner', skill: 0, depth: 1, maxRating: 800 },
  { name: 'Novice', skill: 3, depth: 3, maxRating: 1100 },
  { name: 'Intermediate', skill: 8, depth: 6, maxRating: 1500 },
  { name: 'Advanced', skill: 14, depth: 10, maxRating: 1900 },
  { name: 'Expert', skill: 20, depth: 14, maxRating: Infinity },
];
const COACH_DEPTH = 14;

const $ = (id) => document.getElementById(id);
const engineUrl = new URL('engine/stockfish-19-lite-single.js', document.baseURI).href;
const coachEngine = new Engine(engineUrl);
const oppEngine = new Engine(engineUrl);

const chess = new Chess();
let me = 'w';
let reviews = []; // reviews[ply] for your moves
let gameId = 0;
let pre = null; // { fen, promise } analysis of the position on your turn
let paused = null; // the review we stopped on
let busy = false;

const cg = Chessground($('board'), {
  movable: { free: false, showDests: true, events: { after: onUserMove } },
  draggable: { showGhost: true },
  highlight: { lastMove: true, check: true },
  animation: { duration: 200 },
  drawable: { enabled: true, visible: true },
});

// ---------- board helpers ----------
const colorName = (c) => (c === 'w' ? 'white' : 'black');

function dests() {
  const map = new Map();
  for (const m of chess.moves({ verbose: true })) {
    if (!map.has(m.from)) map.set(m.from, []);
    map.get(m.from).push(m.to);
  }
  return map;
}

function syncBoard({ lastMove, interactive }) {
  const myTurn = chess.turn() === me && !chess.isGameOver();
  cg.set({
    fen: chess.fen(),
    orientation: colorName(me),
    turnColor: colorName(chess.turn()),
    check: chess.inCheck(),
    lastMove,
    movable: {
      color: interactive && myTurn ? colorName(me) : undefined,
      dests: interactive && myTurn ? dests() : new Map(),
    },
  });
}

function arrows(list) {
  cg.setAutoShapes(list.filter((a) => a.uci).map((a) => ({
    orig: a.uci.slice(0, 2), dest: a.uci.slice(2, 4), brush: a.brush,
  })));
}

function lastMoveSquares() {
  const h = chess.history({ verbose: true });
  const m = h[h.length - 1];
  return m ? [m.from, m.to] : undefined;
}

// ---------- coach panel ----------
function setStatus(text) {
  $('status').textContent = text || '';
}

function showCoach({ grade, title, text, line }) {
  const badge = $('badge');
  if (grade) {
    const g = GRADES[grade];
    badge.hidden = false;
    badge.textContent = `${g.icon} ${g.label}`;
    badge.style.background = g.color;
    $('coach').style.borderColor = g.color;
  } else {
    badge.hidden = true;
    $('coach').style.borderColor = '';
  }
  $('ctitle').textContent = title;
  renderRich($('ctext'), text);
  $('cline').hidden = !line;
  renderRich($('cline'), line || '');
}

// ---------- clickable moves ----------
const lineText = (label, line) => `${label} ${line.map((m) => tok(m.fen, m.san)).join(' ')}`;

function moveChip(san, fen) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.textContent = san;
  b.title = 'What does this mean?';
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    explainMove(b, fen, san);
  });
  return b;
}

// Render text where {{SAN@FEN}} becomes a clickable move.
function renderRich(el, text) {
  el.innerHTML = '';
  const re = /\{\{([^@}]+)@([^}]+)\}\}/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    el.append(text.slice(last, m.index), moveChip(m[1], m[2]));
    last = m.index + m[0].length;
  }
  el.append(text.slice(last));
}

let popFor = null;
function explainMove(anchor, fen, san) {
  const pop = $('movepop');
  if (popFor === anchor && !pop.hidden) return closePop();
  const d = describeMove(fen, san);
  if (!d) return;
  popFor = anchor;
  $('popsan').textContent = d.san;
  $('poptext').textContent = d.text;
  $('poplegend').textContent = d.legend;
  pop.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth;
  const left = Math.min(Math.max(8, r.left + window.scrollX), window.scrollX + document.documentElement.clientWidth - w - 8);
  pop.style.left = `${left}px`;
  pop.style.top = `${r.bottom + window.scrollY + 6}px`;
  // Point at the move on the board when it was played from the position shown.
  if (fen === chess.fen() || d.fenAfter === chess.fen()) {
    cg.setShapes([{ orig: d.from, dest: d.to, brush: 'blue' }]);
  }
}
function closePop() {
  $('movepop').hidden = true;
  popFor = null;
  cg.setShapes([]);
}
document.addEventListener('click', (e) => {
  if (!$('movepop').hidden && !$('movepop').contains(e.target)) closePop();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); });

function setButtons({ retry = false, hint = false, cont = false } = {}) {
  $('retry').hidden = !retry;
  $('hint').hidden = !hint;
  $('continue').hidden = !cont;
}

function setEval(cpWhite) {
  const pct = winPct(cpWhite);
  $('evalfill').style.height = `${pct}%`;
  const txt = Math.abs(cpWhite) >= 9000
    ? `M${Math.round((10000 - Math.abs(cpWhite)) / 10)}`
    : (Math.abs(cpWhite) / 100).toFixed(1);
  $('evaltext').textContent = txt;
  $('evalbar').classList.toggle('flipped', me === 'b');
}

function renderMoves() {
  const list = $('moves');
  list.innerHTML = '';
  const hist = chess.history({ verbose: true });
  for (let i = 0; i < hist.length; i += 2) {
    const li = document.createElement('li');
    for (const ply of [i, i + 1]) {
      if (ply >= hist.length) break;
      const span = document.createElement('span');
      span.className = 'mv';
      span.append(moveChip(hist[ply].san, hist[ply].before));
      const r = reviews[ply];
      if (r) {
        const g = GRADES[r.grade];
        const tag = document.createElement('b');
        tag.textContent = g.icon;
        tag.style.color = g.color;
        tag.title = g.label;
        span.append(' ', tag);
      }
      li.append(span);
    }
    list.append(li);
  }
  list.scrollTop = list.scrollHeight;
}

// ---------- game flow ----------
function startPreAnalysis() {
  const fen = chess.fen();
  const promise = coachEngine.analyse(fen, { depth: COACH_DEPTH });
  pre = { fen, promise };
  const id = gameId;
  promise.then((a) => {
    if (id !== gameId || !a.lines[0]) return;
    const cp = toCp(a.lines[0].score);
    setEval(chess.turn() === 'w' ? cp : -cp);
  });
}

async function newGame() {
  const id = ++gameId;
  me = $('color').value;
  chess.reset();
  reviews = [];
  paused = null;
  busy = false;
  arrows([]);
  setButtons();
  setEval(0);
  showCoach({ title: 'New game', text: me === 'w' ? 'You have White. Make your first move.' : 'You have Black. The computer moves first.' });
  syncBoard({ interactive: false });
  renderMoves();
  await Promise.all([coachEngine.newGame(), oppEngine.newGame()]);
  if (id !== gameId) return;
  if (chess.turn() !== me) engineMove();
  else yourTurn();
}

function yourTurn() {
  busy = false;
  startPreAnalysis();
  syncBoard({ lastMove: lastMoveSquares(), interactive: true });
  setStatus('');
}

async function onUserMove(from, to) {
  const id = gameId;
  const fenBefore = chess.fen();
  let move;
  try {
    move = chess.move({ from, to, promotion: 'q' });
  } catch {
    syncBoard({ interactive: true });
    return;
  }
  busy = true;
  const ply = chess.history().length - 1;
  syncBoard({ lastMove: [from, to], interactive: false });
  arrows([]);
  renderMoves();
  setStatus('Checking your move…');

  const preAnalysis = await (pre && pre.fen === fenBefore ? pre.promise : coachEngine.analyse(fenBefore, { depth: COACH_DEPTH }));
  const post = chess.isGameOver() ? null : await coachEngine.analyse(chess.fen(), { depth: COACH_DEPTH });
  if (id !== gameId) return;

  const r = review({ fenBefore, played: move, pre: preAnalysis, post, me });
  r.fenBefore = fenBefore;
  reviews[ply] = r;
  renderMoves();

  if (post?.lines[0]) {
    const cp = toCp(post.lines[0].score);
    setEval(chess.turn() === 'w' ? cp : -cp);
  }

  const bad = ['inaccuracy', 'mistake', 'blunder'].includes(r.grade);
  showCoach({
    grade: r.grade,
    title: r.title,
    text: r.text,
    line: bad && r.punishLine.length ? lineText('Likely continuation:', r.punishLine) : null,
  });
  arrows(bad ? [{ uci: r.bestUci, brush: 'green' }, { uci: r.threatUci, brush: 'red' }] : []);
  setStatus('');

  if (chess.isGameOver()) return gameOver();

  if (bad && r.grade !== 'inaccuracy' && $('pause').checked) {
    paused = r;
    setButtons({ retry: true, cont: true });
    return;
  }
  await wait(bad ? 1800 : 500);
  if (id !== gameId) return;
  engineMove();
}

async function engineMove() {
  const id = gameId;
  busy = true;
  paused = null;
  setButtons();
  setStatus('Opponent is thinking…');
  const level = LEVELS[$('level').value];
  const started = Date.now();
  const uci = await oppEngine.play(chess.fen(), level);
  if (id !== gameId) return;
  await wait(Math.max(0, 400 - (Date.now() - started)));
  if (id !== gameId) return;
  chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || 'q' });
  arrows([]);
  renderMoves();
  if (chess.isGameOver()) {
    syncBoard({ lastMove: lastMoveSquares(), interactive: false });
    return gameOver();
  }
  yourTurn();
}

function gameOver() {
  busy = false;
  setStatus('');
  setButtons();
  let msg;
  if (chess.isCheckmate()) msg = chess.turn() === me ? 'Checkmate. The computer won this one.' : 'Checkmate. You won!';
  else if (chess.isStalemate()) msg = 'Stalemate: a draw.';
  else msg = 'Draw.';
  const counts = {};
  for (const r of reviews) if (r) counts[r.grade] = (counts[r.grade] || 0) + 1;
  const summary = Object.keys(GRADES).filter((g) => counts[g]).map((g) => `${counts[g]} ${GRADES[g].label.toLowerCase()}`).join(', ');
  showCoach({ title: 'Game over', text: `${msg}${summary ? ` Your moves: ${summary}.` : ''}` });
  syncBoard({ lastMove: lastMoveSquares(), interactive: false });
}

// Undo back to your last move so you can try something else.
function takeBack() {
  if (busy && !paused) return;
  gameId++;
  const target = paused ? 1 : chess.turn() === me ? 2 : 1;
  let r = null;
  for (let i = 0; i < target && chess.history().length; i++) {
    const ply = chess.history().length - 1;
    r = reviews[ply] || r;
    chess.undo();
    reviews.length = Math.min(reviews.length, ply);
  }
  while (chess.turn() !== me && chess.history().length) chess.undo();
  paused = null;
  arrows([]);
  renderMoves();
  yourTurn();
  if (r && r.grade !== 'best') {
    showCoach({ title: 'Try again', text: 'Look for a better move. Stuck? Tap “Show best move”.' });
    setButtons({ hint: true });
    $('hint').onclick = () => {
      arrows([{ uci: r.bestUci, brush: 'green' }]);
      showCoach({ title: 'Best move', text: `The engine's choice here is ${tok(r.fenBefore, r.bestSan)}. ${lineText('Line:', r.bestLine)}` });
      setButtons();
    };
  } else {
    showCoach({ title: 'Your move', text: 'Move taken back.' });
    setButtons();
  }
}

const wait = (ms) => new Promise((res) => setTimeout(res, ms));

// ---------- Chess.com level ----------
function levelForRating(rating) {
  return LEVELS.findIndex((l) => rating <= l.maxRating);
}

async function setLevelFromChessCom(e) {
  e.preventDefault();
  const user = $('ccuser').value.trim();
  if (!user) return;
  $('ccresult').textContent = 'Looking you up…';
  try {
    const ratings = await fetchRatings(user);
    const main = mainRating(ratings);
    if (!main) {
      $('ccresult').textContent = 'No rated games found on that account yet.';
      return;
    }
    const idx = levelForRating(main.rating);
    $('level').value = idx;
    try { localStorage.setItem('chesscomUser', user); localStorage.setItem('level', idx); } catch {}
    const others = ['rapid', 'blitz', 'bullet', 'daily'].filter((k) => ratings[k] && k !== main.kind).map((k) => `${k} ${ratings[k]}`).join(', ');
    $('ccresult').textContent = `Your ${main.kind} rating is ${main.rating}${others ? ` (${others})` : ''}, so I picked "${LEVELS[idx].name}". It applies from your next game.`;
  } catch (err) {
    $('ccresult').textContent = err.message || 'Could not reach Chess.com.';
  }
}

// ---------- theme ----------
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  $('theme').textContent = t === 'dark' ? '☀ Light' : '☾ Dark';
}
let theme = 'dark';
try {
  theme = localStorage.getItem('theme') || 'dark';
} catch {}
applyTheme(theme);
$('theme').addEventListener('click', () => {
  theme = theme === 'dark' ? 'light' : 'dark';
  applyTheme(theme);
  try { localStorage.setItem('theme', theme); } catch {}
});

// ---------- wiring ----------
LEVELS.forEach((l, i) => {
  const o = document.createElement('option');
  o.value = i;
  o.textContent = l.name;
  $('level').append(o);
});
try {
  $('level').value = localStorage.getItem('level') ?? 1;
  $('ccuser').value = localStorage.getItem('chesscomUser') ?? '';
} catch {
  $('level').value = 1;
}
$('level').addEventListener('change', () => { try { localStorage.setItem('level', $('level').value); } catch {} });
$('newgame').addEventListener('click', newGame);
$('takeback').addEventListener('click', takeBack);
$('retry').addEventListener('click', takeBack);
$('continue').addEventListener('click', () => { if (paused) engineMove(); });
$('ccform').addEventListener('submit', setLevelFromChessCom);

newGame();
