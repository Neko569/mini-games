import { newGame, playAction, resolvePending, nope, give, resolveGiveTimeout, draw, peekTop } from '../src/kittens.js';
// 随机局模拟 2-4 人：动作 → 等窗口 → 结算，直到出 winner
for (let trial = 0; trial < 6; trial++) {
  const n = 2 + (trial % 3);
  const g = newGame(n);
  let steps = 0;
  while (g.winner === null && steps++ < 4000) {
    try {
      const s = g.turn;
      if (g.giving) { resolveGiveTimeout(g); continue; }
      if (g.pending) { resolvePending(g); continue; }
      const act = g.hands[s].find(c => ['skip','attack','favor','shuffle','seefuture'].includes(c.kind));
      if (act && Math.random() < 0.35) { playAction(g, s, act.uid, act.kind === 'favor' ? g.hands.map((_, i) => i).filter(i => g.alive[i] && i !== s)[0] : null); continue; }
      draw(g, s);
    } catch (e) {
      if (!['还没轮到你','本回合无需再摸','牌堆已空','该玩家没有手牌可要'].some(m => e.message.includes(m))) {
        console.log('trial', trial, 'Unexpected:', e.message); process.exit(1);
      }
      // 卡住兜底：强转回合
      if (g.drawsLeft <= 0) { resolvePending(g); }
      else break;
    }
  }
  if (g.winner === null) { console.log('trial', trial, 'no winner (steps', steps, ') deck', g.deck.length); continue; }
  console.log('trial', trial, `n=${n}`, 'winner', g.winner, 'steps', steps);
}
console.log('K-ENGINE-PASS');
