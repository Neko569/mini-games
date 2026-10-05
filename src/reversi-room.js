// 黑白棋房间插件（2 人，黑=座位0 白=座位1）—— 公共逻辑在 room-base.js
import { reportResult } from './stats-report.js';
import { newGame, move, pass, legalMoves, counts } from './reversi.js';
import { BaseRoomDO } from './room-base.js';

function pubView(base) {
  const g = base.room.game;
  const c = counts(g.board);
  return {
    board: g.board, turn: g.turn, winner: g.winner, score: g.score || null,
    legal: legalMoves(g.board, g.turn),
    lastMove: g.moves.length ? g.moves[g.moves.length - 1] : null,
    black: c.black, white: c.white,
    seats: base.room.seats.map((s, i) => s ? { seat: i, gid: s.gid, name: s.name, avatar: s.avatar, connected: s.connected } : null),
  };
}

function moveMsg(base, x, y, seat) {
  const g = base.room.game;
  const last = g.moves[g.moves.length - 1];
  return {
    t: 'move', x, y, seat, flips: last.flips,
    autoPass: !!last.autoPass,
    nextTurn: g.turn, winner: g.winner,
    score: g.score || null,
    pub: pubView(base),
  };
}

function finishMsg(base) {
  const g = base.room.game;
  return { t: 'finished', winner: g.winner, score: g.score, pub: pubView(base), room: base.roomView() };
}

function overWinners(base) {
  return base.room.game.winner === -1 ? [] : [base.room.game.winner - 1]; // 座位 = 颜色-1，平局为空
}

const DEF = {
  game: 'reversi', max: 2,
  minPlayers: 2, minMsg: '至少需要 2 名玩家',
  fullMsg: '房间已满（黑白棋为 2 人对弈）', fullClose: false,
  spectate: true,
  joinOnUpgrade: true, // 升级即入座（保留原行为；客户端 join 消息为幂等重入）
  newGame: () => newGame(),
  afterStart: (base) => base._broadcast({ t: 'state', pub: pubView(base) }),
  rejoinSync: (base, ws, seat) => base._send(ws, { t: 'state', pub: pubView(base) }),
  actions: {
    place(base, ws, tag, m) {
      const r = base.room;
      if (!r.started || !r.game) throw new Error('对局未开始');
      const seat = base.seatOf(tag.gid);
      if (seat < 0) throw new Error('观战不能落子');
      const x = m.x | 0, y = m.y | 0;
      if (x < 0 || x > 7 || y < 0 || y > 7) throw new Error('坐标越界');
      move(r.game, seat + 1, x, y); // 座位0=黑(1) 座位1=白(2)
      base.saveRoom();
      base._broadcast(moveMsg(base, x, y, seat));
      if (r.game.winner !== null) {
        base._broadcast(finishMsg(base));
        reportResult(base.env, 'reversi', base.room.seats, overWinners(base));
      }
    },
    pass(base, ws, tag) {
      const r = base.room;
      if (!r.started || !r.game) throw new Error('对局未开始');
      const seat = base.seatOf(tag.gid);
      if (seat < 0) throw new Error('观战不能跳过');
      pass(r.game, seat + 1);
      base.saveRoom();
      base._broadcast({ t: 'passby', seat, nextTurn: r.game.turn, pub: pubView(base) });
      if (r.game.winner !== null) {
        base._broadcast(finishMsg(base));
        reportResult(base.env, 'reversi', base.room.seats, overWinners(base));
      }
    },
  },
};

export class ReversiRoomDO extends BaseRoomDO {
  constructor(state, env) { super(state, env, DEF); }
}
