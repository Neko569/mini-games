// 五子棋逻辑：15×15 无禁手，五连即胜
export const SIZE = 15;

export function newGame() {
  return {
    size: SIZE,
    board: new Array(SIZE * SIZE).fill(0), // 0空 1黑 2白
    moves: [],                             // {x,y,c}
    turn: 0,                               // 0=黑(座位0) 1=白(座位1)
    winner: null,                          // null=进行中, 0/1=胜者座位, -1=平局
    winLine: [],                           // 连珠坐标，用于高亮
    lastMove: null,
  };
}

export function place(game, seat, x, y) {
  if (game.winner !== null) throw new Error('对局已结束');
  if (game.turn !== seat) throw new Error('还没轮到你落子');
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= SIZE || y < 0 || y >= SIZE) throw new Error('坐标越界');
  const idx = y * SIZE + x;
  if (game.board[idx] !== 0) throw new Error('此位置已有棋子');
  const color = seat === 0 ? 1 : 2;
  game.board[idx] = color;
  game.moves.push({ x, y, c: color });
  game.lastMove = { x, y };
  const line = checkWin(game.board, x, y, color);
  if (line) {
    game.winner = seat;
    game.winLine = line;
  } else if (game.moves.length === SIZE * SIZE) {
    game.winner = -1; // 平局
  } else {
    game.turn = 1 - seat;
  }
  return game;
}

function checkWin(board, x, y, c) {
  for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    const line = [{ x, y }];
    for (const s of [1, -1]) {
      let nx = x + dx * s, ny = y + dy * s;
      while (nx >= 0 && nx < SIZE && ny >= 0 && ny < SIZE && board[ny * SIZE + nx] === c) {
        line.push({ x: nx, y: ny });
        nx += dx * s; ny += dy * s;
      }
    }
    if (line.length >= 5) return line.sort((a, b) => (a.x - b.x) || (a.y - b.y));
  }
  return null;
}
