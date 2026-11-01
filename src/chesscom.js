// Reads a player's public ratings from the Chess.com API (no login needed).
export async function fetchRatings(username) {
  const res = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(username.trim().toLowerCase())}/stats`);
  if (res.status === 404) throw new Error(`No Chess.com player called "${username}".`);
  if (!res.ok) throw new Error(`Chess.com didn't answer (error ${res.status}). Try again in a bit.`);
  const data = await res.json();
  const pick = (k) => data[k]?.last?.rating ?? null;
  return { rapid: pick('chess_rapid'), blitz: pick('chess_blitz'), bullet: pick('chess_bullet'), daily: pick('chess_daily') };
}

// Rapid is the best guide to real strength, then daily, blitz, bullet.
export function mainRating(r) {
  for (const [kind, val] of [['rapid', r.rapid], ['daily', r.daily], ['blitz', r.blitz], ['bullet', r.bullet]]) {
    if (val) return { kind, rating: val };
  }
  return null;
}
