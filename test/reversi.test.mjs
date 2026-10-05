import { newGame, move, pass, legalMoves, counts, flipsFor } from '../src/reversi.js';
// 开局合法点：黑有4个 (2D,3C,4F,5E) → idx 19,26,37,44
let g = newGame();
const lm = legalMoves(g.board, 1).sort((a,b)=>a-b);
console.log('开局黑合法点:', lm.join(','), '(期望 19,26,37,44)');
if (JSON.stringify(lm) !== JSON.stringify([19,26,37,44])) process.exit(1);
// 走一手验证翻转
g = move(g, 1, 3, 2); // idx 19, 翻 idx 27
console.log('黑下(3,2)后翻子数:', g.moves[0].flips, '| 白回合:', g.turn);
if (g.moves[0].flips !== 1 || g.turn !== 2) process.exit(1);
// 随机局 200 场
for (let t = 0; t < 200; t++) {
  const g2 = newGame();
  let steps = 0;
  while (g2.winner === null && steps++ < 200) {
    const s = g2.turn;
    const lm2 = legalMoves(g2.board, s);
    if (lm2.length) { const idx = lm2[(Math.random() * lm2.length) | 0]; move(g2, s, idx % 8, (idx / 8) | 0); }
    else pass(g2, s);
  }
  if (g2.winner === null) { console.log('FAIL: 无终局'); process.exit(1); }
  const c = counts(g2.board);
  // 全歼（一方 0 子）是合法终局：双方都无合法落点 → 引擎正确判终局
  if (c.black + c.white > 64) { console.log('FAIL: 子数异常', c); process.exit(1); }
  if (g2.winner !== -1 && ((g2.winner === 1 && c.black <= c.white) || (g2.winner === 2 && c.white <= c.black))) { console.log('FAIL: 判胜不一致', c, g2.winner); process.exit(1); }
}
console.log('REVERSI-ENGINE-PASS');
