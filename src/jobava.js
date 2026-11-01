// Jobava London repertoire for White (1.d4, 2.Nc3, 3.Bf4).
// Lines are stored as SAN move lists. Positions are matched by board, not by
// move order, so transpositions (1.d4 Nf6 2.Nc3 d5) land in the same lines.
import { Chess } from 'chess.js';

export const PLAN = [
  'Set up with d4, Nc3 and Bf4, then e3.',
  'The knight on c3 can jump to b5 and hit c7, especially when the bishop on f4 also aims there.',
  'Against ...Bf5 or ...g6, attack with pawns: f3, g4 and h4.',
  'Often the queen goes to d2 and you castle queenside, then push your king-side pawns.',
];

const NOTE = {
  d4: 'Start with the d-pawn: it grabs the center and opens the way for your dark-squared bishop.',
  Nc3: 'The Jobava move: the knight goes to c3 early, supports e4, and can jump to b5 to attack c7.',
  Bf4: 'The London bishop comes out to f4 before you play e3, so it does not get locked in behind your pawns.',
  e3: 'Solid: e3 supports d4 and opens a path for your other bishop.',
  Nb5: 'The knight jumps to b5 and goes after c7 together with the bishop on f4. Black has to react.',
  Bd3: 'Develops the bishop to a good square and gets you ready to castle.',
  Nf3: 'Black stopped Nb5 with ...a6, so just develop normally: Nf3, Bd3, and castle.',
  f3: 'Against ...Bf5, play f3 to prepare g4, chasing the bishop and gaining space.',
  g4: 'Push g4 to kick the bishop. Your pawns start rolling at Black\'s king side.',
  h4: 'h4 threatens h5 to chase the bishop again. This is the aggressive Jobava style.',
  e4: 'Against ...g6, grab the whole center with e4.',
  Qd2: 'Queen to d2 lines up with the f4 bishop (ideas like Bh6) and prepares castling queenside.',
  'O-O-O': 'Castle queenside, then throw your king-side pawns forward (h4, h5) at Black\'s king.',
};

// Per-line overrides: { san: note } for moves whose reason is specific.
export const LINES = [
  { name: '...e6 and ...Bd6', moves: 'd4 d5 Nc3 Nf6 Bf4 e6 e3 Bd6 Nb5',
    notes: { Nb5: 'Nb5 attacks the bishop on d6. Trading your knight for it takes away Black\'s best bishop and leaves you the bishop pair.' } },
  { name: '...e6 and ...Bb4', moves: 'd4 d5 Nc3 Nf6 Bf4 e6 e3 Bb4 Bd3',
    notes: { Bd3: 'The pin on c3 is not scary yet. Develop with Bd3, then Nf3 or Nge2 and castle.' } },
  { name: '...e6 and ...c5', moves: 'd4 d5 Nc3 Nf6 Bf4 e6 e3 c5 Nb5',
    notes: { Nb5: 'Nb5 threatens Nc7+, forking the king and the rook. The bishop on f4 helps, so Black must defend c7.' } },
  { name: 'Early ...c5', moves: 'd4 d5 Nc3 Nf6 Bf4 c5 e3 Nc6 Nb5',
    notes: { Nb5: 'Nb5 threatens Nc7+, forking the king and the rook. Two of your pieces hit c7 and only the queen defends it.' } },
  { name: '...Bf5 pawn storm', moves: 'd4 d5 Nc3 Nf6 Bf4 Bf5 f3 e6 g4 Bg6 h4',
    notes: { h4: 'h4 threatens h5, and Black\'s bishop on g6 has nowhere good to go. This is the Jobava attack in action.' } },
  { name: '...g6 setup', moves: 'd4 d5 Nc3 Nf6 Bf4 g6 e3 Bg7 h4',
    notes: { h4: 'Against a fianchetto, h4 and h5 open the h-file toward Black\'s castled king.' } },
  { name: '...a6 stops Nb5', moves: 'd4 d5 Nc3 Nf6 Bf4 a6 e3 e6 Nf3' },
  { name: '...c6 setup', moves: 'd4 d5 Nc3 c6 Bf4 Nf6 e3 Bf5 f3',
    notes: { f3: 'Same idea as against ...Bf5: f3 and g4 gain space and chase the bishop.' } },
  { name: '1...Nf6 move order', moves: 'd4 Nf6 Nc3 d5 Bf4 e6 e3 Bd6 Nb5',
    notes: { Nb5: 'Nb5 attacks the bishop on d6, just like in the main line.' } },
  { name: '...g6 without ...d5', moves: 'd4 Nf6 Nc3 g6 Bf4 Bg7 e4 d6 Qd2 O-O O-O-O' },
];

const key = (fen) => fen.split(' ').slice(0, 4).join(' ');

// position key -> { white: Map(san -> {note, lines:Set}), black: Set(san), ends: Set(line index) }
const BOOK = new Map();
LINES.forEach((line, li) => {
  const c = new Chess();
  const sans = line.moves.split(' ');
  sans.forEach((san, i) => {
    const k = key(c.fen());
    if (!BOOK.has(k)) BOOK.set(k, { white: new Map(), black: new Set() });
    const node = BOOK.get(k);
    const m = c.move(san);
    if (m.color === 'w') {
      const note = line.notes?.[m.san] || NOTE[m.san] || '';
      if (!node.white.has(m.san)) node.white.set(m.san, { note, lines: new Set() });
      node.white.get(m.san).lines.add(li);
      if (i === sans.length - 1) node.white.get(m.san).ends = (node.white.get(m.san).ends || new Set()).add(li);
    } else {
      node.black.add(m.san);
    }
  });
});

export function bookNode(fen) {
  return BOOK.get(key(fen)) || null;
}

// Pick a Black reply that keeps you inside the prepared lines.
export function bookReply(fen) {
  const node = bookNode(fen);
  if (!node || !node.black.size) return null;
  const options = [...node.black];
  const san = options[Math.floor(Math.random() * options.length)];
  const m = new Chess(fen).move(san);
  return m.from + m.to + (m.promotion || '');
}

// What the plan says about White's move here.
export function checkWhiteMove(fenBefore, san) {
  const node = bookNode(fenBefore);
  if (!node || !node.white.size) return null;
  const entry = node.white.get(san);
  const [bookSan, bookEntry] = [...node.white.entries()][0];
  if (entry) return { inBook: true, san, note: entry.note, ends: entry.ends ? [...entry.ends] : [] };
  return { inBook: false, bookSan, note: bookEntry.note };
}
