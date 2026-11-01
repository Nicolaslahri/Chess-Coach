// Turns engine numbers into a grade and a plain-English explanation.
import { Chess } from 'chess.js';

const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const NAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

export const GRADES = {
  best: { label: 'Best move', color: '#3fae5a', icon: '★' },
  good: { label: 'Good', color: '#7fbf4d', icon: '✓' },
  inaccuracy: { label: 'Inaccuracy', color: '#e6b422', icon: '?!' },
  mistake: { label: 'Mistake', color: '#e8812c', icon: '?' },
  blunder: { label: 'Blunder', color: '#d64545', icon: '??' },
};

// Mate scores become very large centipawn values so they can be compared.
export function toCp(score) {
  if (score.mate != null) return score.mate > 0 ? 10000 - score.mate * 10 : -10000 - score.mate * 10;
  return score.cp;
}

// Chance of winning (0-100) for a centipawn score, same curve Lichess uses.
export function winPct(cp) {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

function tryMove(chess, uci) {
  try {
    return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || 'q' });
  } catch {
    return null;
  }
}

function materialFor(chess, color) {
  let total = 0;
  for (const row of chess.board()) for (const sq of row) {
    if (sq) total += (sq.color === color ? 1 : -1) * VALUE[sq.type];
  }
  return total;
}

// Material balance (for `me`) after playing a line, continuing through any
// capture sequence so we don't stop in the middle of a trade.
function materialAfterLine(fen, ucis, me, minPlies = 5) {
  const c = new Chess(fen);
  let last = null;
  for (let i = 0; i < ucis.length; i++) {
    if (i >= minPlies && !(last && last.captured)) break;
    const m = tryMove(c, ucis[i]);
    if (!m) break;
    last = m;
  }
  return materialFor(c, me);
}

// A move written inside coach text as {{SAN@FEN}} so the page can make it clickable.
export const tok = (fen, san) => `{{${san}@${fen}}}`;

// Each move of a line with the position it was played from.
export function sanLine(fen, ucis, n = 6) {
  const c = new Chess(fen);
  const out = [];
  for (const u of ucis.slice(0, n)) {
    const before = c.fen();
    const m = tryMove(c, u);
    if (!m) break;
    out.push({ san: m.san, fen: before });
  }
  return out;
}

const SIDE = { w: 'White', b: 'Black' };

// Plain-English meaning of a move like "Nxf7+".
export function describeMove(fen, san) {
  let m;
  try {
    m = new Chess(fen).move(san);
  } catch {
    return null;
  }
  const who = SIDE[m.color];
  let say;
  if (m.san.startsWith('O-O-O')) {
    say = `${who} castles on the queen's side: the king moves two squares to ${m.to} and the rook jumps over it to the ${m.color === 'w' ? 'd1' : 'd8'} square.`;
  } else if (m.san.startsWith('O-O')) {
    say = `${who} castles on the king's side: the king moves two squares to ${m.to} and the rook jumps over it to the ${m.color === 'w' ? 'f1' : 'f8'} square.`;
  } else {
    const piece = `${who}'s ${NAME[m.piece]} on ${m.from}`;
    if (m.flags.includes('e')) say = `${piece} takes the pawn next to it "en passant" and lands on ${m.to}.`;
    else if (m.captured) say = `${piece} takes the ${SIDE[m.color === 'w' ? 'b' : 'w'].toLowerCase()} ${NAME[m.captured]} on ${m.to}.`;
    else say = `${piece} moves to ${m.to}.`;
    if (m.promotion) say += ` The pawn reaches the last row and turns into a ${NAME[m.promotion]}.`;
  }
  if (m.san.includes('#')) say += ' Checkmate: the king is attacked and has no escape.';
  else if (m.san.includes('+')) say += ' It puts the king in check, so the other side must deal with that first.';

  const parts = [];
  const letter = m.san[0];
  if ('NBRQK'.includes(letter) && !m.san.startsWith('O-O')) parts.push(`${letter} = ${NAME[letter.toLowerCase()]}`);
  else if (!m.san.startsWith('O-O')) parts.push('no capital letter = a pawn');
  else parts.push('O-O = castle king side, O-O-O = queen side');
  if (m.san.includes('x')) parts.push('x = takes');
  if (!m.san.startsWith('O-O')) parts.push(`${m.to} = the square (column ${m.to[0]}, row ${m.to[1]})`);
  if (m.promotion) parts.push(`=${m.promotion.toUpperCase()} = becomes a ${NAME[m.promotion]}`);
  if (m.san.includes('#')) parts.push('# = checkmate');
  else if (m.san.includes('+')) parts.push('+ = check');
  return { san: m.san, text: say, legend: parts.join(' · '), from: m.from, to: m.to, fenAfter: m.after };
}

function pawns(cp) {
  const p = Math.abs(cp) / 100;
  if (p >= 9) return 'a decisive amount';
  return `about ${p.toFixed(1)} pawn${p >= 0.95 && p < 1.05 ? '' : 's'}`;
}

/**
 * pre:  analysis of the position before your move (your point of view)
 * post: analysis of the position after your move (opponent's point of view)
 */
export function review({ fenBefore, played, pre, post, me }) {
  const preLine = pre.lines[0];
  const bestUci = preLine?.pv[0] || pre.bestmove;
  const playedUci = played.from + played.to + (played.promotion || '');

  const fenAfter = played.after;
  const afterChess = new Chess(fenAfter);

  // Game ended with your move.
  if (afterChess.isCheckmate()) {
    return { grade: 'best', title: 'Checkmate!', text: 'You found the mate. Well played.', bestUci, playedUci };
  }

  const postLine = post?.lines[0];
  const bestCp = toCp(preLine.score);
  const playedCp = postLine ? -toCp(postLine.score) : 0; // draw by stalemate/repetition = 0
  const loss = Math.max(0, winPct(bestCp) - winPct(playedCp));
  const cpLoss = Math.max(0, bestCp - playedCp);

  let grade;
  if (playedUci.slice(0, 4) === bestUci.slice(0, 4) || loss < 2) grade = 'best';
  else if (loss < 10) grade = 'good';
  else if (loss < 20) grade = 'inaccuracy';
  else if (loss < 30) grade = 'mistake';
  else grade = 'blunder';

  const beforeChess = new Chess(fenBefore);
  const bestMove = tryMove(new Chess(fenBefore), bestUci);
  const bestSan = bestMove?.san || bestUci;
  const replyUci = postLine?.pv[0];
  const replyMove = replyUci ? tryMove(new Chess(fenAfter), replyUci) : null;
  const replySan = replyMove?.san;
  const bestLine = sanLine(fenBefore, preLine.pv, 6);
  const punishLine = postLine ? sanLine(fenAfter, postLine.pv, 6) : [];

  const result = { grade, bestUci, playedUci, bestSan, bestLine, punishLine, cpLoss, threatUci: null };

  if (grade === 'best') {
    result.title = 'Best move';
    result.text = encouragement(played, beforeChess);
    return result;
  }
  if (grade === 'good') {
    result.title = 'Good move';
    result.text = `Solid. ${tok(fenBefore, bestSan)} was a little more precise, but you're fine.`;
    return result;
  }

  result.threatUci = replyUci || null;
  result.title = GRADES[grade].label;
  result.text = explainError({
    fenBefore, fenAfter, played, me, preLine, postLine, bestMove, bestSan,
    replyMove, replySan, cpLoss, beforeChess,
  });
  return result;
}

function encouragement(played, beforeChess) {
  if (played.san.includes('#')) return 'Checkmate!';
  if (played.captured) return `Good capture: you won a ${NAME[played.captured]}.`;
  if (played.san.startsWith('O-O')) return 'Castling gets your king to safety and brings a rook into play.';
  if (beforeChess.moveNumber() <= 10 && 'nb'.includes(played.piece)) return 'Nice, developing your pieces toward the center.';
  return "That's what the engine would play too.";
}

function explainError(c) {
  const { fenBefore, fenAfter, played, me, preLine, postLine, bestMove, bestSan, replyMove, replySan, cpLoss, beforeChess } = c;
  const parts = [];
  const fenB = fenBefore;
  const B = tok(fenB, bestSan);
  const R = replySan ? tok(fenAfter, replySan) : '';

  // 1. You walked into a forced mate.
  if (postLine && postLine.score.mate != null && postLine.score.mate > 0) {
    const n = postLine.score.mate;
    parts.push(n === 1
      ? `This allows checkmate: ${R} ends the game.`
      : `This lets your opponent force checkmate in ${n}, starting with ${R}.`);
    parts.push(`${B} was needed.`);
    return parts.join(' ');
  }

  // 2. You missed a forced mate.
  if (preLine.score.mate != null && preLine.score.mate > 0) {
    parts.push(`You had a forced checkmate in ${preLine.score.mate}, starting with ${B}.`);
    return parts.join(' ');
  }

  // 3. Material: compare what happens after your move vs after the best move.
  const matNow = materialFor(beforeChess, me);
  const matPlayed = materialAfterLine(fenBefore, [played.lan, ...(postLine?.pv || [])], me);
  const matBest = materialAfterLine(fenBefore, preLine.pv, me);

  if (matBest - matPlayed >= 1) {
    if (matPlayed < matNow) {
      // You lose material.
      if (replyMove?.captured) {
        const piece = NAME[replyMove.captured];
        if (replyMove.to === played.to) {
          parts.push(`Your ${NAME[played.piece]} on ${played.to} isn't safe there. ${R} wins it.`);
        } else {
          parts.push(`This leaves your ${piece} on ${replyMove.to} unprotected. Your opponent can take it with ${R}.`);
        }
      } else if (replyMove) {
        const tactic = replyMove.san.includes('+') ? ' It comes with check, so you have no time to save everything.' : '';
        parts.push(`After ${R} you lose material.${tactic}`);
      } else {
        parts.push('This loses material.');
      }
    } else if (bestMove?.captured) {
      parts.push(`You missed ${B}, which wins a ${NAME[bestMove.captured]}.`);
    } else {
      parts.push(`You missed ${B}, which wins material.`);
    }
    if (matPlayed < matNow) parts.push(`${B} was better.`);
    return parts.join(' ');
  }

  // 4. No material swing: give a simple positional hint.
  const hint = positionalHint(played, bestMove, beforeChess);
  if (hint) parts.push(hint);
  parts.push(`${B} was stronger. Your move gives away ${pawns(cpLoss)} of advantage.`);
  if (replySan) parts.push(`Now your opponent's best reply is ${R}.`);
  return parts.join(' ');
}

function positionalHint(played, bestMove, beforeChess) {
  const early = beforeChess.moveNumber() <= 10;
  const BM = bestMove ? tok(beforeChess.fen(), bestMove.san) : '';
  if (played.piece === 'k' && !played.san.startsWith('O-O') && early)
    return 'Moving your king early gives up castling and leaves it exposed.';
  if (early && played.piece === 'q')
    return 'Bringing the queen out early lets your opponent gain time by attacking it.';
  if (bestMove?.san.startsWith('O-O')) return `Castling (${BM}) would get your king safe first.`;
  if (early && bestMove && 'nb'.includes(bestMove.piece) && (bestMove.from[1] === '1' || bestMove.from[1] === '8'))
    return `${BM} develops a new piece, which matters more right now.`;
  if (early && played.piece === 'p' && 'fgh'.includes(played.from[0]) && bestMove?.piece !== 'p')
    return 'Pushing pawns in front of your king weakens it.';
  if (bestMove?.san.includes('+')) return `${BM} puts your opponent in check and keeps the initiative.`;
  return '';
}
