import { newGame, play, drawCards, mustDraw } from '../src/uno.js';
let g = newGame(3);
let ok = 0, err = 0, safety = 0;
while (g.winner === null && safety++ < 3000) {
  const s = g.turn;
  if (mustDraw(g)) { drawCards(g, s); ok++; continue; }
  const hand = g.hands[s];
  let played = false;
  for (let i = 0; i < hand.length; i++) {
    const c = hand[i];
    if (c.c === g.color || c.c === 'W' || c.v === g.discard[g.discard.length - 1].v) {
      try { play(g, s, i, c.c === 'W' ? 'R' : undefined); played = true; ok++; break; } catch (e) { err++; }
    }
  }
  if (!played) { try { drawCards(g, s); ok++; } catch (e) { err++; } }
}
console.log('winner:', g.winner, '| ok:', ok, 'err:', err, '| timeout:', safety >= 3000);
if (g.winner === null) process.exit(1);
