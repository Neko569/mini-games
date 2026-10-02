// 炸飞机引擎 — 10×10，每方 3 架飞机（11 格经典机型），炸中机头即击落
export const W = 10;
export const SHAPE = [ // 机头朝上，(0,0)=机头
  [0, 0], [0, 1],
  [-2, 2], [-1, 2], [0, 2], [1, 2], [2, 2],
  [-1, 3], [0, 3], [1, 3],
  [0, 4],
];

export function newGame() {
  return {
    phase: 'placing',
    boards: [null, null],
    strikes: [[], []],
    turn: 0,
    winner: null,
  };
}

/* 布局：3 架 {x,y,rot}（机头位置+旋转）。校验：不越界、不重叠 */
export function place(planes) {
  if (!Array.isArray(planes) || planes.length !== 3) throw new Error('需要布置 3 架飞机');
  const cells = new Set();
  const out = [];
  for (const pl of planes) {
    const { x, y, rot } = pl;
    if (![0, 1, 2, 3].includes(rot)) throw new Error('旋转角度非法');
    const pc = [];
    for (const [dx, dy] of SHAPE) {
      let rx = dx, ry = dy;
      for (let r = 0; r < rot; r++) { const t = rx; rx = -ry; ry = t; }
      const cx = x + rx, cy = y + ry;
      if (cx < 0 || cx >= W || cy < 0 || cy >= W) throw new Error('飞机超出边界');
      const key = cy * W + cx;
      if (cells.has(key)) throw new Error('飞机不能重叠');
      cells.add(key);
      pc.push(key);
    }
    out.push({ head: y * W + x, cells: pc, down: false });
  }
  return out;
}

export function bothPlaced(game) { return game.boards[0] && game.boards[1]; }

/* 打击：返回 'miss' | 'hit' | 'down'（击中机头→整架击落） */
export function strike(game, seat, x, y) {
  if (game.phase !== 'fighting') throw new Error('不在交战阶段');
  if (game.winner !== null) throw new Error('对局已结束');
  if (game.turn !== seat) throw new Error('还没轮到你');
  if (x < 0 || x >= W || y < 0 || y >= W) throw new Error('坐标越界');
  const key = y * W + x;
  const enemy = game.boards[1 - seat];
  if (game.strikes[seat].some(s => s.x === x && s.y === y)) throw new Error('这个位置已经炸过了');
  let res = 'miss';
  for (const plane of enemy) {
    if (plane.down) continue;
    if (plane.head === key) { plane.down = true; res = 'down'; break; }
    if (plane.cells.includes(key)) { res = res === 'down' ? 'down' : 'hit'; }
  }
  game.strikes[seat].push({ x, y, res });
  if (enemy.every(p => p.down)) { game.winner = seat; game.phase = 'over'; return res; }
  game.turn = 1 - seat;
  return res;
}
