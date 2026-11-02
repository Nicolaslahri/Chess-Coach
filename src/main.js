import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.brown.css';
import 'chessground/assets/chessground.cburnett.css';
import './style.css';
import { Engine } from './engine.js';
import { review, GRADES, toCp, winPct, tok, describeMove } from './coach.js';
import { fetchRatings, mainRating } from './chesscom.js';
import { Chess as ChessRules } from 'chess.js';
import { PLAN, LINES, bookReply, checkWhiteMove } from './jobava.js';
import { buzz, setHaptics } from './haptics.js';
import { moveSound, play as playSound, setSounds } from './sounds.js';
import { beforeYouMove, hintLadder, nullMoveFen } from './teacher.js';

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
let mode = 'free';
let deviated = false; // left the plan at some point this game
let leftBookNoted = false;

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
  if (previewing && !$('movepop').hidden) { $('movepop').hidden = true; popFor = null; cg.setShapes([]); }
  previewing = false;
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
  savedShapes = list.filter((a) => a.uci).map((a) => ({ orig: a.uci.slice(0, 2), dest: a.uci.slice(2, 4), brush: a.brush }));
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
  $('oppstatus').textContent = text || '';
  $('opp').classList.toggle('busy', !!text);
}

function showCoach({ grade, title, text, line }) {
  const badge = $('badge');
  if (grade) {
    const g = GRADES[grade];
    badge.hidden = false;
    badge.textContent = `${g.icon} ${g.label}`;
    badge.style.background = g.color;
    $('coach').style.setProperty('--grade', g.color);
  } else {
    badge.hidden = true;
    $('coach').style.removeProperty('--grade');
  }
  $('ctitle').textContent = title;
  $('ctitle').hidden = !!grade && title === GRADES[grade].label;
  $('coach').classList.toggle('quiet', !grade);
  renderRich($('ctext'), text);
  $('cline').hidden = !line;
  $('cline').classList.remove('open');
  $('linetoggle').hidden = !line;
  $('linetoggle').textContent = 'See what happens next ▸';
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
  // Always show the move as an arrow. If it was played from a different
  // position than the one on the board, show that position for a moment.
  const onBoard = fen === chess.fen() || d.fenAfter === chess.fen();
  if (!onBoard) {
    previewing = true;
    cg.set({ fen, lastMove: undefined, check: false, movable: { color: undefined, dests: new Map() } });
    cg.setAutoShapes([]);
  } else if (previewing) {
    endPreview();
  }
  $('poppreview').hidden = onBoard;
  cg.setShapes([{ orig: d.from, dest: d.to, brush: 'blue' }]);
  pop.style.top = `${r.bottom + window.scrollY + 6}px`;
  // On phones the explanation slides up from the bottom and the page scrolls
  // back to the board so the arrow is in view.
  if (isPhone()) window.scrollTo({ top: 0, behavior: 'smooth' });
}
const isPhone = () => matchMedia('(max-width: 860px)').matches;
let previewing = false;
let savedShapes = [];
function endPreview() {
  previewing = false;
  syncBoard({ lastMove: lastMoveSquares(), interactive: !busy });
  cg.setAutoShapes(savedShapes);
}
function closePop() {
  $('movepop').hidden = true;
  popFor = null;
  cg.setShapes([]);
  if (previewing) endPreview();
}
document.addEventListener('click', (e) => {
  if (!$('movepop').hidden && !$('movepop').contains(e.target)) closePop();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); });
$('popclose').addEventListener('click', (e) => { e.stopPropagation(); closePop(); });

function setButtons({ retry = false, hint = false, cont = false } = {}) {
  $('retry').hidden = !retry;
  $('hint').hidden = !hint;
  $('continue').hidden = !cont;
}

function setEval(cpWhite) {
  const pct = winPct(cpWhite);
  $('evalbar').style.setProperty('--white', `${pct}%`);
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
  list.scrollLeft = list.scrollWidth;
  $('moves').closest('.movelist').classList.toggle('empty', hist.length === 0);
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
  teach(fen, promise, id);
}

// ---------- teacher: before you move ----------
let hints = [];
let hintLevel = 0;

async function teach(fen, prePromise, id) {
  hints = [];
  hintLevel = 0;
  $('hinttext').textContent = '';
  $('hintbtn').hidden = true;
  if (!$('teach').checked || chess.turn() !== me) { $('think').hidden = true; return; }
  $('thinktitle').textContent = 'Before you move';
  $('think').hidden = false;
  $('think').classList.remove('review');
  $('notes').innerHTML = '<li class="note idea">Looking at the position…</li>';
  const nf = nullMoveFen(fen);
  const threatPromise = nf ? coachEngine.analyse(nf, { depth: 10 }).then((a) => ({ ...a, fen: nf })) : Promise.resolve(null);
  const [preA, threat] = await Promise.all([prePromise, threatPromise]);
  if (id !== gameId || chess.fen() !== fen) return;
  const notes = beforeYouMove({ chess, me, pre: preA, threat });
  $('notes').innerHTML = '';
  const shapes = [];
  for (const n of notes) {
    const li = document.createElement('li');
    li.className = `note ${n.kind}`;
    renderRich(li, n.text);
    $('notes').append(li);
    if (n.arrow) shapes.push({ orig: n.arrow.slice(0, 2), dest: n.arrow.slice(2, 4), brush: 'red' });
    if (n.square) shapes.push({ orig: n.square, brush: 'red' });
  }
  savedShapes = shapes;
  if (!previewing) cg.setAutoShapes(shapes);
  if (notes.some((n) => n.kind === 'threat' || n.kind === 'loose')) buzz('inaccuracy');
  hints = hintLadder(fen, preA.lines[0]);
  $('hintbtn').hidden = !hints.length;
  $('hintbtn').textContent = '💡 Hint';
}

function nextHint() {
  if (hintLevel >= hints.length) return;
  const h = hints[hintLevel++];
  renderRich($('hinttext'), h.text);
  const shapes = savedShapes.filter((x) => x.brush === 'red');
  if (h.circle) shapes.push({ orig: h.circle, brush: 'green' });
  if (h.arrow) shapes.push({ orig: h.arrow.slice(0, 2), dest: h.arrow.slice(2, 4), brush: 'green' });
  savedShapes = shapes;
  cg.setAutoShapes(shapes);
  $('hintbtn').textContent = hintLevel === 1 ? '💡 Another hint' : '💡 Show the answer';
  $('hintbtn').hidden = hintLevel >= hints.length;
}

// After the game: the moments that mattered most.
function keyMoments() {
  const hist = chess.history({ verbose: true });
  const bad = reviews
    .map((r, ply) => ({ r, ply }))
    .filter(({ r }) => r && ['blunder', 'mistake', 'inaccuracy'].includes(r.grade))
    .sort((a, b) => (b.r.cpLoss || 0) - (a.r.cpLoss || 0))
    .slice(0, 3)
    .sort((a, b) => a.ply - b.ply);
  $('thinktitle').textContent = 'Key moments';
  $('think').hidden = false;
  $('think').classList.add('review');
  $('hintbtn').hidden = true;
  $('hinttext').textContent = '';
  $('notes').innerHTML = '';
  if (!bad.length) {
    $('notes').innerHTML = '<li class="note idea">No real mistakes this game. Nicely played!</li>';
    return;
  }
  for (const { r, ply } of bad) {
    const li = document.createElement('li');
    li.className = `note ${r.grade === 'inaccuracy' ? 'loose' : 'threat'}`;
    const n = Math.floor(ply / 2) + 1;
    renderRich(li, `Move ${n}: you played ${tok(r.fenBefore, hist[ply].san)} (${GRADES[r.grade].label.toLowerCase()}). Better was ${tok(r.fenBefore, r.bestSan)}. Tap the moves to see them on the board.`);
    $('notes').append(li);
  }
}

async function newGame() {
  const id = ++gameId;
  $('think').hidden = true;
  mode = $('mode').value;
  if (mode === 'jobava') $('color').value = 'w';
  $('color').disabled = mode === 'jobava';
  $('plan').hidden = mode !== 'jobava';
  $('planbtn').hidden = mode !== 'jobava';
  deviated = false;
  leftBookNoted = false;
  renderPlan();
  $('opplevel').textContent = mode === 'jobava' ? 'Jobava London trainer' : `${LEVELS[$('level').value].name} level`;
  me = $('color').value;
  chess.reset();
  reviews = [];
  paused = null;
  busy = false;
  arrows([]);
  setButtons();
  setEval(0);
  showCoach(mode === 'jobava'
    ? { title: 'Jobava London trainer', text: 'You have White. Follow the plan: d4, Nc3, Bf4. I\'ll tell you when you leave it and why each move matters.' }
    : { title: 'New game', text: me === 'w' ? 'You have White. Make your first move.' : 'You have Black. The computer moves first.' });
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
  $('think').hidden = true;
  buzz('move');
  moveSound(move);
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
  if (mode === 'jobava') applyPlan(r, fenBefore, move);
  reviews[ply] = r;
  renderMoves();

  if (post?.lines[0]) {
    const cp = toCp(post.lines[0].score);
    setEval(chess.turn() === 'w' ? cp : -cp);
  }

  const bad = ['inaccuracy', 'mistake', 'blunder', 'offplan'].includes(r.grade);
  showCoach({
    grade: r.grade,
    title: r.title,
    text: r.text,
    line: bad && r.punishLine.length ? lineText('Likely continuation:', r.punishLine) : null,
  });
  arrows(bad ? [{ uci: r.bestUci, brush: 'green' }, { uci: r.threatUci, brush: 'red' }] : []);
  if (r.grade !== 'good' && r.grade !== 'book') buzz(r.grade);
  setStatus('');

  if (chess.isGameOver()) return gameOver();

  const stop = r.grade === 'offplan' || (bad && r.grade !== 'inaccuracy');
  if (stop && $('pause').checked) {
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
  const uci = (mode === 'jobava' && bookReply(chess.fen())) || await oppEngine.play(chess.fen(), level);
  if (id !== gameId) return;
  await wait(Math.max(0, 400 - (Date.now() - started)));
  if (id !== gameId) return;
  const oppMove = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || 'q' });
  buzz('move');
  moveSound(oppMove);
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
  if (chess.isCheckmate()) {
    msg = chess.turn() === me ? 'Checkmate. The computer won this one.' : 'Checkmate. You won!';
    setTimeout(() => playSound(chess.turn() === me ? 'lose' : 'win'), 250);
  } else if (chess.isStalemate()) msg = 'Stalemate: a draw.';
  else msg = 'Draw.';
  const counts = {};
  for (const r of reviews) if (r) counts[r.grade] = (counts[r.grade] || 0) + 1;
  const summary = Object.keys(GRADES).filter((g) => counts[g]).map((g) => `${counts[g]} ${GRADES[g].label.toLowerCase()}`).join(', ');
  showCoach({ title: 'Game over', text: `${msg}${summary ? ` Your moves: ${summary}.` : ''}` });
  keyMoments();
  syncBoard({ lastMove: lastMoveSquares(), interactive: false });
}

// ---------- Jobava London trainer ----------
function mastered() {
  try { return new Set(JSON.parse(localStorage.getItem('jobavaMastered') || '[]')); } catch { return new Set(); }
}

function renderPlan() {
  $('planlist').innerHTML = '';
  for (const p of PLAN) {
    const li = document.createElement('li');
    li.textContent = p;
    $('planlist').append(li);
  }
  const done = mastered();
  $('progress').textContent = `Lines mastered: ${done.size} of ${LINES.length}`;
  $('planbadge').textContent = `${done.size}/${LINES.length}`;
  $('linelist').innerHTML = '';
  LINES.forEach((l, i) => {
    const li = document.createElement('li');
    li.className = done.has(i) ? 'done' : '';
    li.textContent = `${done.has(i) ? '✓' : '○'} ${l.name}`;
    $('linelist').append(li);
  });
}

// Compare your move with the Jobava plan and rewrite the coach's message.
function applyPlan(r, fenBefore, move) {
  const j = checkWhiteMove(fenBefore, move.san);
  const engineBad = ['mistake', 'blunder'].includes(r.grade);
  if (!j) {
    if (!leftBookNoted && chess.history().length < 30) {
      leftBookNoted = true;
      r.text += ' (You are past the prepared lines now, so the normal coach takes over. Keep the plan in mind: develop, castle, and push your pawns at Black\'s king.)';
    }
    return;
  }
  if (j.inBook) {
    if (engineBad) return; // a tactic beats the plan; keep the engine's warning
    r.grade = 'book';
    r.title = 'Plan move';
    r.text = j.note;
    if (j.ends.length) {
      const names = j.ends.map((i) => LINES[i].name).join(', ');
      if (!deviated) {
        const done = mastered();
        j.ends.forEach((i) => done.add(i));
        try { localStorage.setItem('jobavaMastered', JSON.stringify([...done])); } catch {}
        renderPlan();
        r.text += ` Line complete: "${names}". You played it all without help, so it counts as mastered.`;
      } else {
        r.text += ` Line complete: "${names}". Play it again without leaving the plan to master it.`;
      }
    }
    return;
  }
  deviated = true;
  const m = new ChessRules(fenBefore).move(j.bookSan);
  const planTok = tok(fenBefore, j.bookSan);
  if (engineBad) {
    r.text += ` The Jobava plan here is ${planTok}. ${j.note}`;
  } else {
    r.grade = 'offplan';
    r.title = 'Off plan';
    r.text = `Not a bad move, but the Jobava plan here is ${planTok}. ${j.note}`;
    r.threatUci = null;
    r.punishLine = [];
  }
  r.bestUci = m.from + m.to;
  r.bestSan = j.bookSan;
  r.bestLine = [{ san: j.bookSan, fen: fenBefore }];
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
  $('darkmode').checked = t === 'dark';
  document.querySelector('meta[name="theme-color"]').content = t === 'dark' ? '#000000' : '#f4f1ec';
}
let theme = 'dark';
try {
  theme = localStorage.getItem('theme') || 'dark';
} catch {}
applyTheme(theme);
$('darkmode').addEventListener('change', () => {
  theme = $('darkmode').checked ? 'dark' : 'light';
  applyTheme(theme);
  try { localStorage.setItem('theme', theme); } catch {}
});

// ---------- phone sheets (settings, plan) ----------
function openSheet(id) {
  closeSheets();
  $(id).classList.add('open');
  $('backdrop').hidden = false;
}
function closeSheets() {
  document.querySelectorAll('.sheet.open').forEach((el) => el.classList.remove('open'));
  $('backdrop').hidden = true;
}
$('linetoggle').addEventListener('click', () => {
  const open = $('cline').classList.toggle('open');
  $('linetoggle').textContent = open ? 'Hide line ▾' : 'See what happens next ▸';
  if (open) $('cline').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});
$('settingsbtn').addEventListener('click', () => openSheet('settings'));
$('planbtn').addEventListener('click', () => openSheet('plansheet'));
$('backdrop').addEventListener('click', closeSheets);
document.querySelectorAll('.sheetclose').forEach((b) => b.addEventListener('click', closeSheets));
$('startgame').addEventListener('click', () => { closeSheets(); newGame(); });

// The tip about tapping moves goes away once you've tried it.
try { if (localStorage.getItem('tipSeen')) $('tip').hidden = true; } catch {}
document.addEventListener('click', (e) => {
  if (e.target.closest?.('.chip')) {
    $('tip').hidden = true;
    try { localStorage.setItem('tipSeen', '1'); } catch {}
  }
});

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
$('hintbtn').addEventListener('click', nextHint);
try { $('teach').checked = localStorage.getItem('teach') !== 'off'; } catch {}
$('teach').addEventListener('change', () => {
  try { localStorage.setItem('teach', $('teach').checked ? 'on' : 'off'); } catch {}
  if (chess.turn() === me && !busy && pre) teach(pre.fen, pre.promise, gameId); else $('think').hidden = true;
});
try { $('sounds').checked = localStorage.getItem('sounds') !== 'off'; } catch {}
setSounds($('sounds').checked);
$('sounds').addEventListener('change', () => {
  setSounds($('sounds').checked);
  try { localStorage.setItem('sounds', $('sounds').checked ? 'on' : 'off'); } catch {}
  if ($('sounds').checked) playSound('move');
});
// Keep the board sharp when the window changes size.
window.addEventListener('resize', () => cg.redrawAll());
try { $('haptics').checked = localStorage.getItem('haptics') !== 'off'; } catch {}
setHaptics($('haptics').checked);
$('haptics').addEventListener('change', () => {
  setHaptics($('haptics').checked);
  try { localStorage.setItem('haptics', $('haptics').checked ? 'on' : 'off'); } catch {}
  if ($('haptics').checked) buzz('best');
});
$('mode').addEventListener('change', () => { try { localStorage.setItem('mode', $('mode').value); } catch {} newGame(); });
try { $('mode').value = localStorage.getItem('mode') || 'free'; } catch {}
$('takeback').addEventListener('click', takeBack);
$('retry').addEventListener('click', takeBack);
$('continue').addEventListener('click', () => { if (paused) engineMove(); });
$('ccform').addEventListener('submit', setLevelFromChessCom);

newGame();
