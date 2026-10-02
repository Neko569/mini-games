import { newGame, draw, guess, discard, faceDownCount } from '../src/davinci.js';
// 模拟 2 人局直到有人获胜（随机策略）
let g = newGame(2);
let steps = 0;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
while (g.winner === null && steps++ < 2000) {
  const s = g.turn;
  try {
    if (!g.drawnUid && g.deck.length > 0 && Math.random() < 0.7) { draw(g, s); continue; }
    // 猜：随机猜对手一张暗牌（点数随机，靠运气）
    const opp = 1 - s;
    const targets = g.hands[opp].filter(c => !c.revealed);
    if (targets.length === 0) { // 换个活人
      continue;
    }
    const t = pick(targets);
    if (Math.random() < 0.5) guess(g, s, opp, t.uid, t.c, t.r); // 半数蒙对
    else guess(g, s, opp, t.uid, pick(['B', 'W']), pick([0, 5, 9]));
  } catch (e) {
    // 兜底：弃牌/摸牌失败就弃第一张暗牌
    try {
      const fd = g.hands[s].find(c => !c.revealed);
      if (g.drawnUid) discard(g, s, g.drawnUid);
      else if (fd) discard(g, s, fd.uid);
      else draw(g, s);
    } catch (e2) { /* 忽略 */ }
  }
}
console.log('winner:', g.winner, '| steps:', steps, '| timeouts:', steps >= 2000);
const fd = [0, 1].map(i => faceDownCount(g, i));
console.log('faceDown:', fd.join('/'));
if (g.winner === null) process.exit(1);
console.log('DV-ENGINE-PASS');
