// Small promise wrapper around the Stockfish web worker (UCI protocol).
export class Engine {
  constructor(url) {
    this.worker = new Worker(url);
    this.listeners = [];
    this.queue = Promise.resolve();
    this.worker.onmessage = (e) => {
      if (typeof e.data !== 'string') return;
      for (const fn of this.listeners.slice()) fn(e.data);
    };
    this.ready = this._waitFor((l) => l === 'uciok');
    this.send('uci');
  }

  send(cmd) {
    this.worker.postMessage(cmd);
  }

  _waitFor(done, onLine) {
    return new Promise((resolve) => {
      const fn = (line) => {
        if (onLine) onLine(line);
        if (done(line)) {
          this.listeners = this.listeners.filter((x) => x !== fn);
          resolve(line);
        }
      };
      this.listeners.push(fn);
    });
  }

  // Run jobs one at a time so outputs never get mixed up.
  _run(job) {
    const p = this.queue.then(job);
    this.queue = p.catch(() => {});
    return p;
  }

  async _isReady() {
    const p = this._waitFor((l) => l === 'readyok');
    this.send('isready');
    await p;
  }

  newGame() {
    return this._run(async () => {
      await this.ready;
      this.send('ucinewgame');
      await this._isReady();
    });
  }

  // Analyse a position. Scores are from the side to move's point of view.
  analyse(fen, { depth = 14, multipv = 1 } = {}) {
    return this._run(async () => {
      await this.ready;
      this.send(`setoption name MultiPV value ${multipv}`);
      await this._isReady();
      const lines = [];
      this.send(`position fen ${fen}`);
      const done = this._waitFor(
        (l) => l.startsWith('bestmove'),
        (l) => {
          const info = parseInfo(l);
          if (info) lines[info.multipv - 1] = info;
        }
      );
      this.send(`go depth ${depth}`);
      const best = await done;
      return { bestmove: best.split(' ')[1], lines: lines.filter(Boolean) };
    });
  }

  // Pick a move for the computer opponent at a given strength.
  play(fen, { skill = 10, depth = 8 } = {}) {
    return this._run(async () => {
      await this.ready;
      this.send('setoption name MultiPV value 1');
      this.send(`setoption name Skill Level value ${skill}`);
      await this._isReady();
      this.send(`position fen ${fen}`);
      const done = this._waitFor((l) => l.startsWith('bestmove'));
      this.send(`go depth ${depth}`);
      const best = await done;
      return best.split(' ')[1];
    });
  }
}

function parseInfo(line) {
  if (!line.startsWith('info ') || !line.includes(' pv ') || !line.includes(' score ')) return null;
  if (line.includes('lowerbound') || line.includes('upperbound')) return null;
  const t = line.split(' ');
  const get = (k) => t[t.indexOf(k) + 1];
  const scoreType = get('score');
  const scoreVal = parseInt(t[t.indexOf('score') + 2], 10);
  return {
    depth: parseInt(get('depth'), 10),
    multipv: line.includes(' multipv ') ? parseInt(get('multipv'), 10) : 1,
    score: scoreType === 'mate' ? { mate: scoreVal } : { cp: scoreVal },
    pv: t.slice(t.indexOf('pv') + 1),
  };
}
