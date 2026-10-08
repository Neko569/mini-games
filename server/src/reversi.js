// 黑白棋(奥赛罗)引擎 — 8x8，黑先
export const SIZE = 8;
const DIRS = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];

export function newGame() {
  const board = new Array(64).fill(0); // 0空 1黑 2白
  board[27] = 2; board[28] = 1; board[35] = 1; board[36] = 2;
  return { board, turn: 1, moves: [], winner: null, passed: 0 };
}

const at = (b, x, y) => (x >= 0 && x < 8 && y >= 0 && y < 8) ? b[y * 8 + x] : -1;

export function flipsFor(b, seat, x, y) {
  if (at(b, x, y) !== 0) return null;
  const flips = [];
  for (const [dx, dy] of DIRS) {
    const line = [];
    let cx = x + dx, cy = y + dy;
    while (at(b, cx, cy) === 3 - seat) { line.push(cy * 8 + cx); cx += dx; cy += dy; }
    if (line.length && at(b, cx, cy) === seat) flips.push(...line);
  }
  return flips.length ? flips : null;
}

export function legalMoves(b, seat) {
  const out = [];
  for (let i = 0; i < 64; i++) if (flipsFor(b, seat, i % 8, (i / 8) | 0)) out.push(i);
  return out;
}

export function move(game, seat, x, y) {
  if (game.winner !== null) throw new Error('对局已结束');
  if (game.turn !== seat) throw new Error('还没轮到你');
  const flips = flipsFor(game.board, seat, x, y);
  if (!flips) throw new Error('不合法的落点');
  game.board[y * 8 + x] = seat;
  for (const f of flips) game.board[f] = seat;
  game.moves.push({ x, y, seat, flips: flips.length });
  nextTurn(game);
  return game;
}

export function pass(game, seat) {
  if (game.winner !== null) throw new Error('对局已结束');
  if (game.turn !== seat) throw new Error('还没轮到你');
  if (legalMoves(game.board, seat).length) throw new Error('你还有合法落点，不能跳过');
  game.moves.push({ pass: true, seat });
  nextTurn(game);
  return game;
}

function nextTurn(game) {
  const opp = 3 - game.turn;
  if (legalMoves(game.board, opp).length) { game.turn = opp; game.passed = 0; return; }
  if (legalMoves(game.board, game.turn).length) { game.passed++; game.moves.push({ autoPass: true, seat: opp }); return; } // 对方无棋可下，继续自己
  finish(game);
}

function finish(game) {
  const b = game.board;
  const black = b.filter(v => v === 1).length, white = b.filter(v => v === 2).length;
  game.winner = black === white ? -1 : (black > white ? 1 : 2);
  game.score = { black, white };
}

export const counts = (b) => ({ black: b.filter(v => v === 1).length, white: b.filter(v => v === 2).length });
