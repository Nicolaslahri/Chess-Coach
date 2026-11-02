# Chess Coach

Play against the computer and get coached on every move, right when you play it.

After each of your moves the board tells you:

- **How good it was**: Best, Good, Inaccuracy, Mistake or Blunder
- **What you should have played**: a green arrow on the board
- **Why**: a short explanation, like "this leaves your knight unprotected" or "you missed a free bishop"
- **What your opponent can do now**: a red arrow for their best answer

**Before each move**, a teacher card tells you what your opponent is threatening, which of your pieces are hanging, and when there's a tactic to find (without giving it away). Stuck? The hint button gives three steps: which piece, what kind of move, then the answer. When the game ends you get your key moments to review.

After a mistake or blunder the game pauses so you can **try again** (with an optional hint) or continue.

Tap any move (like `Nxf7`) to see what it means in plain words, with a blue arrow on the board: "Black's knight on g5 takes the white pawn on f7."

**Jobava London trainer:** pick it under Mode. You play White and the computer answers with real Black replies from 10 prepared lines. Each move gets a plain-English reason, you're stopped if you leave the plan, and a line counts as mastered once you play it start to finish without help.

Your phone vibrates on each move, with a strong buzz for blunders (turn it off with the Vibrate box).

There is a pure black dark mode (the default) and a light mode, switchable at the top right.

Type your **Chess.com username** and it reads your public rating to pick an opponent level that fits you.

Everything runs in your browser. The engine is Stockfish compiled to WebAssembly, so there's no server and no account.

## Run it

```bash
npm install
npm run dev
```

Then open the address it prints (usually http://localhost:5173).

## Put it online

The site is hosted on Vercel, which rebuilds it on every push to `main`.

## How it works

| File | What it does |
| --- | --- |
| `src/engine.js` | Talks to Stockfish running in a web worker |
| `src/coach.js` | Grades a move and writes the explanation |
| `src/jobava.js` | Jobava London lines and the reason for each move |
| `src/teacher.js` | Threats, hanging pieces, tactic alerts and hints before your move |
| `src/chesscom.js` | Reads your rating from the Chess.com public API |
| `src/main.js` | Board, game flow, take-backs, coach panel |

Grading uses the same idea as Lichess: the engine's evaluation is turned into a winning chance,
and the drop in winning chance caused by your move decides the label
(10% or more is an inaccuracy, 20% a mistake, 30% a blunder).

## Built with

- [chessground](https://github.com/lichess-org/chessground), the Lichess board (GPL-3.0)
- [chess.js](https://github.com/jhlywa/chess.js), chess rules (BSD-2)
- [Stockfish.js](https://github.com/nmrugg/stockfish.js), Stockfish in WebAssembly (GPL-3.0)

Because of the GPL parts, this project is GPL-3.0 too.
