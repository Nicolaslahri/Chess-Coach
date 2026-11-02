// "Before you move" coaching: what a teacher would point out before you play.
import { Chess } from 'chess.js';
import { tok, toCp } from './coach.js';

const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
const NAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const SIDE = { w: 'White', b: 'Black' };

function tryMove(chess, uci) {
  try {
    return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || 'q' });
  } catch {
    return null;
  }
}

// Same position but with the other side to move, to ask "what does the
// opponent want to do next?". Returns null when that position is illegal.
export function nullMoveFen(fen) {
  const parts = fen.split(' ');
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  parts[3] = '-';
  const flipped = parts.join(' ');
  try {
    const c = new Chess(flipped);
    // The side that just "passed" must not be able to capture the king.
    if (c.inCheck()) return null;
    return flipped;
  } catch {
    return null;
  }
}

// Pieces of `color` that are attacked and either unprotected or attacked by
// something cheaper.
export function loosePieces(chess, color) {
  const enemy = color === 'w' ? 'b' : 'w';
  const out = [];
  for (const row of chess.board()) for (const sq of row) {
    if (!sq || sq.color !== color || sq.type === 'k') continue;
    const attackers = chess.attackers(sq.square, enemy);
    if (!attackers.length) continue;
    const defenders = chess.attackers(sq.square, color);
    const cheapest = Math.min(...attackers.map((s) => VALUE[chess.get(s).type]));
    if (!defenders.length || cheapest < VALUE[sq.type]) {
      out.push({ square: sq.square, type: sq.type, defended: defenders.length > 0 });
    }
  }
  return out.sort((a, b) => VALUE[b.type] - VALUE[a.type]);
}

function undeveloped(chess, color) {
  const home = color === 'w'
    ? { b1: 'n', g1: 'n', c1: 'b', f1: 'b' }
    : { b8: 'n', g8: 'n', c8: 'b', f8: 'b' };
  return Object.entries(home)
    .filter(([sq, t]) => { const p = chess.get(sq); return p && p.color === color && p.type === t; })
    .map(([sq, t]) => `${NAME[t]} on ${sq}`);
}

function hasCastled(chess, color) {
  const k = color === 'w' ? ['g1', 'c1', 'b1', 'h1'] : ['g8', 'c8', 'b8', 'h8'];
  return chess.history({ verbose: true }).some((m) => m.color === color && m.san.startsWith('O-O'))
    || k.some((sq) => { const p = chess.get(sq); return p && p.type === 'k' && p.color === color; });
}

function material(chess, color) {
  let t = 0;
  for (const row of chess.board()) for (const sq of row) if (sq && sq.type !== 'k') t += (sq.color === color ? 1 : -1) * VALUE[sq.type];
  return t;
}

/**
 * Build the notes shown before you move.
 * pre: engine analysis of the current position (your view)
 * threat: engine analysis of the null-move position (opponent's view), or null
 */
export function beforeYouMove({ chess, me, pre, threat }) {
  const notes = [];
  const fen = chess.fen();
  const them = me === 'w' ? 'b' : 'w';
  const best = pre?.lines[0];

  // 1. What is the opponent threatening?
  if (threat?.lines[0] && best) {
    const tl = threat.lines[0];
    const tm = tryMove(new Chess(threat.fen), tl.pv[0]);
    const threatCp = toCp(tl.score); // opponent's view if they could move again
    const nowCp = -toCp(best.score); // opponent's view now
    if (tm && (tl.score.mate > 0 || threatCp - nowCp >= 150)) {
      const t = tok(threat.fen, tm.san);
      let text;
      if (tl.score.mate > 0) text = `Danger: ${SIDE[them]} threatens checkmate, starting with ${t}. Deal with it first.`;
      else if (tm.captured) text = `Danger: ${SIDE[them]} threatens ${t}, winning your ${NAME[tm.captured]} on ${tm.to}.`;
      else text = `Danger: ${SIDE[them]} threatens ${t}. Ask yourself what that move attacks.`;
      notes.push({ kind: 'threat', text, arrow: tm.from + tm.to });
    }
  }

  // 2. Your pieces that can be taken.
  const loose = loosePieces(chess, me).slice(0, 2);
  for (const p of loose) {
    if (notes.some((n) => n.kind === 'threat' && n.arrow?.slice(2) === p.square)) continue;
    notes.push({
      kind: 'loose',
      text: p.defended
        ? `Your ${NAME[p.type]} on ${p.square} is attacked by a cheaper piece.`
        : `Your ${NAME[p.type]} on ${p.square} is attacked and not protected.`,
      square: p.square,
    });
  }

  // 3. A chance to win something: tell the student it exists, not what it is.
  if (best) {
    if (best.score.mate > 0) {
      notes.push({ kind: 'chance', text: best.score.mate === 1 ? 'You can checkmate in one move. Find it!' : `You have a forced checkmate in ${best.score.mate}. Look for checks!` });
    } else {
      const c = new Chess(fen);
      const before = material(c, me);
      let last = null;
      for (let i = 0; i < best.pv.length && (i < 4 || last?.captured); i++) { last = tryMove(c, best.pv[i]); if (!last) break; }
      const gain = material(c, me) - before;
      if (gain >= 2) notes.push({ kind: 'chance', text: `There's a way to win material here (about ${gain} pawns' worth). Look for captures, checks and forks.` });
    }
  }

  // 4. Nothing urgent: a reminder of good habits in the opening.
  if (!notes.length && chess.moveNumber() <= 12) {
    const dev = undeveloped(chess, me);
    const castled = hasCastled(chess, me);
    if (dev.length >= 2) notes.push({ kind: 'idea', text: `No danger right now. You still have ${dev.length} knights and bishops at home (${dev.join(', ')}). Bring them out toward the center.` });
    else if (!castled && chess.moveNumber() >= 5) notes.push({ kind: 'idea', text: 'No danger right now. Think about castling to get your king safe.' });
  }
  if (!notes.length) notes.push({ kind: 'idea', text: 'No danger right now. Find your worst piece and make it better.' });
  return notes;
}

// Three hints that reveal a little more each time.
export function hintLadder(fen, best) {
  const m = best ? tryMove(new Chess(fen), best.pv[0]) : null;
  if (!m) return [];
  let kind = 'a quiet move: it does not capture or give check';
  if (m.san.includes('#')) kind = 'checkmate';
  else if (m.san.includes('+') && m.captured) kind = `a capture that also gives check`;
  else if (m.san.includes('+')) kind = 'a check';
  else if (m.captured) kind = `a capture (it takes a ${NAME[m.captured]})`;
  else if (m.san.startsWith('O-O')) kind = 'castling';
  return [
    { text: `Look at your ${NAME[m.piece]} on ${m.from}.`, circle: m.from },
    { text: `The move is ${kind}. Where can that ${NAME[m.piece]} go?`, circle: m.from },
    { text: `The best move is ${tok(fen, m.san)}.`, arrow: m.from + m.to },
  ];
}
